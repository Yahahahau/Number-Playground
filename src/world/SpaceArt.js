// Procedurally painted 2D art, generated ONCE at start-up into shared canvases/textures:
//   - the static space skybox (stars + nebula + a distant galaxy)
//   - screen-locked patterns (galaxy / nebula / circuit) used by the special block material
//   - the lab floor tiles
// Nothing here is loaded from the network, and nothing is regenerated per frame.
import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function blob(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`);
  gr.addColorStop(0.5, `rgba(${rgb},${a * 0.35})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function stars(g, w, h, n, rnd, maxR = 1.4) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const m = rnd();
    const r = 0.25 + m * m * maxR;
    const t = rnd();
    g.fillStyle = t < 0.2 ? '#ffd6f2' : t < 0.45 ? '#bfe6ff' : '#ffffff';
    g.globalAlpha = 0.35 + m * 0.65;
    g.beginPath();
    g.arc(x, y, r, 0, 6.2832);
    g.fill();
  }
  g.globalAlpha = 1;
}

export function paintSkyCanvas() {
  const W = 1024;
  const H = 512;
  const c = canvas(W * 2, H * 2);
  const g = c.getContext('2d');
  g.scale(2, 2); // paint in 1024x512 units
  const rnd = mulberry32(2025);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05030f');
  bg.addColorStop(0.5, '#0a0830');
  bg.addColorStop(1, '#04030c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const cols = ['120,40,220', '0,170,255', '255,40,170', '60,90,255', '0,220,230'];
  for (let i = 0; i < 26; i++) blob(g, rnd() * W, H * (0.2 + rnd() * 0.6), 60 + rnd() * 150, cols[i % cols.length], 0.1 + rnd() * 0.13);
  // distant spiral galaxy
  g.save();
  g.translate(W * 0.72, H * 0.38);
  g.rotate(-0.5);
  g.scale(1, 0.38);
  for (let i = 0; i < 1500; i++) {
    const arm = i % 2;
    const t = Math.pow(rnd(), 0.7) * 5.5;
    const a = t * 1.15 + arm * Math.PI + (rnd() - 0.5) * 0.5;
    const rr = t * 26;
    g.fillStyle = `rgba(${i % 5 === 0 ? '255,170,235' : '150,200,255'},${0.07 + rnd() * 0.14})`;
    g.beginPath();
    g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.8 + rnd() * 2.2, 0, 6.2832);
    g.fill();
  }
  blob(g, 0, 0, 46, '255,230,255', 0.8);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  stars(g, W, H, 1800, rnd, 0.55);
  return c;
}

/** Square 2D images used by the screen-locked block material. */
export function paintPattern(kind) {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(kind === 'galaxy' ? 11 : kind === 'nebula' ? 23 : 37);
  g.fillStyle = '#04021a';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  if (kind === 'galaxy') {
    blob(g, S / 2, S / 2, S * 0.5, '90,50,200', 0.5);
    g.save();
    g.translate(S / 2, S / 2);
    for (let i = 0; i < 5200; i++) {
      const arm = i % 3;
      const t = Math.pow(rnd(), 0.65) * 6.3;
      const a = t * 0.95 + (arm * Math.PI * 2) / 3 + (rnd() - 0.5) * (0.25 + t * 0.07);
      const rr = t * 38;
      const hot = i % 7 === 0;
      g.fillStyle = hot ? `rgba(255,150,230,${0.25 + rnd() * 0.4})` : `rgba(120,200,255,${0.1 + rnd() * 0.25})`;
      g.beginPath();
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.7 + rnd() * 2.2, 0, 6.2832);
      g.fill();
    }
    blob(g, 0, 0, 70, '255,240,255', 0.95);
    g.restore();
  } else if (kind === 'nebula') {
    const cols = ['255,40,170', '0,190,255', '140,60,255', '0,240,200'];
    for (let i = 0; i < 46; i++) blob(g, rnd() * S, rnd() * S, 50 + rnd() * 120, cols[i % 4], 0.14 + rnd() * 0.16);
  } else {
    // energy circuit
    g.strokeStyle = 'rgba(0,230,255,0.75)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let x = Math.floor(rnd() * 16) * 32 + 16;
      let y = Math.floor(rnd() * 16) * 32 + 16;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        if (rnd() < 0.5) x += (rnd() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(rnd() * 3));
        else y += (rnd() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(rnd() * 3));
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = 'rgba(255,60,200,0.9)';
      g.beginPath();
      g.arc(x, y, 5, 0, 6.2832);
      g.fill();
    }
    blob(g, S / 2, S / 2, S * 0.6, '90,40,200', 0.25);
  }
  g.globalCompositeOperation = 'source-over';
  stars(g, S, S, 420, rnd, 1.2);
  return c;
}

/** Lab floor: [albedo canvas, emissive canvas]; one tile = 16 m. */
export function paintFloor() {
  const S = 512;
  const a = canvas(S, S);
  const e = canvas(S, S);
  const g = a.getContext('2d');
  const h = e.getContext('2d');
  const base = g.createLinearGradient(0, 0, S, S);
  base.addColorStop(0, '#26386a');
  base.addColorStop(1, '#1a2750');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  // panel seams every 4 m (128 px)
  for (let i = 0; i <= S; i += 128) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(i - 2, 0, 4, S);
    g.fillRect(0, i - 2, S, 4);
    g.fillStyle = 'rgba(120,170,255,0.10)';
    g.fillRect(i + 2, 0, 1.5, S);
    g.fillRect(0, i + 2, S, 1.5);
  }
  // glowing guide lines on the tile border
  h.fillStyle = '#10a8ff';
  h.fillRect(0, 0, S, 3);
  h.fillRect(0, 0, 3, S);
  h.fillStyle = '#7c3cff';
  h.fillRect(S - 3, 0, 3, S);
  h.fillRect(0, S - 3, S, 3);
  // small circuit traces + nodes
  h.strokeStyle = 'rgba(0,210,255,0.8)';
  h.lineWidth = 2;
  g.strokeStyle = 'rgba(60,110,200,0.25)';
  g.lineWidth = 2;
  const pts = [
    [[64, 64], [64, 192], [128, 192]],
    [[320, 64], [448, 64], [448, 130]],
    [[64, 384], [192, 384], [192, 448]],
    [[352, 352], [352, 448], [448, 448]],
  ];
  for (const p of pts) {
    for (const ctx of [g, h]) {
      ctx.beginPath();
      ctx.moveTo(...p[0]);
      for (const q of p.slice(1)) ctx.lineTo(...q);
      ctx.stroke();
    }
    const q = p[p.length - 1];
    h.fillStyle = '#ff3cc8';
    h.beginPath();
    h.arc(q[0], q[1], 5, 0, 6.2832);
    h.fill();
  }
  // diamond mark in the tile centre
  h.strokeStyle = 'rgba(150,90,255,0.9)';
  h.lineWidth = 3;
  h.beginPath();
  h.moveTo(256, 226);
  h.lineTo(286, 256);
  h.lineTo(256, 286);
  h.lineTo(226, 256);
  h.closePath();
  h.stroke();
  return [a, e];
}

export function toTexture(cv, { srgb = true, repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
