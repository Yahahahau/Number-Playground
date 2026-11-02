// Daily challenges: generated offline from the device date, scaled to the player's progress.
// Missing a day never costs progress - a new set simply appears.
import { fmtCompact, log2Big } from '../core/bignum.js';

export const FX_LIST = [
  { id: 'fx_default', name: 'Classic Pop', colors: null },
  { id: 'fx_gold', name: 'Golden Spark', colors: ['#ffd25e', '#fff3c4', '#ffb300'] },
  { id: 'fx_emerald', name: 'Emerald Burst', colors: ['#2ee59d', '#b8ffe0', '#00b36b'] },
  { id: 'fx_magenta', name: 'Magenta Pop', colors: ['#ff4fd8', '#ffd1f5', '#b100ff'] },
  { id: 'fx_aurora', name: 'Aurora', colors: ['#4cc3ff', '#7bed9f', '#b388ff', '#ff8fb1'] },
];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class Daily {
  constructor(save, collection, events) {
    this.save = save;
    this.collection = collection;
    this.events = events;
    this.checkDay();

    events.on('merge', (e) => this.onMerge(e));
    events.on('discover', () => this.bump('discover'));
    events.on('splash', () => this.bump('splash'));
    events.on('gun', (e) => this.onGun(e.kind));

    setInterval(() => this.checkDay(), 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkDay();
    });
  }

  get state() {
    return this.save.data.daily;
  }
  get quests() {
    return this.state.quests;
  }
  get allDone() {
    return this.quests.length > 0 && this.quests.every((q) => q.done);
  }

  checkDay() {
    const key = todayKey();
    if (this.state.date === key && this.quests.length === 3 && !this.quests.some((q) => q.type === 'splash')) return;
    this.generate(key);
  }

  generate(key) {
    const r = mulberry32(hashStr(key));
    const stats = this.save.data.stats;
    const best = this.collection.maxValue;
    const quests = [];

    // A: merge-themed (scales with the player's best number / experience)
    if (r() < 0.5) {
      const bits = Math.max(1, Math.ceil(log2Big(best)));
      const exp = Math.min(60, Math.max(3, bits + (r() < 0.5 ? 0 : 1)));
      const target = 1n << BigInt(exp);
      quests.push({
        id: 'reach',
        type: 'reach',
        title: `Create a block worth ${fmtCompact(target)} or more`,
        target: target.toString(),
        progress: '0',
        done: false,
      });
    } else {
      const n = 4 + Math.min(10, Math.floor(stats.merges / 25)) + Math.floor(r() * 3);
      quests.push({ id: 'merge', type: 'merge', title: `Merge blocks ${n} times`, target: n, progress: 0, done: false });
    }

    // B: discovery
    {
      const n = 2 + Math.floor(r() * 3) + Math.min(3, Math.floor(stats.discovered / 60));
      quests.push({
        id: 'discover',
        type: 'discover',
        title: `Discover ${n} new numbers`,
        target: n,
        progress: 0,
        done: false,
      });
    }

    // C: physics gun play
    {
      const pick = ['throw', 'pull', 'rotate', 'tryall'][Math.floor(r() * 4)];
      let q;
      if (pick === 'splash') {
        const n = 2 + Math.floor(r() * 2);
        q = { id: 'splash', type: 'splash', title: `Splash ${n} blocks into the pond`, target: n, progress: 0 };
      } else if (pick === 'throw') {
        const n = 3 + Math.floor(r() * 3);
        q = { id: 'throw', type: 'throw', title: `Throw blocks ${n} times`, target: n, progress: 0 };
      } else if (pick === 'pull') {
        const n = 2 + Math.floor(r() * 3);
        q = { id: 'pull', type: 'pull', title: `Pull blocks toward you ${n} times`, target: n, progress: 0 };
      } else if (pick === 'rotate') {
        const n = 3;
        q = { id: 'rotate', type: 'rotate', title: `Rotate a held block ${n} times`, target: n, progress: 0 };
      } else {
        q = {
          id: 'tryall',
          type: 'tryall',
          title: 'Try every Physics Gun power',
          target: 5,
          progress: 0,
          flags: {},
        };
      }
      q.done = false;
      quests.push(q);
    }

    this.save.data.daily = { date: key, quests, rewardClaimed: false };
    this.save.data.stats.daysPlayed++;
    this.save.save(true);
    this.events.emit('dailyChanged', {});
  }

  bump(type, amount = 1) {
    let changed = false;
    for (const q of this.quests) {
      if (q.done || q.type !== type) continue;
      q.progress = Math.min(q.target, q.progress + amount);
      changed = true;
      this.checkQuest(q);
    }
    if (changed) this.afterChange();
  }

  onMerge({ value }) {
    let changed = false;
    for (const q of this.quests) {
      if (q.done) continue;
      if (q.type === 'merge') {
        q.progress = Math.min(q.target, q.progress + 1);
        changed = true;
        this.checkQuest(q);
      } else if (q.type === 'reach') {
        if (value > BigInt(q.progress)) {
          q.progress = value.toString();
          changed = true;
        }
        this.checkQuest(q);
      }
    }
    if (changed) this.afterChange();
  }

  onGun(kind) {
    let changed = false;
    for (const q of this.quests) {
      if (q.done) continue;
      if (q.type === kind && ['throw', 'pull', 'rotate'].includes(q.type)) {
        q.progress = Math.min(q.target, q.progress + 1);
        changed = true;
        this.checkQuest(q);
      } else if (q.type === 'tryall') {
        q.flags = q.flags || {};
        if (!q.flags[kind]) {
          q.flags[kind] = true;
          q.progress = Object.keys(q.flags).length;
          changed = true;
          this.checkQuest(q);
        }
      }
    }
    if (changed) this.afterChange();
  }

  checkQuest(q) {
    if (q.done) return;
    let ok;
    if (q.type === 'reach') ok = BigInt(q.progress) >= BigInt(q.target);
    else ok = q.progress >= q.target;
    if (ok) {
      q.done = true;
      this.events.emit('questDone', { quest: q });
    }
  }

  afterChange() {
    if (this.allDone && !this.state.rewardClaimed) this.claimReward();
    this.save.save();
    this.events.emit('dailyChanged', {});
  }

  claimReward() {
    this.state.rewardClaimed = true;
    const stats = this.save.data.stats;
    stats.stars++;
    const unlocked = this.save.data.rewards.unlocked;
    const next = FX_LIST.find((f) => !unlocked.includes(f.id));
    if (next) unlocked.push(next.id);
    this.save.save(true);
    this.events.emit('dailyComplete', { fx: next || null });
  }

  fraction(q) {
    if (q.done) return 1;
    if (q.type === 'reach') {
      const t = Math.max(1, log2Big(BigInt(q.target)));
      const p = BigInt(q.progress) > 0n ? log2Big(BigInt(q.progress)) : 0;
      return Math.max(0, Math.min(1, p / t));
    }
    return Math.max(0, Math.min(1, q.progress / q.target));
  }

  progressText(q) {
    if (q.done) return 'Done!';
    if (q.type === 'reach') {
      const p = BigInt(q.progress);
      return `Best today: ${p > 0n ? fmtCompact(p) : '—'}`;
    }
    return `${q.progress} / ${q.target}`;
  }
}
