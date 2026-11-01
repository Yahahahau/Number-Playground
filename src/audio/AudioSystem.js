// Procedural Web Audio: no sample files, so nothing can fail to load. The context is created lazily
// and resumed from the first user gesture (mobile autoplay rules).
export class AudioSystem {
  constructor(save) {
    this.save = save;
    this.ctx = null;
    this.master = null;
    this.enabled = save.data.settings.sound;
    this.volume = save.data.settings.volume;
    this.noiseBuf = null;
    this.ambient = null;
    this.pullNodes = null;
    this.holdNodes = null;
    this.birdTimer = null;
    this.lastImpact = 0;
    this.lastSplash = 0;
  }

  /** Call from a user gesture. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.makeNoise();
        this.startAmbient();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      console.warn('[audio] unavailable', e);
      this.ctx = null;
    }
  }

  setEnabled(v) {
    this.enabled = v;
    this.apply();
  }
  setVolume(v) {
    this.volume = v;
    this.apply();
  }
  apply() {
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  get ok() {
    return this.ctx && this.enabled && this.ctx.state === 'running';
  }

  makeNoise() {
    const n = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04; // brown-ish noise: softer, more natural
      d[i] = (w * 0.35 + last * 9) * 0.6;
    }
    this.noiseBuf = b;
  }

  // ------------------------------------------------------------------ helpers

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005, dest = null } = {}) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(dur, { vol = 0.3, freq = 1000, q = 1, type = 'bandpass', sweep = 0, delay = 0, attack = 0.004 } = {}) {
    if (!this.ok || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ gun

  click() {
    this.tone(880, 0.06, { type: 'triangle', vol: 0.12 });
  }
  dry() {
    this.tone(180, 0.1, { type: 'square', vol: 0.06, slide: 0.7 });
  }
  grab() {
    this.tone(320, 0.16, { type: 'sawtooth', vol: 0.09, slide: 2.2 });
    this.tone(640, 0.2, { type: 'sine', vol: 0.14, slide: 1.8, delay: 0.02 });
    this.noise(0.12, { vol: 0.05, freq: 3000, q: 2 });
    this.startHold();
  }
  release() {
    this.stopHold();
    this.tone(720, 0.18, { type: 'sine', vol: 0.12, slide: 0.45 });
    this.noise(0.1, { vol: 0.04, freq: 1500, q: 1.5, sweep: 0.4 });
  }
  push() {
    this.noise(0.22, { vol: 0.28, freq: 1800, q: 0.9, sweep: 0.25 });
    this.tone(150, 0.2, { type: 'sine', vol: 0.3, slide: 0.4 });
    this.tone(900, 0.1, { type: 'triangle', vol: 0.1, slide: 0.5 });
  }
  throwSfx() {
    this.noise(0.38, { vol: 0.3, freq: 600, q: 0.8, sweep: 6 });
    this.tone(220, 0.3, { type: 'sawtooth', vol: 0.12, slide: 3 });
    this.tone(110, 0.22, { type: 'sine', vol: 0.3, slide: 0.5 });
  }
  pullStart() {
    this.stopPull();
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.linearRampToValueAtTime(260, t + 1.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.1);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    this.pullNodes = { o, g };
  }
  pullStop() {
    this.stopPull();
  }
  stopPull() {
    if (!this.pullNodes || !this.ctx) return;
    const { o, g } = this.pullNodes;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.05);
    o.stop(t + 0.3);
    this.pullNodes = null;
  }
  startHold() {
    this.stopHold();
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = 96;
    o2.frequency.value = 193;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.2);
    o.connect(g);
    o2.connect(g);
    g.connect(this.master);
    o.start(t);
    o2.start(t);
    this.holdNodes = { o, o2, g };
  }
  stopHold() {
    if (!this.holdNodes || !this.ctx) return;
    const { o, o2, g } = this.holdNodes;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.06);
    o.stop(t + 0.3);
    o2.stop(t + 0.3);
    this.holdNodes = null;
  }

  // ------------------------------------------------------------------ blocks / world

  impact(speed, edge, inWater) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpact < 0.06) return;
    this.lastImpact = now;
    const v = Math.min(1, speed / 12);
    const f = 220 / (0.7 + edge);
    this.tone(f, 0.16, { type: 'sine', vol: 0.12 + v * 0.3, slide: 0.45 });
    this.noise(0.09, { vol: 0.05 + v * 0.2, freq: inWater ? 500 : 1400, q: 0.8, sweep: 0.5 });
  }

  merge(value, isNew, isRecord) {
    if (!this.ok) return;
    // heavier, richer chord for bigger numbers
    let bits = 0;
    try {
      bits = Math.max(0, value.toString(2).length - 1);
    } catch {
      /* ignore */
    }
    const tier = Math.min(1, bits / 40);
    const base = 392 * Math.pow(0.85, tier * 4);
    const scale = [1, 1.25, 1.5, 2];
    scale.forEach((r, i) => this.tone(base * r, 0.5 + tier * 0.4, { type: 'triangle', vol: 0.13, delay: i * 0.045 }));
    this.tone(base * 0.5, 0.45, { type: 'sine', vol: 0.22 + tier * 0.2, slide: 0.8 });
    this.tone(60 + 30 * (1 - tier), 0.5 + tier * 0.4, { type: 'sine', vol: 0.25 + tier * 0.35, slide: 0.5 });
    this.noise(0.25 + tier * 0.3, { vol: 0.1 + tier * 0.15, freq: 2400, q: 0.7, sweep: 0.2 });
    if (isNew) this.discover(isRecord);
  }

  discover(isRecord) {
    const n = isRecord ? [660, 830, 990, 1320, 1660] : [740, 990, 1240];
    n.forEach((f, i) => this.tone(f, 0.35, { type: 'sine', vol: 0.12, delay: 0.25 + i * 0.075 }));
  }

  spawn() {
    this.tone(500, 0.22, { type: 'sine', vol: 0.16, slide: 2.4 });
    this.tone(1000, 0.18, { type: 'triangle', vol: 0.08, slide: 1.5, delay: 0.05 });
  }

  panel(open) {
    this.tone(open ? 600 : 440, 0.1, { type: 'triangle', vol: 0.1, slide: open ? 1.5 : 0.7 });
  }

  tap() {
    this.tone(700, 0.04, { type: 'triangle', vol: 0.07 });
  }

  reward() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.14, delay: i * 0.09 }));
  }

  splash(power = 0.5) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSplash < 0.08) return;
    this.lastSplash = now;
    this.noise(0.5 + power * 0.5, { vol: 0.14 + power * 0.3, freq: 1800, q: 0.5, sweep: 0.25 });
    this.noise(0.9, { vol: 0.08, freq: 500, q: 0.7, type: 'lowpass', sweep: 0.5 });
    for (let i = 0; i < 3 + power * 3; i++) {
      this.tone(500 + Math.random() * 900, 0.08, { type: 'sine', vol: 0.05, slide: 1.8, delay: 0.1 + Math.random() * 0.5 });
    }
  }

  // ------------------------------------------------------------------ ambient

  startAmbient() {
    const ctx = this.ctx;
    // wind: filtered noise with a slowly moving cut-off
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    const wg = ctx.createGain();
    wg.gain.value = 0.07;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(wf.frequency);
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(this.master);
    wind.start();
    lfo.start();

    // water lapping: its level follows how close the player is to the pond
    const lap = ctx.createBufferSource();
    lap.buffer = this.noiseBuf;
    lap.loop = true;
    const lf = ctx.createBiquadFilter();
    lf.type = 'bandpass';
    lf.frequency.value = 900;
    lf.Q.value = 0.6;
    const lgn = ctx.createGain();
    lgn.gain.value = 0;
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.34;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.02;
    lfo2.connect(lg2);
    lg2.connect(lgn.gain);
    lap.connect(lf);
    lf.connect(lgn);
    lgn.connect(this.master);
    lap.start();
    lfo2.start();
    this.ambient = { lapGain: lgn };

    const chirp = () => {
      if (this.ok && Math.random() < 0.8) {
        const base = 2200 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          this.tone(base * (1 + Math.random() * 0.25), 0.09, { type: 'sine', vol: 0.025, slide: 1.2 + Math.random() * 0.6, delay: i * 0.12 });
        }
      }
      this.birdTimer = setTimeout(chirp, 2500 + Math.random() * 6500);
    };
    this.birdTimer = setTimeout(chirp, 2500);
  }

  /** Louder lapping near the pond. */
  setPondProximity(d) {
    if (!this.ambient || !this.ctx) return;
    const k = Math.max(0, Math.min(1, 1 - (d - 4) / 34));
    this.ambient.lapGain.gain.setTargetAtTime(0.012 + 0.07 * k * k, this.ctx.currentTime, 0.3);
  }
}
