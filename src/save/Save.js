// Persistent player data. BigInt values are always stored as decimal strings.
const KEY = 'numberPlayground.save.v1';

function defaults() {
  return {
    v: 1,
    collection: {}, // "1024": { c: timesFound, t: firstFoundEpochMs }
    maxValue: '1',
    stats: {
      merges: 0,
      discovered: 0,
      spawned: 0,
      splashes: 0,
      grabs: 0,
      pushes: 0,
      pulls: 0,
      rotates: 0,
      throws: 0,
      stars: 0,
      daysPlayed: 0,
      firstPlayed: Date.now(),
    },
    daily: { date: '', quests: [], rewardClaimed: false },
    rewards: { unlocked: ['fx_default'], selectedFx: 'fx_default' },
    settings: { quality: 'low', shadows: false, sound: true, volume: 0.8, sensitivity: 1 },
  };
}

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in extra)) continue;
    const bv = base[k];
    const ev = extra[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && ev && typeof ev === 'object') {
      base[k] = merge(bv, ev);
    } else if (typeof bv === typeof ev || bv === null) {
      base[k] = ev;
    }
  }
  return base;
}

export class SaveSystem {
  constructor() {
    this.storageOk = true;
    this.data = this.load();
    this.timer = null;
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  load() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const parsed = JSON.parse(raw);
      const out = merge(d, parsed);
      // collection is a free-form map -> copy as-is, validating entries
      out.collection = {};
      if (parsed.collection && typeof parsed.collection === 'object') {
        for (const [k, e] of Object.entries(parsed.collection)) {
          if (/^\d+$/.test(k) && e && typeof e.c === 'number') {
            out.collection[k] = { c: Math.max(1, e.c | 0), t: Number(e.t) || Date.now() };
          }
        }
      }
      if (!/^\d+$/.test(String(out.maxValue))) out.maxValue = '1';
      if (!Array.isArray(out.daily.quests)) out.daily.quests = [];
      if (!Array.isArray(out.rewards.unlocked) || !out.rewards.unlocked.includes('fx_default')) {
        out.rewards.unlocked = ['fx_default', ...(out.rewards.unlocked || [])];
      }
      return out;
    } catch (e) {
      console.warn('[save] could not read saved data, starting fresh', e);
      this.storageOk = false;
      return d;
    }
  }

  /** Debounced save (or immediate for important events). */
  save(immediate = false) {
    if (immediate) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      if (this.storageOk) console.warn('[save] localStorage unavailable, progress kept in memory only', e);
      this.storageOk = false;
    }
  }

  /** Wipes everything (only used by the confirmed "Reset Progress" button). */
  resetAll() {
    this.data = defaults();
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.flush();
  }
}
