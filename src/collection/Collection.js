// Personal number encyclopedia. Keys are exact decimal strings (BigInt safe).
import { cmpBig, parseBig } from '../core/bignum.js';

export class Collection {
  constructor(save, events) {
    this.save = save;
    this.events = events;
    this._sorted = null;
  }

  get map() {
    return this.save.data.collection;
  }

  get size() {
    return Object.keys(this.map).length;
  }

  get maxValue() {
    return BigInt(this.save.data.maxValue || '1');
  }

  has(value) {
    return value.toString() in this.map;
  }

  entry(value) {
    return this.map[value.toString()] || null;
  }

  /**
   * Registers a value. Returns { isNew, isRecord }.
   * Called for every merge result and for the starting "1".
   */
  discover(value, { countFind = true } = {}) {
    const key = value.toString();
    let isNew = false;
    const e = this.map[key];
    if (!e) {
      this.map[key] = { c: 1, t: Date.now() };
      this.save.data.stats.discovered++;
      isNew = true;
      this._sorted = null;
    } else if (countFind) {
      e.c++;
    }
    let isRecord = false;
    if (value > this.maxValue) {
      this.save.data.maxValue = key;
      isRecord = true;
    }
    this.save.save(isNew || isRecord);
    if (isNew) this.events.emit('discover', { value, isRecord });
    return { isNew, isRecord };
  }

  /** Sorted ascending BigInt array of every discovered value. */
  sortedValues() {
    if (!this._sorted) {
      this._sorted = Object.keys(this.map)
        .map((k) => parseBig(k))
        .filter((v) => v !== null)
        .sort(cmpBig);
    }
    return this._sorted;
  }

  invalidate() {
    this._sorted = null;
  }
}
