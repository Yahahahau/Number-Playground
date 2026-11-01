// Sci-fi physics gun: view-model (bottom-right), energy beam, and force-based grab / push / pull /
// rotate / throw. Grabbing uses a critically-damped spring applied as impulses every fixed step,
// so held blocks are never teleported and keep their momentum when released.
import * as THREE from 'three';
import { GRAVITY } from '../physics/PhysicsWorld.js';

const GRAB_RANGE = 22;
const INSPECT_RANGE = 45;
const BASE_LIN_DAMP = 0.05;
const BASE_ANG_DAMP = 0.45;

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

export class PhysicsGun {
  constructor(game) {
    this.game = game;
    this.held = null;
    this.holdDist = 4;
    this.aimBlock = null;
    this.aimDist = 0;
    this.rotateMode = false;
    this.pulling = false;
    this.pullTarget = null;
    this.rotAccX = 0;
    this.rotAccY = 0;
    this.rotGesture = 0;
    this.cooldown = 0;
    this.recoil = 0;
    this.shotT = 0;
    this.shotTarget = new THREE.Vector3();
    this.beamColor = new THREE.Color('#4cc3ff');
    this.time = 0;
    this.camDir = new THREE.Vector3(0, 0, -1);
    this.camPos = new THREE.Vector3();

    this.buildViewModel();
    this.buildBeam();
  }

  // ------------------------------------------------------------------ view-model

  buildViewModel() {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x334466, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 2, 1.2);
    this.scene.add(key);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a6fe8, metalness: 0.65, roughness: 0.28, envMapIntensity: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14243f, metalness: 0.7, roughness: 0.38 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff });
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: 0.95 });

    const g = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.046, 0.058, 0.3, 14).rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.z = -0.02;
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.034, 0.24, 12).rotateX(Math.PI / 2), darkMat);
    barrel.position.z = -0.25;
    g.add(barrel);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 20), this.glowMat);
    tip.position.z = -0.37;
    g.add(tip);
    this.tip = tip;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 20), this.glowMat);
    ring2.position.z = -0.14;
    g.add(ring2);
    this.ring2 = ring2;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), this.coreMat);
    core.position.set(0, 0.062, -0.02);
    g.add(core);
    this.core = core;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.044, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.2 }),
    );
    shell.position.copy(core.position);
    g.add(shell);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.13, 0.065), darkMat);
    grip.position.set(0, -0.09, 0.07);
    grip.rotation.x = 0.35;
    g.add(grip);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.17), this.glowMat);
      fin.position.set(s * 0.05, 0.0, -0.02);
      g.add(fin);
    }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.4);
    g.add(this.muzzle);

    this.model = g;
    this.holder.add(g);
    g.scale.setScalar(0.78);
    this.baseOffset = new THREE.Vector3(0.115, -0.15, -0.36);
    g.rotation.y = 0.2;
    g.rotation.x = 0.02;
  }

  buildBeam() {
    const mk = (radius, alpha) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: { uColor: { value: new THREE.Color('#4cc3ff') }, uTime: { value: 0 }, uAlpha: { value: alpha }, uK: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uK;
          varying vec2 vUv;
          void main() {
            float stripes = 0.6 + 0.4 * sin(vUv.y * 34.0 * uK - uTime * 22.0);
            float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
            gl_FragColor = vec4(uColor * (0.8 + 0.5 * stripes), uAlpha * stripes * ends);
            #include <colorspace_fragment>
          }`,
      });
      const geo = new THREE.CylinderGeometry(radius, radius, 1, 8, 1, true);
      geo.translate(0, 0.5, 0);
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 8;
      this.game.scene.add(m);
      return m;
    };
    this.beamCore = mk(1, 0.9);
    this.beamGlow = mk(1, 0.28);
  }

  // ------------------------------------------------------------------ actions

  canAct() {
    return this.game.running;
  }

  toggleGrab() {
    if (this.held) {
      this.release(this.held);
      return;
    }
    const a = this.aimBlock;
    if (!a || this.aimDist > GRAB_RANGE) {
      this.game.audio.dry();
      this.kick(0.3);
      this.game.events.emit('toast', { text: 'Aim at a block, then press Grab', kind: 'hint' });
      return;
    }
    this.grab(a, this.aimDist);
  }

  grab(b, dist) {
    if (this.held) this.release(this.held, true);
    this.held = b;
    b.held = true;
    this.game.player.ignore = b.collider;
    this.holdDist = Math.max(1.5 + b.edge * 0.85, Math.min(dist, 11));
    b.collider.setCollisionGroups(0x0001fffd); // a held block passes through its owner, never shoves them
    b.body.wakeUp();
    b.body.setAngularDamping(3.5);
    b.body.setLinearDamping(BASE_LIN_DAMP);
    this.kick(0.6);
    this.beamColor.set('#4cc3ff');
    this.game.audio.grab();
    this.game.effects.emit(b.currPos, 10, { color: ['#7fe3ff', '#ffffff'], speed: 1.8, size: 0.1, life: 0.5, gravity: 0 });
    this.game.save.data.stats.grabs++;
    this.game.events.emit('gun', { kind: 'grab' });
  }

  release(b, quiet = false) {
    if (!b || this.held !== b) return;
    b.held = false;
    this.held = null;
    this.game.player.ignore = null;
    if (b.alive) {
      b.collider.setCollisionGroups(0xffffffff);
      b.body.setAngularDamping(BASE_ANG_DAMP);
      b.body.wakeUp();
    }
    this.rotateMode = false;
    this.game.events.emit('rotateMode', { on: false });
    if (!quiet) {
      this.game.audio.release();
      this.kick(0.25);
    }
    this.game.events.emit('gun', { kind: 'release' });
  }

  releaseAll() {
    if (this.held) this.release(this.held, true);
    this.pulling = false;
    this.pullTarget = null;
    this.aimBlock = null;
    this.shotT = 0;
  }

  onBlockRemoved(b) {
    if (this.held === b) {
      this.held = null;
      this.game.player.ignore = null;
      this.rotateMode = false;
      this.game.events.emit('rotateMode', { on: false });
    }
    if (this.aimBlock === b) this.aimBlock = null;
    if (this.pullTarget === b) this.pullTarget = null;
  }

  target(range = GRAB_RANGE + 8) {
    if (this.held) return { block: this.held, dist: this.held.currPos.distanceTo(this.camPos) };
    if (this.aimBlock && this.aimDist <= range) return { block: this.aimBlock, dist: this.aimDist };
    return null;
  }

  shot(point, color) {
    this.shotT = 0.16;
    this.shotTarget.copy(point);
    this.beamColor.set(color);
  }

  kick(a) {
    this.recoil = Math.min(1.2, this.recoil + a);
  }

  push() {
    if (this.cooldown > 0) return;
    this.cooldown = 0.2;
    const t = this.target(30);
    const dir = this.camDir;
    this.kick(0.9);
    if (!t) {
      this.game.audio.dry();
      _t.copy(this.camPos).addScaledVector(dir, 7);
      this.shot(_t, '#bfe9ff');
      this.muzzleBurst(dir);
      this.game.events.emit('toast', { text: 'Aim at a block to push it', kind: 'hint' });
      return;
    }
    const b = t.block;
    if (this.held === b) this.release(b, true);
    // impulse applied at an off-centre point -> the block also tumbles
    const dv = 7.5 / Math.sqrt(1 + b.mass / 160);
    _a.copy(b.currPos);
    _b.set((Math.random() - 0.5) * b.edge * 0.5, (Math.random() - 0.2) * b.edge * 0.4, (Math.random() - 0.5) * b.edge * 0.5);
    _a.add(_b);
    b.body.applyImpulseAtPoint({ x: dir.x * dv * b.mass, y: dir.y * dv * b.mass, z: dir.z * dv * b.mass }, { x: _a.x, y: _a.y, z: _a.z }, true);
    this.shot(b.currPos, '#ffffff');
    this.muzzleBurst(dir);
    this.game.effects.emit(b.currPos, 14, { color: ['#ffffff', '#9be9ff'], speed: 3, dir, dirPower: 2.2, size: 0.12, life: 0.45, gravity: 0 });
    this.game.audio.push();
    this.game.save.data.stats.pushes++;
    this.game.events.emit('gun', { kind: 'push' });
  }

  throwBlock() {
    if (this.cooldown > 0) return;
    this.cooldown = 0.25;
    const dir = this.camDir;
    this.kick(1.1);
    const sp = (b) => 17 / Math.sqrt(1 + b.mass / 220);
    if (this.held) {
      const b = this.held;
      this.release(b, true);
      const s = sp(b);
      const v = b.body.linvel();
      const ad = this.assist(b, dir);
      b.body.setLinvel({ x: v.x * 0.4 + ad.x * s, y: v.y * 0.4 + ad.y * s + (this.assisted ? 0.35 : 0.6), z: v.z * 0.4 + ad.z * s }, true);
      b.body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 }, true);
      this.finishThrow(b, dir);
      return;
    }
    const t = this.target(30);
    if (!t) {
      this.game.audio.dry();
      this.game.events.emit('toast', { text: 'Aim at a block, or grab one first', kind: 'hint' });
      return;
    }
    const b = t.block;
    const dv = sp(b) * 0.8;
    b.body.applyImpulseAtPoint(
      { x: dir.x * dv * b.mass, y: (dir.y * dv + 0.5) * b.mass, z: dir.z * dv * b.mass },
      { x: b.currPos.x, y: b.currPos.y + b.edge * 0.2, z: b.currPos.z },
      true,
    );
    this.finishThrow(b, dir);
  }

  /** Touch-friendly aim assist: bends a throw part-way toward a block that is nearly in line. */
  assist(from, dir) {
    const src = from.currPos;
    let best = null;
    let bestScore = 1;
    for (const o of this.game.blocks.blocks) {
      if (o === from || o.held) continue;
      _a.copy(o.currPos).sub(src);
      const d = _a.length();
      if (d < 0.8 || d > 18) continue;
      _a.divideScalar(d);
      const ang = Math.acos(Math.min(1, Math.max(-1, _a.dot(dir))));
      const lim = d < 6 ? 0.7 : 0.32; // wider cone for close targets (about 40 / 18 degrees)
      const score = ang / lim;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.assisted = false;
    if (!best) return dir;
    _b.copy(best.currPos).sub(src).normalize();
    _t.copy(dir).lerp(_b, 0.9).normalize();
    this.assisted = true;
    return new THREE.Vector3().copy(_t);
  }

  finishThrow(b, dir) {
    this.shot(b.currPos, '#ffe27a');
    this.muzzleBurst(dir);
    this.game.effects.emit(b.currPos, 18, { color: ['#ffe27a', '#ffffff'], speed: 2.6, dir, dirPower: 2.5, size: 0.13, life: 0.5, gravity: 0 });
    this.game.audio.throwSfx();
    this.game.save.data.stats.throws++;
    this.game.events.emit('gun', { kind: 'throw' });
  }

  setPull(on) {
    if (on === this.pulling) return;
    this.pulling = on;
    if (on) {
      const t = this.target(34);
      this.pullTarget = t ? t.block : null;
      if (!t) {
        this.game.audio.dry();
        this.game.events.emit('toast', { text: 'Aim at a block to pull it', kind: 'hint' });
      } else {
        this.game.audio.pullStart();
        this.game.save.data.stats.pulls++;
        this.game.events.emit('gun', { kind: 'pull' });
      }
    } else {
      this.pullTarget = null;
      this.game.audio.pullStop();
    }
  }

  toggleRotate() {
    if (!this.held) {
      this.rotateMode = false;
      this.game.events.emit('toast', { text: 'Grab a block first, then drag to rotate it', kind: 'hint' });
      this.game.events.emit('rotateMode', { on: false });
      return false;
    }
    this.rotateMode = !this.rotateMode;
    this.game.events.emit('rotateMode', { on: this.rotateMode });
    this.game.audio.click();
    return this.rotateMode;
  }

  /** Drag pixels while rotate mode is on. */
  rotateBy(dx, dy) {
    if (!this.held) return;
    this.rotAccX += dx;
    this.rotAccY += dy;
    this.rotGesture += Math.abs(dx) + Math.abs(dy);
    if (this.rotGesture > 140) {
      this.rotGesture = 0;
      this.game.save.data.stats.rotates++;
      this.game.events.emit('gun', { kind: 'rotate' });
    }
  }

  adjustDistance(d) {
    if (this.held) this.holdDist = Math.max(1.4 + this.held.edge * 0.85, Math.min(12, this.holdDist + d));
  }

  muzzleBurst(dir) {
    this.muzzle.getWorldPosition(_t);
    this.game.effects.emit(_t, 8, { color: ['#bfefff', '#ffffff'], speed: 1.6, dir, dirPower: 3.5, size: 0.07, life: 0.25, gravity: 0 });
  }

  // ------------------------------------------------------------------ simulation

  fixedPre(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    const camPos = this.camPos;
    const dir = this.camDir;

    const h = this.held;
    if (h) {
      const body = h.body;
      const t = body.translation();
      const v = body.linvel();
      // pull button shortens the hold distance
      if (this.pulling) this.holdDist = Math.max(1.4 + h.edge * 0.85, this.holdDist - 6 * dt);
      _a.set(camPos.x + dir.x * this.holdDist, camPos.y + dir.y * this.holdDist, camPos.z + dir.z * this.holdDist);
      const dx = _a.x - t.x;
      const dy = _a.y - t.y;
      const dz = _a.z - t.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 9 || h.currPos.distanceTo(camPos) > this.holdDist + 9) {
        this.game.events.emit('toast', { text: 'Lost grip!', kind: 'info' });
        this.release(h);
        return;
      }
      const k = 80 / (1 + h.mass / 110);
      const c = 2 * Math.sqrt(k) * 0.92;
      let ax = dx * k - v.x * c;
      let ay = dy * k - v.y * c;
      let az = dz * k - v.z * c;
      const al = Math.hypot(ax, ay, az);
      const maxA = 120;
      if (al > maxA) {
        const s = maxA / al;
        ax *= s;
        ay *= s;
        az *= s;
      }
      const m = h.mass;
      body.applyImpulse({ x: ax * m * dt, y: (ay - GRAVITY) * m * dt, z: az * m * dt }, true);

      // rotation from drag, otherwise strongly damped
      if (this.rotAccX !== 0 || this.rotAccY !== 0) {
        const gain = 0.011;
        _b.set(dir.x, 0, dir.z).normalize();
        _d.crossVectors(Y, _b).multiplyScalar(-1); // camera right (horizontal)
        const wy = (this.rotAccX * gain) / dt;
        const wr = (this.rotAccY * gain) / dt;
        let wx = Y.x * wy + _d.x * wr;
        let wyy = Y.y * wy + _d.y * wr;
        let wz = Y.z * wy + _d.z * wr;
        const wl = Math.hypot(wx, wyy, wz);
        if (wl > 14) {
          const s = 14 / wl;
          wx *= s;
          wyy *= s;
          wz *= s;
        }
        body.setAngvel({ x: wx, y: wyy, z: wz }, true);
        this.rotAccX = this.rotAccY = 0;
      }
    } else if (this.pulling && this.pullTarget && this.pullTarget.alive) {
      const b = this.pullTarget;
      const t = b.body.translation();
      _a.set(camPos.x - t.x, camPos.y - 0.4 - t.y, camPos.z - t.z);
      const d = _a.length();
      if (d < 2.6 + b.edge) {
        // caught: seamlessly turn into a normal grab
        this.pulling = false;
        this.pullTarget = null;
        this.game.audio.pullStop();
        this.grab(b, 2.6 + b.edge);
        this.game.events.emit('pullDone', {});
      } else {
        _a.normalize();
        const v = b.body.linvel();
        const accel = 26;
        const m = b.mass;
        b.body.applyImpulse(
          { x: (_a.x * accel - v.x * 0.9 + 0) * m * dt, y: (_a.y * accel + -GRAVITY * 0.9 - v.y * 0.9) * m * dt, z: (_a.z * accel - v.z * 0.9) * m * dt },
          true,
        );
        b.mergeCd = Math.max(b.mergeCd, 0.05);
      }
    }
  }

  // ------------------------------------------------------------------ per-frame

  /** Aim ray + view-model + beam. Called after the camera has been placed. */
  update(dt, time, camera, player) {
    this.time = time;
    this.camPos.copy(camera.position);
    camera.getWorldDirection(this.camDir);

    // aim with a tiny aim-assist cone
    let hit = this.game.blocks.aim(this.camPos, this.camDir, INSPECT_RANGE, player.body);
    if (!hit) {
      const right = _b.crossVectors(this.camDir, Y).normalize();
      const up = _d.crossVectors(right, this.camDir).normalize();
      const off = 0.07;
      const tries = [
        [off, 0],
        [-off, 0],
        [0, off],
        [0, -off],
      ];
      for (const [rx, ry] of tries) {
        _a.copy(this.camDir).addScaledVector(right, rx).addScaledVector(up, ry).normalize();
        hit = this.game.blocks.aim(this.camPos, _a, INSPECT_RANGE, player.body);
        if (hit) break;
      }
    }
    const prev = this.aimBlock;
    if (this.held) {
      this.aimBlock = this.held;
      this.aimDist = this.held.currPos.distanceTo(this.camPos);
    } else if (hit) {
      this.aimBlock = hit.block;
      this.aimDist = hit.dist;
    } else {
      this.aimBlock = null;
      this.aimDist = 0;
    }
    if (prev && prev !== this.aimBlock) prev.glow = 0;
    if (this.aimBlock) this.aimBlock.glow = this.held ? 1 : this.aimDist <= GRAB_RANGE ? 0.55 : 0.25;

    this.updateViewModel(dt, time, camera, player);
    this.updateBeam(dt, time);
  }

  updateViewModel(dt, time, camera, player) {
    this.recoil *= Math.exp(-dt * 9);
    const bob = Math.min(1, player.speed / 4.6);
    const sx = Math.sin(time * 7.5) * 0.004 * bob;
    const sy = Math.abs(Math.cos(time * 7.5)) * 0.005 * bob + Math.sin(time * 1.3) * 0.0012;
    this.holder.position.set(this.baseOffset.x + sx, this.baseOffset.y + sy, this.baseOffset.z + this.recoil * 0.045);
    this.holder.rotation.x = this.recoil * 0.08;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    this.root.updateMatrixWorld(true);

    const charge = this.held ? 1 : this.pulling ? 0.8 : 0;
    const pulse = 0.5 + 0.5 * Math.sin(time * 9);
    this.core.scale.setScalar(1 + 0.25 * charge * pulse + this.recoil * 0.4);
    this.coreMat.color.setRGB(0.5 + 0.3 * charge, 0.9, 1.0);
    this.ring2.rotation.z = time * (1 + charge * 6);
    this.tip.scale.setScalar(1 + this.recoil * 0.35);
    this.glowMat.color.setRGB(0.35 + 0.35 * charge + this.recoil * 0.3, 0.85, 1.0);
  }

  updateBeam(dt, time) {
    let show = false;
    let target = null;
    if (this.held) {
      show = true;
      target = this.held.mesh.position;
      this.beamColor.set(this.rotateMode ? '#c58bff' : '#4cc3ff');
    } else if (this.pulling && this.pullTarget && this.pullTarget.alive) {
      show = true;
      target = this.pullTarget.mesh.position;
      this.beamColor.set('#7bf0a0');
    } else if (this.shotT > 0) {
      this.shotT -= dt;
      show = this.shotT > 0;
      target = this.shotTarget;
    }
    if (!show) {
      this.beamCore.visible = this.beamGlow.visible = false;
      return;
    }
    this.muzzle.getWorldPosition(_a);
    _b.copy(target).sub(_a);
    const len = _b.length();
    if (len < 0.05) {
      this.beamCore.visible = this.beamGlow.visible = false;
      return;
    }
    _b.divideScalar(len);
    _q.setFromUnitVectors(Y, _b);
    const pulse = 1 + 0.2 * Math.sin(time * 30);
    const flick = this.shotT > 0 ? Math.max(0.2, this.shotT / 0.16) : 1;
    for (const [m, r] of [
      [this.beamCore, 0.014 * pulse * flick],
      [this.beamGlow, 0.05 * pulse * flick],
    ]) {
      m.visible = true;
      m.position.copy(_a);
      m.quaternion.copy(_q);
      m.scale.set(r, len, r);
      m.material.uniforms.uColor.value.copy(this.beamColor);
      m.material.uniforms.uTime.value = time;
      m.material.uniforms.uK.value = Math.max(0.5, len / 5);
    }
    // sparks drifting along the beam
    if (this.held && Math.random() < dt * 22) {
      _t.copy(_a).addScaledVector(_b, Math.random() * len);
      this.game.effects.emit(_t, 1, { color: ['#9be9ff'], speed: 0.4, size: 0.06, life: 0.35, gravity: 0 });
    }
  }

  setLightEnv(env) {
    this.scene.environment = env;
  }
}
