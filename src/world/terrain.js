// Shared arena description. The Number Lab floor is perfectly flat (y = 0), so every system that
// asks "where is the ground?" (block spawn, player, effects) gets the same simple answer.
export const START = { x: 0, z: 20 };
export const WORLD_HALF = 46; // invisible walls (arena half size)
export const FLOOR_HALF = WORLD_HALF + 3; // rendered floor half size

// Challenge target pad (only visible / active in Challenge mode)
export const PAD = { x: 0, z: -16, r: 3.4 };

// The pond is gone; these stay so old call sites keep working (nothing is ever "in water").
export const POND = { x: 1e5, z: 1e5, bowl: 1, depth: 0 };
export const WATER_Y = -1000;

export function terrainHeight() {
  return 0;
}
export function inPond() {
  return false;
}

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
