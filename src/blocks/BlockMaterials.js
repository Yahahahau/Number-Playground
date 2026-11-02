// Block surface system. Three independent layers, so the surface can change without touching the colour:
//   1. base colour   -> the tier colour (set every frame from BlockManager, never replaced here)
//   2. surface kind  -> matte / ceramic / metal / iridescent / crystal / pattern / screen-locked galaxy
//   3. parameters    -> roughness, metalness, tint strength, pattern maps ...
// Textures and shader programs are shared: only a tiny material object exists per block.
//
// The "screen-locked" kind (Chowder effect) is deliberately separate from normal texture mapping:
// it samples a 2D image from gl_FragCoord, so the picture stays fixed to the screen while the
// block moves / rotates and the block's silhouette (its real depth-tested pixels) acts as the mask.
import * as THREE from 'three';
import { paintPattern } from '../world/SpaceArt.js';
import { tierIndex } from '../core/bignum.js';

/** Drawing-buffer size in pixels, kept up to date by Game.resize(). Shared by every screen-locked material. */
export const SCREEN = { value: new THREE.Vector2(430, 870) };

export const KINDS = ['matte', 'ceramic', 'metal', 'iridescent', 'crystal', 'carbon', 'hex', 'circuit', 'engraved', 'galaxy'];

// ------------------------------------------------------------------ shared textures (created lazily, once)

const _tex = new Map();
function cached(key, make) {
  let t = _tex.get(key);
  if (!t) {
    t = make();
    _tex.set(key, t);
  }
  return t;
}

function canvas(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}
function tex(cv, srgb) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function surfaceTextures(kind) {
  return cached('surf:' + kind, () => {
    const N = 256;
    const a = canvas(N); // albedo multiplier
    const b = canvas(N); // bump
    const e = canvas(N); // emissive
    const ga = a.getContext('2d');
    const gb = b.getContext('2d');
    const ge = e.getContext('2d');
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, N, N);
    if (kind === 'carbon') {
      const c = 32;
      for (let y = 0; y < N; y += c) {
        for (let x = 0; x < N; x += c) {
          const horiz = ((x + y) / c) % 2 === 0;
          const gr = horiz ? ga.createLinearGradient(x, y, x, y + c) : ga.createLinearGradient(x, y, x + c, y);
          gr.addColorStop(0, '#2c2c2c');
          gr.addColorStop(0.5, '#8a8a8a');
          gr.addColorStop(1, '#2c2c2c');
          ga.fillStyle = gr;
          ga.fillRect(x, y, c, c);
          gb.fillStyle = gr;
          gb.fillRect(x, y, c, c);
        }
      }
    } else if (kind === 'hex') {
      ga.fillStyle = '#d6d6d6';
      ga.fillRect(0, 0, N, N);
      gb.fillStyle = '#ffffff';
      gb.fillRect(0, 0, N, N);
      const r = 21;
      const w = Math.sqrt(3) * r;
      for (let row = -1; row < N / (1.5 * r) + 1; row++) {
        for (let col = -1; col < N / w + 1; col++) {
          const cx = col * w + (row % 2 ? w / 2 : 0);
          const cy = row * 1.5 * r;
          for (const g of [ga, gb]) {
            g.strokeStyle = g === ga ? '#4a5a7a' : '#202020';
            g.lineWidth = 3;
            g.beginPath();
            for (let k = 0; k < 6; k++) {
              const ang = (Math.PI / 3) * k + Math.PI / 6;
              const px = cx + r * 0.92 * Math.cos(ang);
              const py = cy + r * 0.92 * Math.sin(ang);
              k ? g.lineTo(px, py) : g.moveTo(px, py);
            }
            g.closePath();
            g.stroke();
          }
        }
      }
    } else if (kind === 'circuit') {
      ga.fillStyle = '#4a5472';
      ga.fillRect(0, 0, N, N);
      gb.fillStyle = '#808080';
      gb.fillRect(0, 0, N, N);
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 20; i++) {
        let x = Math.floor(rnd() * 8) * 32 + 16;
        let y = Math.floor(rnd() * 8) * 32 + 16;
        for (const g of [ga, gb, ge]) {
          g.strokeStyle = g === ga ? '#e8f4ff' : g === gb ? '#ffffff' : '#ffffff';
          g.lineWidth = 4;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x, y);
        }
        let px = x;
        let py = y;
        const path = [[x, y]];
        for (let k = 0; k < 3; k++) {
          if (rnd() < 0.5) px += (rnd() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(rnd() * 2));
          else py += (rnd() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(rnd() * 2));
          path.push([px, py]);
        }
        for (const g of [ga, gb, ge]) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 4;
          g.beginPath();
          path.forEach(([qx, qy], i) => (i ? g.lineTo(qx, qy) : g.moveTo(qx, qy)));
          g.stroke();
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(px, py, 6, 0, 6.2832);
          g.fill();
        }
      }
    } else {
      // engraved geometry: nested diamonds and cross lines cut into a pale surface
      ga.fillStyle = '#e4e4e8';
      ga.fillRect(0, 0, N, N);
      gb.fillStyle = '#ffffff';
      gb.fillRect(0, 0, N, N);
      for (const g of [ga, gb]) {
        g.strokeStyle = g === ga ? '#59607a' : '#101010';
        g.lineWidth = 4;
        for (let k = 1; k <= 4; k++) {
          const d = k * 28;
          g.beginPath();
          g.moveTo(N / 2, N / 2 - d);
          g.lineTo(N / 2 + d, N / 2);
          g.lineTo(N / 2, N / 2 + d);
          g.lineTo(N / 2 - d, N / 2);
          g.closePath();
          g.stroke();
        }
        g.beginPath();
        g.moveTo(8, 8);
        g.lineTo(N - 8, N - 8);
        g.moveTo(N - 8, 8);
        g.lineTo(8, N - 8);
        g.stroke();
      }
    }
    return { map: tex(a, true), bump: tex(b, false), emissive: tex(e, true) };
  });
}

function screenPattern(name) {
  return cached('screen:' + name, () => {
    const t = tex(paintPattern(name), true);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    return t;
  });
}

// ------------------------------------------------------------------ choosing a look from the number

const METAL_TINTS = [
  [0.62, 0.6, 0.57], // titanium
  [0.88, 0.9, 0.93], // silver
  [0.2, 0.21, 0.26], // dark chrome
  [0.22, 0.42, 0.9], // blue metal
].map((c) => new THREE.Color(...c));

const SCREEN_PATTERNS = ['galaxy', 'nebula', 'circuit'];

function milestoneExp(value) {
  // exact powers of two at 2^10, 2^20, 2^30 ... are milestones
  if (value < 1024n || (value & (value - 1n)) !== 0n) return -1;
  const e = value.toString(2).length - 1;
  return e % 10 === 0 ? e : -1;
}

/** Visual evolution: richer surfaces for higher tiers; milestones always get the premium galaxy. */
export function pickLook(value, pos) {
  const h = Number(value % 9973n);
  const ms = milestoneExp(value);
  if (ms > 0) return { kind: 'galaxy', variant: (ms / 10) % 3 };
  switch (tierIndex(pos)) {
    case 0:
      return { kind: 'matte', variant: 0 };
    case 1:
      return { kind: 'ceramic', variant: 0 };
    case 2:
      return { kind: 'metal', variant: h % 4 };
    case 3:
      return { kind: 'iridescent', variant: h % 3 };
    case 4:
      return { kind: 'crystal', variant: 0 };
    case 5:
      return { kind: ['carbon', 'hex', 'circuit', 'engraved'][h % 4], variant: 0 };
    default:
      return { kind: 'galaxy', variant: h % 3 };
  }
}

// ------------------------------------------------------------------ material factory

const WHITE = new THREE.Color(1, 1, 1);

function std(o) {
  return new THREE.MeshStandardMaterial(o);
}

export function createBlockMaterial(value, pos, color) {
  const look = pickLook(value, pos);
  const base = { color: color.clone(), emissive: color.clone(), emissiveIntensity: 0.1, roughness: 0.5, metalness: 0 };
  let m;
  let emi = 0.1;
  let tint = null;
  let tintMix = 0;
  switch (look.kind) {
    case 'matte':
      m = std({ ...base, roughness: 0.85, metalness: 0, envMapIntensity: 0.55 });
      break;
    case 'ceramic':
      m = std({ ...base, roughness: 0.1, metalness: 0.05, envMapIntensity: 1.5 });
      tint = WHITE;
      tintMix = 0.16;
      break;
    case 'metal':
      m = std({ ...base, roughness: 0.24, metalness: 1, envMapIntensity: 1.35 });
      tint = METAL_TINTS[look.variant];
      tintMix = look.variant === 3 ? 0.55 : 0.62;
      emi = 0.04;
      break;
    case 'iridescent': {
      m = std({ ...base, roughness: 0.2, metalness: 0.75, envMapIntensity: 1.3 });
      const phase = { value: look.variant * 0.31 };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uPhase = phase;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uPhase;')
          .replace(
            '#include <opaque_fragment>',
            `float fres = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
             vec3 film = 0.5 + 0.5 * cos(6.28318 * (fres * 1.35 + uPhase + vec3(0.0, 0.33, 0.67)));
             outgoingLight = mix(outgoingLight, outgoingLight * 0.5 + film * (0.2 + 0.7 * fres), 0.72);
             #include <opaque_fragment>`,
          );
      };
      m.customProgramCacheKey = () => 'blk-irid';
      emi = 0.05;
      break;
    }
    case 'crystal': {
      m = std({ ...base, roughness: 0.04, metalness: 0.2, envMapIntensity: 1.7 });
      tint = WHITE;
      tintMix = 0.28;
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             vec3 cell = floor(vOP * 3.2);
             vec3 hh = fract(sin(cell * vec3(127.1, 311.7, 74.7)) * 43758.5453);
             normal = normalize(normal + (hh - 0.5) * 0.6);`,
          )
          .replace(
            '#include <opaque_fragment>',
            `float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.5);
             outgoingLight += diffuseColor.rgb * rim * 0.55 + vec3(0.25, 0.5, 0.7) * rim * 0.25;
             #include <opaque_fragment>`,
          );
      };
      m.customProgramCacheKey = () => 'blk-crystal';
      emi = 0.14;
      break;
    }
    case 'carbon':
    case 'hex':
    case 'engraved':
    case 'circuit': {
      const t = surfaceTextures(look.kind);
      m = std({
        ...base,
        map: t.map,
        bumpMap: t.bump,
        bumpScale: look.kind === 'carbon' ? 1.2 : 2.2,
        roughness: look.kind === 'carbon' ? 0.32 : 0.4,
        metalness: look.kind === 'hex' || look.kind === 'engraved' ? 0.5 : 0.25,
        envMapIntensity: 1.2,
      });
      if (look.kind === 'circuit') {
        m.emissiveMap = t.emissive;
        emi = 1.1; // the traces glow; the rest of the surface stays dark
      } else emi = 0.05;
      break;
    }
    default: {
      // screen-locked galaxy (Chowder effect)
      const pat = screenPattern(SCREEN_PATTERNS[look.variant % 3]);
      m = std({ ...base, roughness: 0.35, metalness: 0.3, envMapIntensity: 0.8 });
      const uPattern = { value: pat };
      const uMix = { value: 0.88 };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uScreen = SCREEN;
        sh.uniforms.uPattern = uPattern;
        sh.uniforms.uMix = uMix;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uScreen;\nuniform sampler2D uPattern;\nuniform float uMix;')
          .replace(
            '#include <opaque_fragment>',
            `// screen-locked 2D image: coordinates come from the PIXEL position, never from the mesh UVs,
             // so it ignores the block's rotation, movement and perspective. The block only masks it.
             vec2 suv = (gl_FragCoord.xy - 0.5 * uScreen) / uScreen.y * 1.9 + 0.5;
             vec3 pat = texture2D(uPattern, suv).rgb;
             float lum = dot(outgoingLight, vec3(0.3333));
             vec3 shown = pat * 1.55 * mix(vec3(1.0), diffuseColor.rgb * 1.5, 0.3) * (0.7 + 0.6 * lum) + diffuseColor.rgb * 0.05;
             outgoingLight = mix(outgoingLight, shown, uMix);
             #include <opaque_fragment>`,
          );
      };
      m.customProgramCacheKey = () => 'blk-screen';
      emi = 0.0;
      break;
    }
  }
  m.userData = { kind: look.kind, tint, tintMix, emi };
  return m;
}

/** Per-frame colour update that keeps the base colour authoritative for every surface kind. */
export function applyBlockColor(mat, color, glow) {
  mat.color.copy(color);
  const u = mat.userData;
  if (u.tint) mat.color.lerp(u.tint, u.tintMix);
  mat.emissive.copy(color);
  mat.emissiveIntensity = u.emi + glow * 0.42;
}
