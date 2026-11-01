// Arbitrary-precision helpers built on BigInt. Values are NEVER stored as JS Numbers.
import * as THREE from 'three';

// K, M, B, T are unambiguous; beyond a trillion we switch to scientific notation (1.23e29)
const UNITS = ['', 'K', 'M', 'B', 'T'];

/** log2 of a positive BigInt as a float (accurate even for huge values). */
export function log2Big(v) {
  if (v <= 0n) return 0;
  const h = v.toString(16);
  if (h.length <= 12) return Math.log2(Number(v));
  const top = parseInt(h.slice(0, 12), 16);
  return Math.log2(top) + (h.length - 12) * 4;
}

/** 1.25K, 5.4M, 1.2B ... or scientific notation (1.23e45) for gigantic values. */
export function fmtCompact(v) {
  const s = v.toString();
  const len = s.length;
  if (len <= 3) return s;
  const idx = Math.floor((len - 1) / 3);
  if (idx < UNITS.length) {
    const intDigits = len - idx * 3;
    const frac = s.slice(intDigits, intDigits + 2).replace(/0+$/, '');
    return s.slice(0, intDigits) + (frac ? '.' + frac : '') + UNITS[idx];
  }
  const frac = s.slice(1, 3).replace(/0+$/, '');
  return s[0] + (frac ? '.' + frac : '') + 'e' + (len - 1);
}

/** Text drawn on block faces: full value while short, compact afterwards. */
export function fmtLabel(v) {
  const s = v.toString();
  return s.length <= 5 ? s : fmtCompact(v);
}

/** Full exact value with thousands separators. */
export function fmtFull(v) {
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseBig(s) {
  try {
    if (typeof s !== 'string' || !/^\d+$/.test(s)) return null;
    const b = BigInt(s);
    return b > 0n ? b : null;
  } catch {
    return null;
  }
}

export function cmpBig(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- tiers / colours

const BREAKPOINTS = [0, 4, 7, 10, 14, 20, 30, 50]; // in log2 of value
const PALETTE_HEX = [
  '#e53935', // 0 red      (start)
  '#fb8c00', // 1 orange   (low)
  '#fdd835', // 2 yellow   (medium)
  '#43a047', // 3 green    (high)
  '#29b6f6', // 4 sky blue (very high)
  '#3050e8', // 5 blue     (special)
  '#9c27b0', // 6 purple   (huge)
  '#ec407a', // 7 pink / rainbow (ultimate)
];
const PALETTE = PALETTE_HEX.map((c) => new THREE.Color(c));
export const TIER_NAMES = ['Starter', 'Low', 'Medium', 'High', 'Very High', 'Special', 'Massive', 'Ultimate'];

/** Continuous tier position: 0 (value 1) .. 7+ (ultimate). */
export function tierPos(v) {
  const l = log2Big(v);
  if (l >= BREAKPOINTS[7]) return 7 + Math.min(1, (l - BREAKPOINTS[7]) / 30);
  for (let i = 0; i < 7; i++) {
    if (l < BREAKPOINTS[i + 1]) return i + (l - BREAKPOINTS[i]) / (BREAKPOINTS[i + 1] - BREAKPOINTS[i]);
  }
  return 7;
}

export function tierIndex(pos) {
  return Math.min(7, Math.floor(pos));
}

/** Smoothly interpolated colour for a tier position. Ultimate tier cycles through the rainbow. */
export function tierColor(pos, out, time = 0) {
  if (pos >= 7) {
    out.setHSL((time * 0.12 + (pos - 7) * 0.5) % 1, 0.85, 0.58);
    return out;
  }
  const i = Math.floor(pos);
  const f = pos - i;
  return out.copy(PALETTE[i]).lerp(PALETTE[Math.min(7, i + 1)], f);
}

const _tmpColor = new THREE.Color();
/** CSS background for UI tiles, matching the 3D block colour. */
export function tierCss(v) {
  const pos = tierPos(v);
  if (pos >= 7) {
    return 'linear-gradient(135deg,#ff5d8f,#ffb454,#7bed9f,#4cc3ff,#b388ff)';
  }
  tierColor(pos, _tmpColor);
  return '#' + _tmpColor.getHexString(); // working colour -> sRGB hex
}

// ---------------------------------------------------------------- size / mass

export const DENSITY = 40; // kg / m^3
/** Logarithmic size growth with a hard cap so huge numbers never swallow the play area. */
export function edgeOf(v) {
  return Math.min(1.5, 0.75 + 0.028 * log2Big(v));
}
export function massOf(edge) {
  return DENSITY * edge * edge * edge;
}
