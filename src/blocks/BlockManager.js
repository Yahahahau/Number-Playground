// All number blocks: creation, rendering, merging with momentum transfer, buoyancy, limits, reset.
import * as THREE from 'three';
import { getBlockGeometry, LabelCache, CORNER } from './BlockAssets.js';
import { edgeOf, massOf, tierPos, tierColor, tierIndex, fmtCompact } from '../core/bignum.js';
import { terrainHeight, POND, WATER_Y, WORLD_HALF, inPond, START } from '../world/terrain.js';
import { GRAVITY } from '../physics/PhysicsWorld.js';
import { FX_LIST } from '../collection/Daily.js';

export const MAX_BLOCKS = 36;
export const WARN_BLOCKS = 30;
const MERGE_SPEED = 2.1; // minimum relative speed (m/s) for a collision to merge
const WATER_DENSITY = 95; // effective fluid density (block density is 40 -> floats ~45% submerged)

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _q2 = new THREE.Quaternion();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Block {
  constructor() {
    this.alive = true;
    this.mergeCd = 0;
    this.vel0 = new THREE.Vector3();
    this.ang0 = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.color = new THREE.Color();
    this.glow = 0; // 0..1 highlight requested by the gun (aimed / held)
    this.glowCur = 0;
    this.appear = 0; // 0..1 spawn animation
    this.sub = 0; // submerged fraction
    this.inWater = false;
    this.wakeT = 0;
    this.held = false;
  }
}

export class BlockManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.physics = game.physics;
    this.R = game.physics.RAPIER;
    this.geometry = getBlockGeometry();
    this.labels = new LabelCache(game.maxAniso);
    this.blocks = [];
    this.byCollider = new Map();
    this.nextId = 1;
    this.mergeQueue = [];
    this.deferred = [];
    this.foamList = [];
    this.time = 0;

    // soft contact shadows (in addition to real shadow-map shadows)
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.shStrength = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOCKS), 1);
    sg.setAttribute('aStrength', this.shStrength);
    this.contact = new THREE.InstancedMesh(
      sg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        vertexShader: /* glsl */ `
          attribute float aStrength; varying float vS; varying vec2 vUv;
          void main() {
            vS = aStrength; vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying float vS; varying vec2 vUv;
          void main() {
            float d = length(vUv * 2.0 - 1.0);
            float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.4) * vS * 0.55;
            if (a < 0.01) discard;
            gl_FragColor = vec4(0.02, 0.05, 0.02, a);
          }`,
      }),
      MAX_BLOCKS,
    );
    this.contact.frustumCulled = false;
    this.contact.count = 0;
    this.contact.renderOrder = 1;
    this.scene.add(this.contact);
  }

  get count() {
    return this.blocks.length;
  }

  // ------------------------------------------------------------------ creation / removal

  create(value, pos, o = {}) {
    const R = this.R;
    const b = new Block();
    b.id = this.nextId++;
    b.value = value;
    b.edge = edgeOf(value);
    b.mass = massOf(b.edge);
    b.tier = tierPos(value);

    const h = b.edge / 2;
    const r = b.edge * CORNER;
    const rb = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(o.quat || { x: 0, y: 0, z: 0, w: 1 })
        .setLinvel(o.vel?.x || 0, o.vel?.y || 0, o.vel?.z || 0)
        .setAngvel(o.ang || { x: 0, y: 0, z: 0 })
        .setLinearDamping(0.05)
        .setAngularDamping(0.45)
        .setCcdEnabled(true),
    );
    const col = this.physics.world.createCollider(
      R.ColliderDesc.roundCuboid(h - r, h - r, h - r, r)
        .setMass(b.mass)
        .setFriction(0.8)
        .setRestitution(0.18)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      rb,
    );
    b.body = rb;
    b.collider = col;

    // visuals
    b.labelEntry = this.labels.acquire(value);
    tierColor(b.tier, b.color, 0);
    if (o.fromColor) b.color.copy(o.fromColor);
    b.matBlock = new THREE.MeshStandardMaterial({
      color: b.color.clone(),
      roughness: 0.3,
      metalness: 0.08,
      emissive: b.color.clone(),
      emissiveIntensity: 0.12,
      envMapIntensity: 0.9,
    });
    b.matLabel = new THREE.MeshBasicMaterial({
      map: b.labelEntry.tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    b.mesh = new THREE.Mesh(this.geometry, [b.matBlock, b.matLabel]);
    b.mesh.scale.setScalar(b.edge);
    b.mesh.castShadow = true;
    b.mesh.receiveShadow = true;
    b.mesh.position.copy(pos);
    this.scene.add(b.mesh);

    b.tagMat = new THREE.SpriteMaterial({
      map: b.labelEntry.tex,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    b.tag = new THREE.Sprite(b.tagMat);
    b.tag.visible = false;
    b.tag.renderOrder = 4;
    this.scene.add(b.tag);

    b.prevPos.copy(pos);
    b.currPos.copy(pos);
    const qq = o.quat || { x: 0, y: 0, z: 0, w: 1 };
    b.prevQuat.set(qq.x, qq.y, qq.z, qq.w);
    b.currQuat.copy(b.prevQuat);
    b.mergeCd = o.mergeCd ?? 0.3;
    b.appear = o.appear === false ? 1 : 0;
    this.blocks.push(b);
    this.byCollider.set(col.handle, b);
    return b;
  }

  remove(b) {
    if (!b.alive) return;
    b.alive = false;
    this.game.gun?.onBlockRemoved(b);
    this.byCollider.delete(b.collider.handle);
    this.physics.removeBody(b.body);
    this.scene.remove(b.mesh);
    this.scene.remove(b.tag);
    b.matBlock.dispose();
    b.matLabel.dispose();
    b.tagMat.dispose();
    this.labels.release(b.labelEntry);
    const i = this.blocks.indexOf(b);
    if (i >= 0) this.blocks.splice(i, 1);
  }

  // ------------------------------------------------------------------ spawning

  /** Finds a free spot in front of the player; null if the world is full. */
  trySpawnInFront(value, { silent = false } = {}) {
    if (this.count >= MAX_BLOCKS) {
      this.game.events.emit('toast', { text: `Block limit reached (${MAX_BLOCKS}). Merge or reset blocks.`, kind: 'warn' });
      return null;
    }
    const p = this.game.player;
    const edge = edgeOf(value);
    const fwd = p.forward(_v).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const base = p.position;
    const dists = [3.2 + edge, 4.4 + edge, 5.6 + edge * 1.2, 2.6 + edge];
    const lats = [0, 1.3, -1.3, 2.4, -2.4];
    let found = null;
    outer: for (const d of dists) {
      for (const l of lats) {
        const x = base.x + fwd.x * d + right.x * l;
        const z = base.z + fwd.z * d + right.z * l;
        if (inPond(x, z, 1)) continue;
        if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
        const y = terrainHeight(x, z) + edge / 2 + 0.6;
        for (let lift = 0; lift < 3; lift++) {
          const pos = { x, y: y + lift * (edge + 0.15), z };
          if (!this.physics.boxOverlaps(pos, edge / 2 + 0.05)) {
            found = pos;
            break outer;
          }
        }
      }
    }
    if (!found) {
      this.game.events.emit('toast', { text: 'No free space here. Move and try again.', kind: 'warn' });
      return null;
    }
    const b = this.create(value, found, { mergeCd: 0.6 });
    if (!silent) {
      this.game.save.data.stats.spawned++;
      this.game.save.save();
      this.spawnFx(b);
      this.game.audio.spawn(value);
    }
    if (this.count >= WARN_BLOCKS) {
      this.game.events.emit('toast', { text: `Blocks ${this.count}/${MAX_BLOCKS} - nearly full`, kind: 'warn' });
    }
    return b;
  }

  spawnFx(b) {
    const fx = this.game.effects;
    const p = b.currPos;
    fx.flash(p, this.fxColors(b)[0], 2.4 + b.edge, 0.45);
    fx.ring(p, this.fxColors(b)[0], 2.4 + b.edge, 0.55, false);
    fx.emit(p, 26, { color: this.fxColors(b), speed: 2.6, up: 1.2, size: 0.13, life: 0.8, gravity: 2.5 });
  }

  fxColors(b) {
    const sel = this.game.save.data.rewards.selectedFx;
    const f = FX_LIST.find((x) => x.id === sel);
    if (f && f.colors) return f.colors.map((c) => new THREE.Color(c));
    tierColor(b.tier, _c, this.time);
    return [_c.clone().lerp(new THREE.Color('#ffffff'), 0.25), _c.clone()];
  }

  spawnInitial() {
    const p = this.game.player.position;
    const f = this.game.player.forward(new THREE.Vector3()).setY(0).normalize();
    const a = { x: p.x + f.x * 3.0, y: 0, z: p.z + f.z * 3.0 };
    a.y = terrainHeight(a.x, a.z) + 0.5;
    const bpos = { x: p.x - f.x * 2.7 + 0.5, y: 0, z: p.z - f.z * 2.7 };
    bpos.y = terrainHeight(bpos.x, bpos.z) + 0.5;
    this.create(1n, a, { appear: true, mergeCd: 1 });
    this.create(1n, bpos, { appear: true, mergeCd: 1 });
  }

  /** Removes every block (never touches the collection / save data) and restores the starting pair. */
  reset() {
    this.game.gun.releaseAll();
    this.mergeQueue.length = 0;
    this.deferred.length = 0;
    for (const b of [...this.blocks]) this.remove(b);
    this.game.effects.clear();
    this.game.water.setFoamSources([]);
    this.spawnInitial();
  }

  // ------------------------------------------------------------------ queries

  /** Ray against blocks only. Returns { block, dist } or null. */
  aim(origin, dir, maxDist, exclude) {
    const hit = this.physics.raycast(origin, dir, maxDist, exclude);
    if (!hit) return null;
    const b = this.byCollider.get(hit.collider.handle);
    return b ? { block: b, dist: hit.toi } : null;
  }

  // ------------------------------------------------------------------ physics step hooks

  fixedPre(dt) {
    const surf = WATER_Y;
    for (const b of this.blocks) {
      const body = b.body;
      const lv = body.linvel();
      const av = body.angvel();
      b.vel0.set(lv.x, lv.y, lv.z);
      b.ang0.set(av.x, av.y, av.z);
      if (b.mergeCd > 0) b.mergeCd -= dt;

      if (body.isSleeping()) continue;
      const t = body.translation();
      const dPond = Math.hypot(t.x - POND.x, t.z - POND.z);
      let sub = 0;
      if (dPond < POND.bowl && t.y < surf + b.edge && inPond(t.x, t.z, 0)) {
        const rot = body.rotation();
        _q.set(rot.x, rot.y, rot.z, rot.w);
        const h = b.edge / 2;
        const V = b.edge * b.edge * b.edge;
        const fUnit = (WATER_DENSITY * V * Math.abs(GRAVITY)) / 8;
        const wy = this.game.water.surfaceY(t.x, t.z);
        for (let i = 0; i < 8; i++) {
          _v.set(i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h).applyQuaternion(_q);
          const py = t.y + _v.y;
          const s = Math.min(1, Math.max(0, (wy - py) / b.edge + 0.5));
          if (s > 0) {
            sub += s / 8;
            body.applyImpulseAtPoint({ x: 0, y: fUnit * s * dt, z: 0 }, { x: t.x + _v.x, y: py, z: t.z + _v.z }, true);
          }
        }
      }
      if (sub > 0.001 || b.sub > 0.001) {
        body.setLinearDamping(0.05 + 2.4 * sub);
        body.setAngularDamping(0.45 + 3.2 * sub);
      }
      b.sub = sub;
    }
  }

  onCollision(h1, h2) {
    const a = this.byCollider.get(h1);
    const b = this.byCollider.get(h2);
    if (a && b) this.mergeQueue.push([a, b]);
    else if (a || b) {
      // block hitting the world / a tree: audible thud
      const blk = a || b;
      const speed = blk.vel0.length();
      if (speed > 1.2) this.game.audio.impact(speed, blk.edge, !!blk.inWater);
    }
  }

  fixedPost(dt) {
    // merges (queued so we never delete bodies while Rapier is iterating events)
    if (this.mergeQueue.length) {
      const q = this.mergeQueue.splice(0);
      for (const [a, b] of q) this.tryMerge(a, b);
    }
    if (this.deferred.length) {
      const keep = [];
      for (const d of this.deferred) {
        d.t -= dt;
        if (!d.a.alive || !d.b.alive || d.t <= 0) continue;
        if (d.a.mergeCd > 0 || d.b.mergeCd > 0) {
          keep.push(d);
          continue;
        }
        if (d.a.currPos.distanceTo(d.b.currPos) < (d.a.edge + d.b.edge) * 0.5 + 0.4) this.tryMerge(d.a, d.b, d.rel);
      }
      this.deferred = keep;
    }
    const player = this.game.player;
    for (const b of [...this.blocks]) {
      if (!b.alive) continue;
      const body = b.body;
      b.prevPos.copy(b.currPos);
      b.prevQuat.copy(b.currQuat);
      if (body.isSleeping()) continue;
      const t = body.translation();
      const r = body.rotation();
      if (!Number.isFinite(t.x + t.y + t.z)) {
        this.returnBlock(b);
        continue;
      }
      b.currPos.set(t.x, t.y, t.z);
      b.currQuat.set(r.x, r.y, r.z, r.w);

      // out of the play area -> bring it back
      if (t.y < -9 || Math.abs(t.x) > WORLD_HALF + 5 || Math.abs(t.z) > WORLD_HALF + 5 || t.y > 120) {
        this.returnBlock(b);
        continue;
      }
      this.waterEvents(b, dt);
    }
  }

  returnBlock(b) {
    const p = this.game.player;
    const f = p.forward(new THREE.Vector3()).setY(0).normalize();
    const x = p.position.x + f.x * 3;
    const z = p.position.z + f.z * 3;
    const y = terrainHeight(x, z) + b.edge + 1.2;
    this.game.gun.release(b);
    b.body.setTranslation({ x, y, z }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.currPos.set(x, y, z);
    b.prevPos.copy(b.currPos);
    this.game.events.emit('toast', { text: 'A block wandered off and was returned.', kind: 'info' });
  }

  waterEvents(b, dt) {
    const wasIn = b.inWater;
    const nowIn = b.sub > 0.05;
    const t = b.currPos;
    if (nowIn && !wasIn) {
      const speed = Math.max(Math.abs(b.vel0.y), b.vel0.length() * 0.8);
      if (speed > 1.4) {
        const surf = WATER_Y;
        this.game.effects.splash(_v.set(t.x, surf, t.z), speed * (0.6 + b.edge * 0.5));
        this.game.water.addRipple(t.x, t.z, Math.min(1.7, 0.45 + speed * 0.09 * (0.6 + b.edge)));
        this.game.audio.splash(Math.min(1, speed / 9));
        this.game.save.data.stats.splashes++;
        this.game.events.emit('splash', { block: b });
      }
    }
    b.inWater = nowIn;
    if (nowIn) {
      // wake while moving
      b.wakeT -= dt;
      const sp = Math.hypot(b.vel0.x, b.vel0.z);
      if (b.wakeT <= 0 && sp > 0.5) {
        b.wakeT = 0.2;
        this.game.water.addRipple(t.x, t.z, Math.min(0.7, 0.14 + sp * 0.08));
      } else if (b.wakeT <= 0) {
        b.wakeT = 0.9; // gentle bobbing ripple
        this.game.water.addRipple(t.x, t.z, 0.12);
      }
    }
  }

  // ------------------------------------------------------------------ merging

  tryMerge(a, b, relOverride = null) {
    if (!a.alive || !b.alive || a === b) return;
    const rel = relOverride ?? _v.copy(a.vel0).sub(b.vel0).length();
    if (rel < MERGE_SPEED) return;
    if (a.mergeCd > 0 || b.mergeCd > 0) {
      // a real impact that landed during a short cool-down is retried instead of being lost
      if (relOverride === null) this.deferred.push({ a, b, rel, t: 0.6 });
      return;
    }

    const value = a.value + b.value;
    const M = a.mass + b.mass;
    const pa = a.currPos.clone();
    const pb = b.currPos.clone();
    const p = pa.clone().multiplyScalar(a.mass).addScaledVector(pb, b.mass).divideScalar(M);

    // linear momentum
    const v = a.vel0.clone().multiplyScalar(a.mass).addScaledVector(b.vel0, b.mass).divideScalar(M);

    // angular momentum about the merge point: spin of each block + orbital part
    const Ia = (a.mass * a.edge * a.edge) / 6;
    const Ib = (b.mass * b.edge * b.edge) / 6;
    const L = new THREE.Vector3()
      .addScaledVector(a.ang0, Ia)
      .addScaledVector(b.ang0, Ib)
      .add(pa.clone().sub(p).cross(a.vel0).multiplyScalar(a.mass))
      .add(pb.clone().sub(p).cross(b.vel0).multiplyScalar(b.mass));
    const newEdge = edgeOf(value);
    const Inew = (M * newEdge * newEdge) / 6;
    const w = L.divideScalar(Inew);
    if (w.length() > 12) w.setLength(12);

    // a little extra "pop" so the merge feels energetic
    v.y += 1.7;
    const ground = terrainHeight(p.x, p.z);
    if (p.y < ground + newEdge / 2 + 0.05) p.y = ground + newEdge / 2 + 0.05;

    const fromColor = a.color.clone().lerp(b.color, b.mass / M);
    const q = new THREE.Quaternion().copy(a.mass >= b.mass ? a.currQuat : b.currQuat);
    this.remove(a);
    this.remove(b);
    const nb = this.create(value, p, {
      vel: v,
      ang: w,
      quat: q,
      fromColor,
      mergeCd: 0.55,
      appear: false,
    });
    nb.appear = 0.55; // quick pop-in
    nb.merged = true;
    this.shockwave(nb, p);
    this.mergeFx(nb, p, a.value, b.value, rel);

    const res = this.game.collection.discover(value);
    const st = this.game.save.data.stats;
    st.merges++;
    this.game.save.save(res.isNew);
    this.game.events.emit('merge', { value, a: a.value, b: b.value, isNew: res.isNew, isRecord: res.isRecord, block: nb });
    this.game.audio.merge(value, res.isNew, res.isRecord);
  }

  shockwave(nb, p) {
    const R = 3.2 + nb.edge * 1.5;
    for (const o of this.blocks) {
      if (o === nb || o.held) continue;
      const d = o.currPos.distanceTo(p);
      if (d > R || d < 0.05) continue;
      const k = (1 - d / R) ** 2;
      const dir = o.currPos.clone().sub(p).setY(0).normalize();
      dir.y = 0.35;
      const dv = 2.0 * k; // stays below MERGE_SPEED, so a shockwave never causes chain merges
      o.body.applyImpulse({ x: dir.x * dv * o.mass, y: dir.y * dv * o.mass, z: dir.z * dv * o.mass }, true);
      o.mergeCd = Math.max(o.mergeCd, 0.35);
    }
  }

  mergeFx(nb, p, av, bv, rel) {
    const fx = this.game.effects;
    const cols = this.fxColors(nb);
    const power = Math.min(1.8, 0.8 + tierIndex(nb.tier) * 0.12);
    fx.flash(p, cols[0], (3 + nb.edge * 2) * power, 0.5);
    fx.ring(p, cols[0], (3.4 + nb.edge * 2) * power, 0.6, false);
    fx.ring(p.clone().setY(Math.max(p.y - nb.edge * 0.4, terrainHeight(p.x, p.z) + 0.05)), cols[cols.length - 1], (4.2 + nb.edge * 2.5) * power, 0.75, true);
    fx.emit(p, 40 + Math.min(40, tierIndex(nb.tier) * 8), { color: cols, speed: 3.6 + rel * 0.15, up: 1.6, size: 0.15, life: 0.9, gravity: 4.5 });
    this.game.events.emit('mergeToast', { text: `${fmtCompact(av)} + ${fmtCompact(bv)} = ${fmtCompact(nb.value)}`, color: '#' + cols[0].getHexString?.() });
  }

  // ------------------------------------------------------------------ per-frame rendering

  render(alpha, dt, time, camera) {
    this.time = time;
    let ci = 0;
    this.foamList.length = 0;
    const cp = camera.position;
    for (const b of this.blocks) {
      // interpolated transform
      b.mesh.position.lerpVectors(b.prevPos, b.currPos, alpha);
      b.mesh.quaternion.slerpQuaternions(b.prevQuat, b.currQuat, alpha);

      // colour transition (+ rainbow tier)
      tierColor(b.tier, _c, time);
      b.color.lerp(_c, 1 - Math.exp(-dt * 5));
      b.matBlock.color.copy(b.color);
      b.glowCur += (b.glow - b.glowCur) * (1 - Math.exp(-dt * 14));
      b.matBlock.emissive.copy(b.color);
      b.matBlock.emissiveIntensity = 0.1 + b.glowCur * 0.42;

      // pop-in animation
      if (b.appear < 1) {
        b.appear = Math.min(1, b.appear + dt / 0.38);
        const t = b.appear - 1;
        const s = 1 + 2.7 * t * t * t + 1.7 * t * t; // easeOutBack
        b.mesh.scale.setScalar(Math.max(0.001, b.edge * s));
      } else if (b.mesh.scale.x !== b.edge) b.mesh.scale.setScalar(b.edge);

      // distant billboard tag so the value stays readable from far away
      const dist = b.mesh.position.distanceTo(cp);
      if (dist > 8 && dist < 70) {
        b.tag.visible = true;
        b.tag.position.set(b.mesh.position.x, b.mesh.position.y + b.edge * 0.5 + 0.55 + dist * 0.01, b.mesh.position.z);
        const s = Math.min(5, Math.max(1.0, dist * 0.085));
        b.tag.scale.set(s, s, 1);
      } else b.tag.visible = false;

      // contact shadow
      if (ci < MAX_BLOCKS) {
        const x = b.mesh.position.x;
        const z = b.mesh.position.z;
        const gy = terrainHeight(x, z);
        const hgt = b.mesh.position.y - b.edge / 2 - gy;
        const wet = inPond(x, z, 0.2);
        const strength = wet ? 0 : Math.max(0, Math.min(1, 1 - hgt / 4.5));
        const size = b.edge * (1.55 + Math.max(0, hgt) * 0.12);
        _q2.identity();
        _s.set(size, 1, size);
        _m.compose(_v2.set(x, gy + 0.07, z), _q2, _s);
        this.contact.setMatrixAt(ci, _m);
        this.shStrength.setX(ci, strength);
        ci++;
      }

      if (b.sub > 0.05 && this.foamList.length < 8) {
        this.foamList.push({ x: b.mesh.position.x, z: b.mesh.position.z, r: b.edge * 0.75, k: Math.min(0.9, 0.25 + b.sub * 1.6) });
      }
    }
    this.contact.count = ci;
    this.contact.instanceMatrix.needsUpdate = true;
    this.shStrength.needsUpdate = true;
    this.game.water.setFoamSources(this.foamList);
  }
}

export { START };
