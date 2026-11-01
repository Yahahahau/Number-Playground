// Multi-touch input: floating virtual joystick (left-bottom zone), drag-to-look (everywhere else),
// plus keyboard / mouse for desktop testing. UI buttons are real DOM elements stacked above this
// layer, so pressing them never moves the camera or the joystick.
export class Input {
  constructor(layer, hudRefs) {
    this.layer = layer;
    this.joyEl = hudRefs.joy; // container
    this.joyBase = hudRefs.joyBase;
    this.joyKnob = hudRefs.joyKnob;
    this.joyHint = hudRefs.joyHint;

    this.moveX = 0;
    this.moveY = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.enabled = true;
    this.keys = new Set();
    this.joyId = null;
    this.lookId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };
    this.onKey = null; // (code, down) => void   (set by the game)
    this.onLookMove = null;
    this.onLookEnd = null;
    this.radius = 54;

    layer.addEventListener('pointerdown', (e) => this.down(e));
    layer.addEventListener('pointermove', (e) => this.move(e));
    layer.addEventListener('pointerup', (e) => this.up(e));
    layer.addEventListener('pointercancel', (e) => this.up(e));
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.addEventListener('lostpointercapture', (e) => this.up(e));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.reset();
  }

  reset() {
    this.joyId = null;
    this.lookId = null;
    this.moveX = this.moveY = 0;
    this.keys.clear();
    this.joyEl.classList.remove('active');
    this.joyKnob.style.transform = 'translate(-50%,-50%)';
  }

  zone(e) {
    const r = this.layer.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, w: r.width, h: r.height, left: r.left, top: r.top, joy: x < r.width * 0.52 && y > r.height * 0.42 };
  }

  down(e) {
    if (!this.enabled) return;
    const z = this.zone(e);
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button !== 0) return;
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    if (z.joy && this.joyId === null && !isMouse) {
      this.joyId = e.pointerId;
      const bx = Math.min(Math.max(z.x, this.radius + 8), z.w * 0.52);
      const by = Math.min(Math.max(z.y, z.h * 0.42 + this.radius), z.h - this.radius - 8);
      this.joyOrigin.x = bx;
      this.joyOrigin.y = by;
      this.joyEl.style.left = bx + 'px';
      this.joyEl.style.top = by + 'px';
      this.joyEl.classList.add('active');
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
      this.updateJoy(z.x, z.y);
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
    }
    e.preventDefault();
  }

  move(e) {
    if (e.pointerId === this.joyId) {
      const z = this.zone(e);
      this.updateJoy(z.x, z.y);
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
      // the game may claim the drag (e.g. rotating a held block) instead of moving the camera
      const claimed = this.onLookMove ? this.onLookMove(dx, dy) : false;
      if (!claimed) {
        this.lookX += dx;
        this.lookY += dy;
      }
    }
  }

  up(e) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.moveX = this.moveY = 0;
      this.joyEl.classList.remove('active');
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    }
    if (e.pointerId === this.lookId) {
      this.lookId = null;
      this.onLookEnd?.();
    }
  }

  updateJoy(x, y) {
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = this.radius;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / max;
    const ny = dy / max;
    const mag = Math.hypot(nx, ny);
    const dead = 0.12;
    if (mag < dead) {
      this.moveX = this.moveY = 0;
    } else {
      const s = Math.min(1, (mag - dead) / (1 - dead)) / mag;
      this.moveX = nx * s;
      this.moveY = -ny * s; // up on screen = forward
    }
  }

  key(e, down) {
    if (!this.enabled) return;
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const c = e.code;
    if (down) this.keys.add(c);
    else this.keys.delete(c);
    if (!e.repeat) this.onKey?.(c, down);
  }

  /** Combined joystick + keyboard movement vector. */
  movement(out) {
    let x = this.moveX;
    let y = this.moveY;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  consumeLook(out) {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }
}
