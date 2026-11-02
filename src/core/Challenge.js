// Free Play / Challenge share ONE map. Challenge only switches on the glowing target pad and a goal:
// bring a block worth at least the target onto the pad and keep it there for a moment.
// Rewards: +1 star (same counter as the daily stars). Merge rules and numbers are never touched.
import { PAD } from '../world/terrain.js';
import { log2Big, fmtCompact } from './bignum.js';

const HOLD_TIME = 1.2; // seconds the block must rest on the pad
const REST_SPEED = 0.7; // m/s

export class Challenge {
  constructor(game) {
    this.g = game;
    this.hold = 0;
    this.target = 8n;
    this.cool = 0;
    this.lastDone = 0n;
    this.refreshTarget();
  }

  get active() {
    return this.g.save.data.settings.mode === 'challenge';
  }

  /** The next goal is always the next new power of two beyond the best number found so far. */
  refreshTarget() {
    const m = this.g.collection.maxValue;
    const best = m > this.lastDone ? m : this.lastDone;
    const k = Math.max(3, Math.floor(log2Big(best)) + 1);
    this.target = 1n << BigInt(k);
  }

  setMode(mode) {
    this.g.save.data.settings.mode = mode;
    this.g.save.save(true);
    this.apply();
    this.g.events.emit('toast', { text: mode === 'challenge' ? 'Challenge mode: use the glowing pad' : 'Free Play mode', kind: 'info' });
  }

  apply() {
    this.hold = 0;
    this.refreshTarget();
    this.g.world.setPad(this.active, false);
    this.g.events.emit('modeChanged', { mode: this.active ? 'challenge' : 'free', target: this.target });
  }

  update(dt) {
    if (!this.active) return;
    if (this.cool > 0) {
      this.cool -= dt;
      return;
    }
    const held = this.g.gun.held;
    let found = null;
    for (const b of this.g.blocks.blocks) {
      if (b === held || b.value < this.target) continue;
      const p = b.currPos;
      if (Math.hypot(p.x - PAD.x, p.z - PAD.z) > PAD.r - b.edge * 0.35) continue;
      if (p.y > b.edge * 0.5 + 0.8) continue;
      const v = b.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > REST_SPEED) continue;
      found = b;
      break;
    }
    if (found) {
      this.hold = Math.min(HOLD_TIME, this.hold + dt);
      this.g.world.setPad(true, true);
      if (this.hold >= HOLD_TIME) this.complete();
    } else if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt * 2);
      if (this.hold === 0) this.g.world.setPad(true, false);
    }
    this.g.events.emit('goalProgress', { p: this.hold / HOLD_TIME });
  }

  complete() {
    const g = this.g;
    g.save.data.stats.stars++;
    g.save.data.challenge.solved++;
    g.save.save(true);
    g.audio.reward();
    g.events.emit('toast', { text: `Challenge complete! ${fmtCompact(this.target)} delivered. +1 star`, kind: 'good' });
    this.cool = 2.5;
    this.hold = 0;
    this.lastDone = this.target;
    this.refreshTarget();
    g.world.setPad(true, false);
    g.events.emit('modeChanged', { mode: 'challenge', target: this.target });
    g.events.emit('goalProgress', { p: 0 });
  }
}
