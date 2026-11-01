// Pooled visual effects: one Points system (no per-frame allocation), expanding rings and glow flashes.
import * as THREE from 'three';

const MAX_PARTICLES = 800;
const RINGS = 10;
const FLASHES = 8;

export class Effects {
  constructor(scene, quality, rendererSize) {
    this.scene = scene;
    this.quality = quality;
    this.cap = quality.particles;
    this.cursor = 0;
    this.scale = 400;

    const N = MAX_PARTICLES;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N).fill(1);
    this.size = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.aSize = new Float32Array(N);
    this.aAlpha = new Float32Array(N);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: this.scale } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
          uniform float uScale; varying vec3 vC; varying float vA;
          void main() {
            vC = aColor; vA = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 96.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC; varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6) * vA;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vC, a);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, max: 1, active: false, flat: false });
    }

    // flashes
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.flashTex = new THREE.CanvasTexture(cv);
    this.flashTex.colorSpace = THREE.SRGBColorSpace;
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.flashTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        }),
      );
      sp.visible = false;
      sp.renderOrder = 7;
      scene.add(sp);
      this.flashes.push({ sp, t: 0, dur: 0.4, max: 2, active: false });
    }
    this._c = new THREE.Color();
    this.setViewportHeight(rendererSize || 800);
  }

  setViewportHeight(h) {
    this.scale = h * 0.5 * 1.15;
    this.points.material.uniforms.uScale.value = this.scale;
  }

  setQuality(q) {
    this.quality = q;
    this.cap = Math.min(MAX_PARTICLES, q.particles);
    for (let i = this.cap; i < MAX_PARTICLES; i++) this.life[i] = 0;
    this.cursor %= this.cap;
  }

  /** Emit n particles. color: THREE.Color | hex | array of those. */
  emit(p, n, o = {}) {
    n = Math.max(1, Math.round(n * this.quality.particleScale));
    const speed = o.speed ?? 3;
    const spread = o.spread ?? 1;
    const up = o.up ?? 0;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffffff'];
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      // random direction on a sphere
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.8);
      const dx = (o.dir ? o.dir.x : 0) * (o.dirPower ?? 0);
      const dy = (o.dir ? o.dir.y : 0) * (o.dirPower ?? 0);
      const dz = (o.dir ? o.dir.z : 0) * (o.dirPower ?? 0);
      this.vel[i * 3] = s * Math.cos(a) * sp * spread + dx;
      this.vel[i * 3 + 1] = u * sp * spread * (o.flat ? 0.35 : 1) + up * (0.5 + Math.random()) + dy;
      this.vel[i * 3 + 2] = s * Math.sin(a) * sp * spread + dz;
      const r = o.radius ?? 0;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * r;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * r;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * r;
      const c = colors[Math.floor(Math.random() * colors.length)];
      this._c.set(c);
      this.col[i * 3] = this._c.r;
      this.col[i * 3 + 1] = this._c.g;
      this.col[i * 3 + 2] = this._c.b;
      const life = (o.life ?? 0.8) * (0.6 + Math.random() * 0.7);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size[i] = (o.size ?? 0.14) * (0.6 + Math.random() * 0.8);
      this.grav[i] = o.gravity ?? 6;
      this.drag[i] = o.drag ?? 1.2;
    }
  }

  /** Water splash: droplets + mist; power ~ impact speed. */
  splash(p, power) {
    const k = Math.min(1.8, 0.5 + power * 0.1);
    this.emit(p, 22 * k, { color: ['#ffffff', '#bfe9ff', '#7fd0ff'], speed: 2.2 + power * 0.35, up: 3.2 + power * 0.3, spread: 0.7, size: 0.1, life: 1.0, gravity: 11, drag: 0.4, radius: 0.5 });
    this.emit(p, 8 * k, { color: ['#e6f6ff'], speed: 1.2, up: 0.8, size: 0.28, life: 0.9, gravity: -0.5, drag: 2, radius: 0.8, flat: true });
    this.ring(p, '#dff4ff', 1.6 * k + 0.6, 0.9, true);
  }

  ring(p, color, max = 3, dur = 0.6, flat = false) {
    const r = this.rings.find((x) => !x.active) || this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.flat = flat;
    r.mesh.visible = true;
    r.mesh.position.copy(p);
    r.mesh.material.color.set(color);
    if (flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
  }

  flash(p, color, max = 2.2, dur = 0.35) {
    const f = this.flashes.find((x) => !x.active) || this.flashes[0];
    f.active = true;
    f.t = 0;
    f.dur = dur;
    f.max = max;
    f.sp.visible = true;
    f.sp.position.copy(p);
    f.sp.material.color.set(color);
  }

  clear() {
    this.life.fill(0);
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.sp.visible = false;
    }
  }

  update(dt, camera) {
    const N = this.cap;
    for (let i = 0; i < N; i++) {
      let l = this.life[i];
      if (l <= 0) {
        this.aSize[i] = 0;
        this.aAlpha[i] = 0;
        continue;
      }
      l -= dt;
      this.life[i] = l;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = Math.max(0, l / this.maxLife[i]);
      this.aAlpha[i] = Math.min(1, f * 2.2);
      this.aSize[i] = this.size[i] * (0.5 + f * 0.7);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true;
    g.aSize.needsUpdate = true;
    g.aAlpha.needsUpdate = true;
    g.aColor.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(0.1 + r.max * e);
      r.mesh.material.opacity = (1 - k) * 0.85;
      if (!r.flat) r.mesh.quaternion.copy(camera.quaternion);
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        f.active = false;
        f.sp.visible = false;
        continue;
      }
      f.sp.scale.setScalar(f.max * (0.4 + 0.9 * Math.sqrt(k)));
      f.sp.material.opacity = (1 - k) * (1 - k);
    }
  }
}
