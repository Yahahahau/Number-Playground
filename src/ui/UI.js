// Mobile HUD: crosshair, inspect card, toasts, tutorial, joystick visuals, action buttons.
// Panels (collection, spawn, daily, settings, help) live in Panels.js.
import { fmtCompact, fmtFull, tierCss, tierPos, tierIndex, TIER_NAMES } from '../core/bignum.js';
import { MAX_BLOCKS, WARN_BLOCKS } from '../blocks/BlockManager.js';
import { Panels } from './Panels.js';

export const ICON = {
  grab: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  release: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  push: '<path d="M12 20V5M5.5 11.5L12 5l6.5 6.5"/>',
  pull: '<path d="M12 4v15M5.5 12.5L12 19l6.5-6.5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.5 3.5v5h-5"/>',
  throw: '<path d="M3 19c3-9 10-12.5 17.5-10.5"/><path d="M16 4.5l5 4-4.5 4.5"/>',
  collection: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/>',
  spawn: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M3.5 3.5v5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.4a2.7 2.7 0 1 1 3.6 2.5c-.8.4-1 1-1 1.8"/><circle cx="12" cy="17.2" r=".7" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6L12 16.7 6.5 19.6l1.2-6L3.2 9.4l6.1-.8z"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
};
export const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

const $ = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.toastList = [];
    this.tutorialTimer = null;
    this.lastInspect = null;
    this.build();
    this.panels = new Panels(game, this);
    this.bindEvents();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';

    this.touch = $('<div id="touch"></div>');
    this.joyHint = $('<div class="joy-hint">Move</div>');
    this.joy = $('<div class="joy"><div class="joy-base"></div><div class="joy-knob"></div></div>');
    this.joyBase = this.joy.querySelector('.joy-base');
    this.joyKnob = this.joy.querySelector('.joy-knob');
    this.crosshair = $('<div class="crosshair"></div>');
    this.inspect = $('<div class="inspect"><div class="tier"></div><div class="val"></div><div class="sub"></div></div>');
    this.toasts = $('<div class="toasts"></div>');
    this.mergeText = $('<div class="mergetext"></div>');
    this.banner = $('<div class="banner"><div class="b1"></div><div class="b2"></div><div class="b3"></div></div>');
    this.tutorial = $(
      `<div class="tutorial">
        <b>Welcome to Number Playground!</b>
        <p>Use your Physics Gun to grab, push and throw number blocks.</p>
        <p>Combine two blocks to create a bigger number!</p>
        <p>Discover new numbers and save them in your Collection.</p>
      </div>`,
    );
    this.rotateHint = $('<div class="rotatehint">Rotate mode: drag to turn the block</div>');
    this.blockCount = $('<div class="blockcount"></div>');

    for (const el of [this.touch, this.joyHint, this.joy, this.crosshair, this.inspect, this.toasts, this.mergeText, this.banner, this.tutorial, this.rotateHint, this.blockCount]) r.appendChild(el);

    // top-left: daily challenge chip
    const tl = $('<div class="top-left"></div>');
    this.dailyChip = $(`<button class="chip" type="button" aria-label="Daily challenge">${svg('star')}<div><div class="dtxt">Daily 0/3</div><small>Challenges</small></div></button>`);
    tl.appendChild(this.dailyChip);
    r.appendChild(tl);

    // top-right: help + settings
    const tr = $('<div class="top-right"></div>');
    this.btnHelp = this.iconBtn('help', 'Help');
    this.btnSettings = this.iconBtn('settings', 'Settings');
    tr.append(this.btnHelp, this.btnSettings);
    r.appendChild(tr);

    // left rail: collection, spawn, reset
    const rail = $('<div class="rail-left"></div>');
    this.btnCollection = this.iconBtn('collection', 'Numbers');
    this.btnSpawn = this.iconBtn('spawn', 'Spawn');
    this.btnReset = this.iconBtn('reset', 'Reset');
    rail.append(this.btnCollection, this.btnSpawn, this.btnReset);
    r.appendChild(rail);

    // right column: gun actions
    const bottoms = { throw: 190, rotate: 256, pull: 322, push: 388, grab: 454 };
    this.btnGrab = this.actionBtn('grab', 'Grab', bottoms.grab, 'btn-grab');
    this.btnPush = this.actionBtn('push', 'Push', bottoms.push);
    this.btnPull = this.actionBtn('pull', 'Pull', bottoms.pull);
    this.btnRotate = this.actionBtn('rotate', 'Rotate', bottoms.rotate);
    this.btnThrow = this.actionBtn('throw', 'Throw', bottoms.throw);
    for (const b of [this.btnGrab, this.btnPush, this.btnPull, this.btnRotate, this.btnThrow]) r.appendChild(b);
    this.layoutActions();
    this._ro = new ResizeObserver(() => this.layoutActions());
    this._ro.observe(this.root);

    this.wireButtons();
  }

  /** Spread the action column across the available height (keeps the gun area clear). */
  layoutActions() {
    const h = this.root.clientHeight || 800;
    const bottomStart = Math.max(150, h * 0.215); // gun lives below this
    const size = h < 640 ? 52 : 58;
    const gap = h < 640 ? 6 : 10;
    const list = [this.btnThrow, this.btnRotate, this.btnPull, this.btnPush];
    let b = bottomStart;
    for (const el of list) {
      el.style.width = el.style.height = size + 'px';
      el.style.bottom = `calc(var(--safe-b) + ${b}px)`;
      b += size + gap;
    }
    const gs = h < 640 ? 66 : 74;
    this.btnGrab.style.width = this.btnGrab.style.height = gs + 'px';
    this.btnGrab.style.bottom = `calc(var(--safe-b) + ${b + 2}px)`;
  }

  iconBtn(icon, label) {
    return $(`<button class="btn btn-icon" type="button" aria-label="${label}">${svg(icon)}<span>${label}</span></button>`);
  }

  actionBtn(icon, label, bottom, cls = '') {
    const b = $(`<button class="btn btn-action ${cls}" type="button" aria-label="${label}">${svg(icon)}<span>${label}</span></button>`);
    b.style.bottom = `calc(var(--safe-b) + ${bottom}px)`;
    return b;
  }

  setBtn(btn, icon, label) {
    btn.innerHTML = `${svg(icon)}<span>${label}</span>`;
  }

  /** Gameplay buttons fire on pointerdown for instant response; multi-touch safe. */
  press(btn, down, up) {
    let id = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.audio.unlock();
      if (id !== null) return;
      id = e.pointerId;
      try {
        btn.setPointerCapture(id);
      } catch {
        /* ignore */
      }
      btn.classList.add('pressed');
      if (this.panels.isOpen) return;
      down?.(e);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      btn.classList.remove('pressed');
      up?.(e);
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  wireButtons() {
    const g = this.game;
    this.press(this.btnGrab, () => g.gun.toggleGrab());
    this.press(this.btnPush, () => g.gun.push());
    this.press(this.btnThrow, () => g.gun.throwBlock());
    this.press(
      this.btnPull,
      () => g.gun.setPull(true),
      () => g.gun.setPull(false),
    );
    this.press(this.btnRotate, () => g.gun.toggleRotate());

    const open = (name) => () => {
      g.audio.unlock();
      this.panels.open(name);
    };
    this.btnCollection.addEventListener('click', open('collection'));
    this.btnSpawn.addEventListener('click', open('spawn'));
    this.btnSettings.addEventListener('click', open('settings'));
    this.btnHelp.addEventListener('click', open('help'));
    this.dailyChip.addEventListener('click', open('daily'));
    this.btnReset.addEventListener('click', () => {
      g.audio.unlock();
      g.resetBlocks();
    });
  }

  bindEvents() {
    const ev = this.game.events;
    ev.on('toast', (t) => this.toast(t.text, t.kind));
    ev.on('mergeToast', (t) => this.showMerge(t.text, t.color));
    ev.on('discover', (d) => this.showDiscover(d));
    ev.on('questDone', ({ quest }) => this.toast(`Challenge complete: ${quest.title}`, 'good'));
    ev.on('dailyComplete', ({ fx }) => {
      this.toast(fx ? `All challenges done! New effect: ${fx.name}` : 'All challenges done! +1 star', 'good');
      this.game.audio.reward();
      this.dailyChip.classList.remove('pulse');
      void this.dailyChip.offsetWidth;
      this.dailyChip.classList.add('pulse');
    });
    ev.on('dailyChanged', () => this.updateDaily());
    ev.on('rotateMode', ({ on }) => {
      this.btnRotate.classList.toggle('rot-on', on);
      this.rotateHint.classList.toggle('show', on);
    });
    this.updateDaily();
  }

  updateDaily() {
    const d = this.game.daily;
    const done = d.quests.filter((q) => q.done).length;
    this.dailyChip.querySelector('.dtxt').textContent = `Daily ${done}/${d.quests.length || 3}`;
    this.dailyChip.classList.toggle('on', done === d.quests.length && done > 0);
  }

  // ------------------------------------------------------------------ feedback widgets

  toast(text, kind = 'info') {
    // collapse identical messages
    const dup = this.toastList.find((t) => t.text === text);
    if (dup) {
      clearTimeout(dup.timer);
      dup.timer = setTimeout(() => this.dropToast(dup), 2600);
      return;
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    const t = { el, text, timer: setTimeout(() => this.dropToast(t), 2600) };
    this.toastList.push(t);
    while (this.toastList.length > 3) this.dropToast(this.toastList[0]);
  }

  dropToast(t) {
    clearTimeout(t.timer);
    const i = this.toastList.indexOf(t);
    if (i < 0) return;
    this.toastList.splice(i, 1);
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), 420);
  }

  showMerge(text, color) {
    const m = this.mergeText;
    m.textContent = text;
    m.style.color = color || '#fff';
    m.classList.remove('go');
    void m.offsetWidth;
    m.classList.add('go');
  }

  showDiscover({ value, isRecord }) {
    // the initial "1" is registered silently at boot
    if (!this.game.running) return;
    const b = this.banner;
    b.querySelector('.b1').textContent = 'New number discovered!';
    const b2 = b.querySelector('.b2');
    b2.textContent = value.toString().length > 12 ? fmtCompact(value) : fmtFull(value);
    b2.style.color = tierCss(value).startsWith('#') ? tierCss(value) : '#ffd6f0';
    b2.style.fontSize = b2.textContent.length > 14 ? '22px' : '30px';
    b.querySelector('.b3').textContent = isRecord ? 'NEW RECORD!' : 'Saved to your Collection';
    b.classList.remove('go');
    void b.offsetWidth;
    b.classList.add('go');
  }

  showTutorial(ms = 7500) {
    clearTimeout(this.tutorialTimer);
    this.tutorial.classList.add('show');
    this.tutorialTimer = setTimeout(() => this.tutorial.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------------ per-frame

  update() {
    const gun = this.game.gun;
    const b = gun.aimBlock;
    if (this._held !== !!gun.held) {
      this._held = !!gun.held;
      this.setGrabState(this._held);
    }
    const cls = gun.held ? 'held' : b ? (gun.aimDist <= 22 ? 'aim' : 'far') : '';
    const want = `crosshair ${cls}`;
    if (this.crosshair.className !== want) this.crosshair.className = want;

    // inspect card with the full exact value
    if (b) {
      if (this.lastInspect !== b || this.lastValue !== b.value) {
        this.lastInspect = b;
        this.lastValue = b.value;
        const full = fmtFull(b.value);
        const val = this.inspect.querySelector('.val');
        const css = tierCss(b.value);
        val.textContent = full;
        val.style.color = css.startsWith('#') ? css : '#ffd6f0';
        val.style.fontSize = full.length > 36 ? '12px' : full.length > 24 ? '15px' : full.length > 14 ? '19px' : '26px';
        this.inspect.querySelector('.tier').textContent = `${TIER_NAMES[tierIndex(tierPos(b.value))]} block`;
        this.inspect.querySelector('.sub').textContent =
          b.value.toString().length > 5 ? `${fmtCompact(b.value)} · ${b.value.toString().length} digits` : `${b.mass.toFixed(0)} kg`;
      }
      this.inspect.classList.add('show');
    } else {
      this.inspect.classList.remove('show');
      this.lastInspect = null;
    }

    const n = this.game.blocks.count;
    const txt = `Blocks ${n}/${MAX_BLOCKS}`;
    if (this._bc !== txt) {
      this._bc = txt;
      this.blockCount.textContent = txt;
      this.blockCount.classList.toggle('full', n >= WARN_BLOCKS);
    }
  }

  setGrabState(held) {
    this.setBtn(this.btnGrab, held ? 'release' : 'grab', held ? 'Release' : 'Grab');
    this.btnGrab.classList.toggle('on', held);
  }
}
