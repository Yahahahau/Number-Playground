// Interactive pond: custom shader (procedural waves, analytic normals, Fresnel, depth gradient,
// shoreline + object foam, sun glints, sky / cube-map reflection) plus a ripple system fed by
// splashes and wakes from the physics blocks.
import * as THREE from 'three';
import { POND, WATER_Y, terrainHeight } from '../world/terrain.js';
import { SKY_GLSL } from '../world/Sky.js';

const MAX_RIPPLES = 16;
const MAX_FOAM = 8;
const TEX = 128;
const HALF = 14; // depth texture covers +-14m around the pond centre
const MAX_DEPTH = 2.5;

const WAVES = /* glsl */ `
uniform float uTime;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform int uRipCount;

// three travelling sine waves (height + analytic gradient)
float baseWaves(vec2 p, out vec2 g) {
  vec2 d1 = vec2(0.82, 0.57);  float k1 = 1.35; float a1 = 0.030;
  vec2 d2 = vec2(-0.45, 0.89); float k2 = 2.30; float a2 = 0.018;
  vec2 d3 = vec2(0.30, -0.95); float k3 = 3.90; float a3 = 0.010;
  float p1 = dot(d1, p) * k1 + uTime * 1.10;
  float p2 = dot(d2, p) * k2 + uTime * 1.55;
  float p3 = dot(d3, p) * k3 + uTime * 2.10;
  g = d1 * (cos(p1) * a1 * k1) + d2 * (cos(p2) * a2 * k2) + d3 * (cos(p3) * a3 * k3);
  return sin(p1) * a1 + sin(p2) * a2 + sin(p3) * a3;
}

// expanding ring waves from splashes / wakes
float ripples(vec2 p, out vec2 g) {
  float h = 0.0;
  g = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRipCount) break;
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 4.5) continue;
    vec2 dv = p - r.xy;
    float d = max(length(dv), 0.001);
    float x = d - age * 1.9;
    float env = exp(-x * x * 2.2);
    float decay = exp(-age * 0.85) * r.w / (1.0 + age * 1.6);
    float w = sin(x * 7.5);
    h += w * env * decay * 0.08;
    float dw = (cos(x * 7.5) * 7.5 * env - w * 4.4 * x * env) * decay * 0.08;
    g += dw * dv / d;
  }
  return h;
}
`;

export class Water {
  constructor(scene, quality, sunDir) {
    this.scene = scene;
    this.sunDir = sunDir;
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1e4, 0));
    this.ripCursor = 0;
    this.foam = Array.from({ length: MAX_FOAM }, () => new THREE.Vector4(0, 0, 1, 0));
    this.time = 0;
    this.envTarget = null;
    this.envTimer = 0;
    this.cubeCam = null;

    this.depthTex = this.makeDepthTexture();

    this.uniforms = {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uRip: { value: this.ripples },
      uRipCount: { value: quality.ripples },
      uFoam: { value: this.foam },
      uDepth: { value: this.depthTex },
      uCenter: { value: new THREE.Vector2(POND.x, POND.z) },
      uHalf: { value: HALF },
      uMaxDepth: { value: MAX_DEPTH },
      uSun: { value: sunDir.clone() },
      uCam: { value: new THREE.Vector3() },
      uEnv: { value: null },
      uEnvMix: { value: 0 },
      uDetail: { value: quality.waterDetail },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        ${WAVES}
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 g1; vec2 g2;
          wp.y += baseWaves(wp.xz, g1) + ripples(wp.xz, g2);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        ${WAVES}
        ${SKY_GLSL}
        uniform sampler2D uDepth;
        uniform vec2 uCenter;
        uniform float uHalf;
        uniform float uMaxDepth;
        uniform vec3 uSun;
        uniform vec3 uCam;
        uniform samplerCube uEnv;
        uniform float uEnvMix;
        uniform float uDetail;
        uniform vec4 uFoam[${MAX_FOAM}];
        varying vec3 vWorld;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec2 uv = (vWorld.xz - uCenter) / (2.0 * uHalf) + 0.5;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
          float depth = texture2D(uDepth, uv).r * uMaxDepth;
          if (depth <= 0.004) discard;

          vec2 gb; vec2 gr;
          baseWaves(vWorld.xz, gb);
          ripples(vWorld.xz, gr);
          vec2 g = gb + gr;
          // fine detail normals (skipped on low quality)
          if (uDetail > 0.5) {
            vec2 q = vWorld.xz * 5.0;
            g += 0.045 * vec2(vnoise(q + uTime * 0.6) - 0.5, vnoise(q.yx - uTime * 0.5) - 0.5);
          } else {
            g += 0.02 * vec2(sin(vWorld.x * 6.0 + uTime * 1.3), cos(vWorld.z * 6.0 - uTime * 1.1));
          }
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(uCam - vWorld);
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          float fres = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);

          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 refl = skyColor(normalize(R), uSun);
          if (uEnvMix > 0.01) refl = mix(refl, textureCube(uEnv, normalize(R)).rgb, uEnvMix);

          float dn = clamp(depth / 2.0, 0.0, 1.0);
          vec3 shallow = vec3(0.16, 0.72, 0.90);
          vec3 deep = vec3(0.005, 0.12, 0.38);
          vec3 body = mix(shallow, deep, smoothstep(0.05, 1.0, dn));

          vec3 L = normalize(uSun);
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 260.0) * 3.0 + pow(max(dot(N, H), 0.0), 40.0) * 0.12;

          vec3 col = mix(body, refl, clamp(fres * 0.9, 0.0, 0.95));
          col += vec3(1.0, 0.93, 0.78) * spec;

          // foam: shoreline band + around floating objects + ripple crests
          float n = vnoise(vWorld.xz * 3.2 + vec2(uTime * 0.3, -uTime * 0.22));
          float shore = (1.0 - smoothstep(0.0, 0.32 + 0.1 * sin(uTime * 0.9 + vWorld.x * 2.0), depth));
          float foam = shore * smoothstep(0.25, 0.65, n + 0.35);
          for (int i = 0; i < ${MAX_FOAM}; i++) {
            vec4 f = uFoam[i];
            if (f.w <= 0.0) continue;
            float d = length(vWorld.xz - f.xy);
            float ring = 1.0 - smoothstep(f.z * 0.8, f.z * 1.9, d);
            foam += ring * f.w * smoothstep(0.2, 0.6, vnoise(vWorld.xz * 5.0 + uTime * 0.4) + 0.3);
          }
          foam += clamp(length(gr) * 1.4, 0.0, 0.6) * smoothstep(0.3, 0.7, n);
          foam = clamp(foam, 0.0, 1.0);
          col = mix(col, vec3(0.96, 0.99, 1.0), foam * 0.88);

          float alpha = mix(0.42, 0.92, smoothstep(0.0, 1.3, depth));
          alpha = max(alpha, fres * 0.95);
          alpha *= smoothstep(0.0, 0.07, depth);
          alpha = max(alpha, foam * 0.92 * smoothstep(0.0, 0.03, depth));
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });

    this.mesh = null;
    this.buildMesh(quality.waterSegments);
    this.setQuality(quality);
  }

  makeDepthTexture() {
    const data = new Uint8Array(TEX * TEX);
    for (let j = 0; j < TEX; j++) {
      for (let i = 0; i < TEX; i++) {
        const x = POND.x - HALF + ((i + 0.5) / TEX) * HALF * 2;
        const z = POND.z - HALF + ((j + 0.5) / TEX) * HALF * 2;
        const d = Math.max(0, Math.min(1, (WATER_Y - terrainHeight(x, z)) / MAX_DEPTH));
        data[j * TEX + i] = Math.round(d * 255);
      }
    }
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  buildMesh(segments) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const size = POND.bowl * 2 - 1;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(POND.x, WATER_Y, POND.z);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setQuality(q) {
    this.quality = q;
    this.uniforms.uRipCount.value = Math.min(MAX_RIPPLES, q.ripples);
    this.uniforms.uDetail.value = q.waterDetail;
    this.uniforms.uEnvMix.value = 0;
    if (this.mesh.geometry.parameters.widthSegments !== q.waterSegments) this.buildMesh(q.waterSegments);

    // reflection cube map (medium / high only)
    if (this.envTarget) {
      this.envTarget.dispose();
      this.envTarget = null;
      this.cubeCam = null;
      this.uniforms.uEnv.value = null;
    }
    if (q.envSize > 0) {
      this.envTarget = new THREE.WebGLCubeRenderTarget(q.envSize, { type: THREE.UnsignedByteType });
      this.cubeCam = new THREE.CubeCamera(0.3, 220, this.envTarget);
      this.cubeCam.position.set(POND.x, WATER_Y + 0.4, POND.z);
      this.uniforms.uEnv.value = this.envTarget.texture;
      this.envTimer = 99; // capture immediately
      this.envReady = false;
    }
  }

  /** New ring wave at (x, z). strength ~0.3 (small) .. 1.6 (big splash). */
  addRipple(x, z, strength) {
    const r = this.ripples[this.ripCursor];
    r.set(x, z, this.time, strength);
    this.ripCursor = (this.ripCursor + 1) % Math.max(1, this.uniforms.uRipCount.value);
  }

  /** Foam rings around objects floating in the pond. */
  setFoamSources(list) {
    for (let i = 0; i < MAX_FOAM; i++) {
      const f = this.foam[i];
      const s = list[i];
      if (s) f.set(s.x, s.z, s.r, s.k);
      else f.w = 0;
    }
  }

  surfaceY(x, z) {
    return WATER_Y + 0.02 * Math.sin(x * 1.3 + this.time * 1.1) + 0.012 * Math.sin(z * 2.2 + this.time * 1.5);
  }

  update(dt, camera, renderer, scene) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCam.value.copy(camera.position);

    if (this.cubeCam && renderer) {
      this.envTimer += dt;
      if (this.envTimer >= this.quality.envInterval) {
        const d = Math.hypot(camera.position.x - POND.x, camera.position.z - POND.z);
        if (d < 70) {
          this.envTimer = 0;
          this.mesh.visible = false;
          const auto = renderer.shadowMap.autoUpdate;
          const ac = renderer.autoClear;
          renderer.shadowMap.autoUpdate = false;
          renderer.autoClear = true;
          this.cubeCam.update(renderer, scene);
          renderer.autoClear = ac;
          renderer.shadowMap.autoUpdate = auto;
          this.mesh.visible = true;
          this.envReady = true;
        }
      }
      const mix = this.envReady ? (this.quality.id === 'high' ? 0.85 : 0.6) : 0;
      this.uniforms.uEnvMix.value = mix;
    }
  }
}
