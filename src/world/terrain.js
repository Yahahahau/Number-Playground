// Shared terrain description. The SAME height function feeds the render mesh, the Rapier
// trimesh collider, tree placement and the water depth texture so they always agree.
import * as THREE from 'three';

export const START = { x: 0, z: 20 };
export const POND = { x: 17, z: -16, bowl: 12.5, depth: 2.15 };
export const WATER_Y = -0.42;
export const WORLD_HALF = 46; // invisible walls
export const MESH_HALF = 72; // rendered terrain half size

export const PATH_POINTS = [
  [0, 40],
  [0, 26],
  [0.4, 14],
  [3, 3],
  [7.4, -3.6],
  [9.4, -6.8],
];

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z) {
  return valueNoise(x, z) * 0.6 + valueNoise(x * 2.1 + 5.2, z * 2.1 + 1.7) * 0.28 + valueNoise(x * 4.3 + 9.1, z * 4.3 + 3.3) * 0.12;
}

export function terrainHeight(x, z) {
  // gentle rolling hills, nearly flat around the start area so blocks behave nicely
  const ds = Math.hypot(x - START.x, z - START.z);
  const amp = 0.08 + 0.92 * smoothstep(8, 26, ds);
  let h = (fbm(x * 0.05, z * 0.05) - 0.5) * 1.5 * amp;

  // pond basin
  const dp = Math.hypot(x - POND.x, z - POND.z);
  const s = 1 - smoothstep(2.5, POND.bowl, dp);
  h = h * (1 - s * 0.85) - POND.depth * s;

  // rising hills form a natural boundary
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rise = smoothstep(WORLD_HALF - 3, WORLD_HALF + 16, edge);
  h += rise * (6 + fbm(x * 0.08, z * 0.08) * 6);
  return h;
}

export function inPond(x, z, margin = 0) {
  return Math.hypot(x - POND.x, z - POND.z) < POND.bowl + margin && terrainHeight(x, z) < WATER_Y;
}

// ------------------------------------------------------------------ path

let _curve = null;
let _samples = null;
export function pathCurve() {
  if (!_curve) {
    _curve = new THREE.CatmullRomCurve3(
      PATH_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
  }
  return _curve;
}
export function pathSamples() {
  if (!_samples) _samples = pathCurve().getSpacedPoints(120);
  return _samples;
}
export function distToPath(x, z) {
  let best = Infinity;
  for (const p of pathSamples()) {
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
