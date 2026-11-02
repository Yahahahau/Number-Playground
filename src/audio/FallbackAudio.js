// Backup sound effects that do NOT need the Web Audio API: short WAV clips are synthesised once at
// start-up and played through ordinary <audio> elements. Used whenever the AudioContext cannot run
// (blocked, suspended by the OS, unsupported). Custom sound packs can later replace the recipes below
// (or call register(name, url)) without touching any game code.
const RATE = 22050;

function env(i, n, attack = 0.01) {
  const t = i / n;
  const a = Math.min(1, t / attack);
  return a * Math.pow(1 - t, 1.6);
}

function tone(freq, dur, { slide = 1, type = 'sine', vol = 0.5 } = {}) {
  const n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = freq * Math.pow(slide, i / n);
    phase += (2 * Math.PI * f) / RATE;
    let s = Math.sin(phase);
    if (type === 'square') s = Math.sign(s) * 0.6;
    else if (type === 'tri') s = (2 / Math.PI) * Math.asin(s);
    else if (type === 'saw') s = ((phase / Math.PI) % 2) - 1;
    out[i] = s * env(i, n, 0.02) * vol;
  }
  return out;
}

function noise(dur, { vol = 0.4, lp = 0.3 } = {}) {
  const n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y += lp * (Math.random() * 2 - 1 - y);
    out[i] = y * env(i, n, 0.005) * vol * 2.2;
  }
  return out;
}

function mix(...parts) {
  const len = Math.max(...parts.map((p) => p.off + p.data.length));
  const out = new Float32Array(len);
  for (const { data, off } of parts) for (let i = 0; i < data.length; i++) out[off + i] += data[i];
  return out;
}
const at = (data, t = 0) => ({ data, off: Math.floor(t * RATE) });

function toWavUrl(samples) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32000, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const arp = (notes, step, dur, type = 'tri', vol = 0.35) => mix(...notes.map((f, i) => at(tone(f, dur, { type, vol }), i * step)));

const RECIPES = {
  click: () => tone(880, 0.07, { type: 'tri', vol: 0.4 }),
  tap: () => tone(700, 0.05, { type: 'tri', vol: 0.35 }),
  panel: () => tone(560, 0.1, { slide: 1.4, type: 'tri', vol: 0.4 }),
  dry: () => tone(180, 0.12, { slide: 0.7, type: 'square', vol: 0.3 }),
  grab: () => mix(at(tone(320, 0.2, { slide: 2.2, type: 'saw', vol: 0.25 })), at(tone(640, 0.22, { slide: 1.8, vol: 0.5 }), 0.02)),
  release: () => tone(720, 0.2, { slide: 0.45, vol: 0.5 }),
  push: () => mix(at(noise(0.22, { vol: 0.7, lp: 0.25 })), at(tone(150, 0.22, { slide: 0.4, vol: 0.8 }))),
  throwSfx: () => mix(at(noise(0.38, { vol: 0.6, lp: 0.12 })), at(tone(110, 0.25, { slide: 0.5, vol: 0.8 }))),
  impact: () => mix(at(tone(190, 0.16, { slide: 0.45, vol: 0.9 })), at(noise(0.09, { vol: 0.6 }))),
  merge: () => mix(at(arp([392, 490, 588, 784], 0.05, 0.5)), at(tone(196, 0.5, { slide: 0.8, vol: 0.7 })), at(tone(70, 0.5, { slide: 0.5, vol: 0.9 }))),
  discover: () => arp([740, 990, 1240, 1660], 0.08, 0.35, 'sine', 0.4),
  spawn: () => mix(at(tone(500, 0.24, { slide: 2.4, vol: 0.5 })), at(tone(1000, 0.2, { slide: 1.5, type: 'tri', vol: 0.3 }), 0.05)),
  reward: () => arp([523, 659, 784, 1047, 1319], 0.09, 0.4),
  splash: () => mix(at(noise(0.6, { vol: 0.7, lp: 0.35 })), at(tone(700, 0.1, { slide: 1.8, vol: 0.3 }), 0.15), at(tone(950, 0.08, { slide: 1.6, vol: 0.25 }), 0.3)),
};

const VOL = { impact: 0.8, tap: 0.6, click: 0.7, splash: 0.9 };

export class FallbackAudio {
  constructor(getVolume, isEnabled) {
    this.getVolume = getVolume;
    this.isEnabled = isEnabled;
    this.pools = new Map();
    this.last = new Map();
    this.ready = false;
  }

  /** Build the clips (cheap: ~14 clips, a few hundred KB). Safe to call more than once. */
  prepare() {
    if (this.ready) return;
    try {
      for (const [name, make] of Object.entries(RECIPES)) this.register(name, toWavUrl(make()));
      this.ready = true;
    } catch (e) {
      console.warn('[audio] fallback sounds unavailable', e);
    }
  }

  /** Plug in a custom clip later: audio.fallback.register('merge', '/sounds/merge.mp3'). */
  register(name, url, voices = 3) {
    const list = [];
    for (let i = 0; i < voices; i++) {
      const a = new Audio(url);
      a.preload = 'auto';
      a.playsInline = true;
      list.push(a);
    }
    this.pools.set(name, { list, i: 0 });
  }

  play(name) {
    if (!this.isEnabled() || !this.ready) return;
    const pool = this.pools.get(name);
    if (!pool) return;
    const now = performance.now();
    if (now - (this.last.get(name) || 0) < 45) return;
    this.last.set(name, now);
    const a = pool.list[pool.i++ % pool.list.length];
    try {
      a.volume = Math.min(1, this.getVolume() * (VOL[name] ?? 1));
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** A silent looping clip: on iOS it moves the page to the "playback" audio session so the hardware
   *  silent switch no longer mutes the game. */
  silentUrl() {
    const n = RATE / 4;
    return toWavUrl(new Float32Array(n));
  }
}
