// Futuristic Number Lab: one flat metallic floor, a glowing force-field rim, a few geometric pylons,
// a big energy ring as the landmark, and a static space skybox. A single Challenge pad is hidden
// until Challenge mode turns it on. Everything is static (no per-frame work except the sky follow).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSky, HORIZON } from './Sky.js';
import { paintFloor, toTexture } from './SpaceArt.js';
import { WORLD_HALF, FLOOR_HALF, PAD } from './terrain.js';

const CYAN = 0x18d8ff;
const BLUE = 0x2a6bff;
const VIOLET = 0x8a3cff;
const MAGENTA = 0xff2bd0;

export class World {
  constructor(scene, physics, quality) {
    this.scene = scene;
    this.physics = physics;
    this.quality = quality;
    this.sunDir = new THREE.Vector3(0.35, 0.8, 0.45).normalize();
    this.windUniform = { value: 0 }; // legacy, unused
    this.padOn = false;

    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), quality.fog[0], quality.fog[1]);

    this.sky = createSky();
    scene.add(this.sky);

    this.buildLights();
    this.buildFloor();
    this.buildRim();
    this.buildRing();
    this.buildPad();
    this.buildBoundary();
    this.setQuality(quality);
  }

  // ------------------------------------------------------------------ lights

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xa8d8ff, 0x3a2878, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xdff2ff, 2.2);
    // small biases: just enough to avoid acne, without lifting the shadow off the floor (no gap under blocks)
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 125;
    this.sun.castShadow = false; // real-time shadows are opt-in (Settings)
    this.shadowsOn = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  setShadows(on) {
    this.shadowsOn = on;
    this.sun.castShadow = on;
  }

  setShadowRange(r) {
    const c = this.sun.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.updateProjectionMatrix();
    this.shadowRange = r;
  }

  // ------------------------------------------------------------------ floor

  buildFloor() {
    const [alb, emi] = paintFloor();
    const tiles = (FLOOR_HALF * 2) / 16;
    const map = toTexture(alb, { repeat: true, aniso: 4 });
    const emissiveMap = toTexture(emi, { repeat: true, aniso: 4 });
    map.repeat.set(tiles, tiles);
    emissiveMap.repeat.set(tiles, tiles);
    const geo = new THREE.PlaneGeometry(FLOOR_HALF * 2, FLOOR_HALF * 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      roughness: 0.42,
      metalness: 0.65,
      envMapIntensity: 0.9,
    });
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // flat static collider (same friction / restitution the old terrain used)
    const R = this.physics.RAPIER;
    this.physics.addStaticCollider(
      R.ColliderDesc.cuboid(FLOOR_HALF + 20, 2, FLOOR_HALF + 20).setTranslation(0, -2, 0).setFriction(0.8).setRestitution(0.1),
    );
  }

  // ------------------------------------------------------------------ rim: glowing edge, force field, pylons

  buildRim() {
    const E = FLOOR_HALF;
    // glowing edge strips (one merged mesh)
    const strips = [];
    const L = E * 2 + 1.2;
    for (const [x, z, sx, sz] of [[0, E, L, 0.5], [0, -E, L, 0.5], [E, 0, 0.5, L], [-E, 0, 0.5, L]]) {
      strips.push(new THREE.BoxGeometry(sx, 0.18, sz).translate(x, 0.09, z));
    }
    const edge = new THREE.Mesh(mergeGeometries(strips), new THREE.MeshBasicMaterial({ color: CYAN }));
    this.scene.add(edge);

    // force field: four vertical additive planes fading upwards
    const ff = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          float h = 1.0 - vUv.y;
          float a = pow(h, 2.2) * 0.55;
          float grid = step(0.93, fract(vUv.x * 40.0)) * 0.35 + step(0.94, fract(vUv.y * 5.0)) * 0.3;
          vec3 c = mix(vec3(0.05,0.55,1.0), vec3(0.6,0.2,1.0), vUv.y);
          gl_FragColor = vec4(c * (a + grid * h), 1.0);
        }`,
    });
    const H = 9;
    const planes = [];
    for (const [x, z, ry] of [[0, E, Math.PI], [0, -E, 0], [E, 0, -Math.PI / 2], [-E, 0, Math.PI / 2]]) {
      const pg = new THREE.PlaneGeometry(E * 2, H).translate(0, H / 2, 0);
      pg.rotateY(ry);
      pg.translate(x, 0, z);
      planes.push(pg);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(planes), ff));

    // geometric pylons just outside the rim (instanced, dark metal with a glowing stripe)
    const body = new THREE.BoxGeometry(2.2, 1, 2.2).translate(0, 0.5, 0);
    const pylons = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x141c38, roughness: 0.4, metalness: 0.8 }), 28);
    const stripe = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 2.3).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: VIOLET }), 28);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    const out = E + 3.2;
    for (let k = 0; k < 7; k++) {
      const t = -E + 8 + (k * (E * 2 - 16)) / 6;
      for (const [x, z, ry] of [[t, out, 0], [t, -out, 0], [out, t, Math.PI / 2], [-out, t, Math.PI / 2]]) {
        const h = 3 + ((k * 7 + i) % 4) * 1.6;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, h, 1));
        pylons.setMatrixAt(i, m);
        stripe.setMatrixAt(i, m);
        i++;
      }
    }
    this.scene.add(pylons, stripe);
  }

  // ------------------------------------------------------------------ landmark energy ring

  buildRing() {
    const g = new THREE.Group();
    const z = -(FLOOR_HALF + 8);
    const R = 17;
    const outer = new THREE.Mesh(new THREE.TorusGeometry(R, 0.7, 10, 72), new THREE.MeshBasicMaterial({ color: CYAN }));
    const mid = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, 0.35, 8, 64), new THREE.MeshBasicMaterial({ color: MAGENTA }));
    const inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.22, 8, 56), new THREE.MeshBasicMaterial({ color: VIOLET }));
    const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 48), new THREE.MeshBasicMaterial({ color: 0x1a46ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    g.add(outer, mid, inner, core);
    // base pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x141c38, roughness: 0.4, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, R * 0.55, 2.4), pillarMat);
      p.position.set(sx * R * 0.9, R * 0.27, 0);
      g.add(p);
    }
    g.position.set(0, R + 2, z);
    this.ring = g;
    this.scene.add(g);
  }

  // ------------------------------------------------------------------ challenge pad (shared map, toggled)

  buildPad() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(PAD.r, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0a2a55, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    disc.position.y = 0.02;
    this.padRing = new THREE.Mesh(new THREE.RingGeometry(PAD.r - 0.25, PAD.r, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: CYAN }));
    this.padRing.position.y = 0.04;
    const inner = new THREE.Mesh(new THREE.RingGeometry(PAD.r * 0.55, PAD.r * 0.6, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: MAGENTA }));
    inner.position.y = 0.04;
    // beam of light above the pad
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD.r * 0.85, PAD.r * 0.85, 12, 32, 1, true).translate(0, 6, 0),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
    );
    g.add(disc, this.padRing, inner, beam);
    g.position.set(PAD.x, 0, PAD.z);
    g.visible = false;
    this.pad = g;
    this.scene.add(g);
  }

  setPad(on, ok = false) {
    this.padOn = on;
    this.pad.visible = on;
    this.padRing.material.color.setHex(ok ? 0x48ffa0 : CYAN);
  }

  // ------------------------------------------------------------------ invisible walls

  buildBoundary() {
    const R = this.physics.RAPIER;
    const w = WORLD_HALF + 3;
    const walls = [
      [w, 0, 0.5, 20, w],
      [-w, 0, 0.5, 20, w],
      [0, w, w, 20, 0.5],
      [0, -w, w, 20, 0.5],
    ];
    for (const [x, z, hx, hy, hz] of walls) {
      this.physics.addStaticCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, hy, z));
    }
  }

  // ------------------------------------------------------------------ quality + update

  setQuality(q) {
    this.quality = q;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.setShadowRange(q.shadowRange);
    this.scene.fog.near = q.fog[0];
    this.scene.fog.far = q.fog[1];
  }

  update(dt, t, focus, camera) {
    this.sky.position.copy(camera.position);
    // shadow camera follows the player, snapped to shadow texels to avoid shimmering
    const texel = (this.shadowRange * 2) / this.quality.shadowMap;
    const sx = Math.round(focus.x / texel) * texel;
    const sy = Math.round(focus.y / texel) * texel;
    const sz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + this.sunDir.x * 70, sy + this.sunDir.y * 70, sz + this.sunDir.z * 70);
    this.sun.target.updateMatrixWorld();
  }
}
