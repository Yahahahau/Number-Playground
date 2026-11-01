// Bottom-sheet panels: Collection, Spawn, Daily Challenge, Settings, Help (+ confirm modal).
import { fmtCompact, fmtFull, tierCss, tierPos, tierIndex, TIER_NAMES, parseBig, log2Big, massOf, edgeOf } from '../core/bignum.js';
import { FX_LIST } from '../collection/Daily.js';
import { QUALITY } from '../settings/Quality.js';
import { MAX_BLOCKS } from '../blocks/BlockManager.js';
import { svg } from './UI.js';

const PAGE = 120;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const bgOf = (v) => {
  const c = tierCss(v);
  return c.startsWith('#') ? `background:${c}` : `background:${c}`;
};

export class Panels {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.current = null;
    this.state = { search: '', desc: false, shown: PAGE, selected: null, spawnSel: null };

    this.backdrop = el('<div class="backdrop"></div>');
    ui.root.appendChild(this.backdrop);
    this.backdrop.addEventListener('click', () => this.close());

    this.sheets = {};
    for (const [name, title] of [
      ['collection', 'Collection'],
      ['spawn', 'Spawn Block'],
      ['daily', 'Daily Challenge'],
      ['settings', 'Settings'],
      ['help', 'How to Play'],
    ]) {
      const s = el(
        `<section class="sheet" aria-label="${title}"><div class="sheet-head"><h2>${title}</h2><span class="sub"></span><button class="x" type="button" aria-label="Close">${svg('close')}</button></div><div class="sheet-body"></div></section>`,
      );
      s.querySelector('.x').addEventListener('click', () => this.close());
      ui.root.appendChild(s);
      this.sheets[name] = { el: s, body: s.querySelector('.sheet-body'), sub: s.querySelector('.sub') };
    }

    this.modal = el(
      `<div class="modal"><div class="card"><h3>Reset all progress?</h3>
        <p>This permanently deletes your Collection, highest number, stats and daily progress. This cannot be undone.</p>
        <div class="row"><button class="secondary" data-no type="button">Cancel</button><button class="danger" data-yes type="button">Delete everything</button></div></div></div>`,
    );
    ui.root.appendChild(this.modal);
    this.modal.querySelector('[data-no]').addEventListener('click', () => this.modal.classList.remove('open'));
    this.modal.querySelector('[data-yes]').addEventListener('click', () => {
      this.modal.classList.remove('open');
      this.game.resetProgress();
      this.render();
    });

    game.events.on('discover', () => this.current === 'collection' && this.render());
    game.events.on('dailyChanged', () => this.current === 'daily' && this.render());
    this.tick = setInterval(() => {
      if (this.current === 'daily') this.updateCountdown();
    }, 1000);
  }

  get isOpen() {
    return this.current !== null;
  }

  open(name) {
    if (this.current === name) return this.close();
    if (this.current) this.sheets[this.current].el.classList.remove('open');
    this.current = name;
    this.game.input.setEnabled(false);
    this.game.gun.setPull(false);
    this.render();
    this.sheets[name].el.classList.add('open');
    this.backdrop.classList.add('open');
    this.game.audio.panel(true);
  }

  close() {
    if (!this.current) return;
    this.sheets[this.current].el.classList.remove('open');
    this.backdrop.classList.remove('open');
    this.modal.classList.remove('open');
    this.current = null;
    this.game.input.setEnabled(true);
    this.game.audio.panel(false);
    this.game.save.save(true);
  }

  render() {
    if (!this.current) return;
    const fn = { collection: 'renderCollection', spawn: 'renderSpawn', daily: 'renderDaily', settings: 'renderSettings', help: 'renderHelp' }[this.current];
    const s = this.sheets[this.current];
    const top = s.body.scrollTop;
    this[fn](s);
    s.body.scrollTop = top;
  }

  // ------------------------------------------------------------------ collection

  items() {
    const col = this.game.collection;
    const found = col.sortedValues();
    const q = this.state.search;
    let list = [];
    if (q) {
      list = found.filter((v) => v.toString().includes(q)).map((v) => ({ v, locked: false }));
    } else {
      const max = col.maxValue;
      const topBit = Math.max(10, Math.ceil(log2Big(max)) + 3);
      const set = new Set(found.map((v) => v.toString()));
      const all = found.map((v) => ({ v, locked: false }));
      for (let i = 0; i <= Math.min(topBit, 70); i++) {
        const p = 1n << BigInt(i);
        if (!set.has(p.toString())) all.push({ v: p, locked: true });
      }
      all.sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
      list = all;
    }
    if (this.state.desc) list.reverse();
    return list;
  }

  renderCollection({ body, sub }) {
    const g = this.game;
    const col = g.collection;
    sub.textContent = `${col.size} found`;
    const st = g.save.data.stats;
    const list = this.items();
    const shown = list.slice(0, this.state.shown);
    const maxStr = col.maxValue.toString();

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${col.size}</b><span>Discovered</span></div>
        <div class="stat"><b>${fmtCompact(col.maxValue)}</b><span>Highest</span></div>
        <div class="stat"><b>${st.merges}</b><span>Merges</span></div>
      </div>
      <div class="row">
        <input class="search" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Search a number…" value="${this.state.search}" aria-label="Search numbers" />
        <button class="sq" type="button" data-sort aria-label="Toggle sort">${this.state.desc ? '9→1' : '1→9'}</button>
      </div>
      <div class="detail-slot"></div>
      <div class="grid"></div>`;

    const grid = body.querySelector('.grid');
    for (const it of shown) {
      if (it.locked) {
        const t = el('<div class="tile locked" title="Not discovered yet">?</div>');
        t.addEventListener('click', () => g.events.emit('toast', { text: 'Locked - merge blocks to discover this number', kind: 'hint' }));
        grid.appendChild(t);
      } else {
        const key = it.v.toString();
        const e = col.entry(it.v);
        const t = el(`<button class="tile${this.state.selected === key ? ' sel' : ''}${key === maxStr ? ' best' : ''}" type="button" style="${bgOf(it.v)}">${fmtCompact(it.v)}<span class="cnt">×${e ? e.c : 1}</span></button>`);
        t.style.fontSize = fmtCompact(it.v).length > 5 ? '13px' : fmtCompact(it.v).length > 3 ? '15px' : '18px';
        t.addEventListener('click', () => {
          this.state.selected = key;
          g.audio.tap();
          this.render();
        });
        grid.appendChild(t);
      }
    }
    if (shown.length === 0) {
      grid.appendChild(el('<div class="note" style="grid-column:1/-1;text-align:center">No discovered number matches your search.</div>'));
    }
    if (list.length > shown.length) {
      const more = el(`<button class="more" type="button">Show more (${list.length - shown.length})</button>`);
      more.addEventListener('click', () => {
        this.state.shown += PAGE;
        this.render();
      });
      grid.appendChild(more);
    }

    const search = body.querySelector('.search');
    search.addEventListener('input', () => {
      const v = search.value.replace(/\D/g, '');
      this.state.search = v;
      this.state.shown = PAGE;
      const pos = search.selectionStart;
      this.render();
      const s2 = this.sheets.collection.body.querySelector('.search');
      s2.focus();
      try {
        s2.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
    body.querySelector('[data-sort]').addEventListener('click', () => {
      this.state.desc = !this.state.desc;
      this.render();
    });

    const sel = this.state.selected && parseBig(this.state.selected);
    if (sel && col.has(sel)) body.querySelector('.detail-slot').appendChild(this.detailCard(sel));
  }

  detailCard(v) {
    const g = this.game;
    const col = g.collection;
    const e = col.entry(v);
    const best = v === col.maxValue;
    const edge = edgeOf(v);
    const card = el(
      `<div class="detail">
        <span class="big" style="${bgOf(v)}">${fmtCompact(v)}</span>
        ${best ? '<span style="margin-left:8px;color:#ffe27a;font-weight:800">★ Highest</span>' : ''}
        <div class="full">${fmtFull(v)}</div>
        <dl>
          <dt>Level</dt><dd>${TIER_NAMES[tierIndex(tierPos(v))]}</dd>
          <dt>Digits</dt><dd>${v.toString().length}</dd>
          <dt>Times found</dt><dd>${e.c}</dd>
          <dt>First discovered</dt><dd>${fmtDate(e.t)}</dd>
          <dt>Block mass</dt><dd>${massOf(edge).toFixed(0)} kg</dd>
        </dl>
        <button class="primary" type="button">Spawn this block</button>
      </div>`,
    );
    card.querySelector('.primary').addEventListener('click', () => {
      const b = g.spawnValue(v);
      if (b) this.close();
    });
    return card;
  }

  // ------------------------------------------------------------------ spawn

  spawnChoices() {
    const col = this.game.collection;
    const found = col.sortedValues();
    const keys = new Set();
    const out = [];
    const add = (v) => {
      const k = v.toString();
      if (!keys.has(k)) {
        keys.add(k);
        out.push(v);
      }
    };
    add(1n);
    add(col.maxValue);
    // most recently discovered first
    const recent = Object.entries(this.game.save.data.collection)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 14)
      .map(([k]) => parseBig(k))
      .filter(Boolean);
    recent.forEach(add);
    found.filter((v) => (v & (v - 1n)) === 0n).slice(0, 30).forEach(add);
    return out.slice(0, 40);
  }

  renderSpawn({ body, sub }) {
    const g = this.game;
    const choices = this.spawnChoices();
    if (!this.state.spawnSel || !g.collection.has(BigInt(this.state.spawnSel))) this.state.spawnSel = '1';
    const sel = BigInt(this.state.spawnSel);
    sub.textContent = `Blocks ${g.blocks.count}/${MAX_BLOCKS}`;
    body.innerHTML = `
      <p class="note">Choose a number from your Collection and conjure a fresh block in front of you. Your Collection is never used up.</p>
      <div class="chips"></div>
      <div class="detail" style="text-align:center">
        <span class="big" style="${bgOf(sel)}">${fmtCompact(sel)}</span>
        <div class="full">${fmtFull(sel)}</div>
      </div>
      <div class="row" style="margin-top:12px">
        <input class="search" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Type a discovered number…" aria-label="Type a number" />
      </div>
      <div class="note msg"></div>
      <button class="primary" type="button">Spawn</button>
      <button class="secondary" type="button" style="width:100%;margin-top:8px" data-col>Open Collection</button>`;
    const chips = body.querySelector('.chips');
    for (const v of choices) {
      const k = v.toString();
      const c = el(`<button class="chipv${k === this.state.spawnSel ? ' sel' : ''}" type="button" style="${bgOf(v)}">${fmtCompact(v)}</button>`);
      c.addEventListener('click', () => {
        this.state.spawnSel = k;
        g.audio.tap();
        this.render();
      });
      chips.appendChild(c);
    }
    const input = body.querySelector('.search');
    const msg = body.querySelector('.msg');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
      const v = parseBig(input.value);
      if (!input.value) msg.textContent = '';
      else if (v && g.collection.has(v)) {
        this.state.spawnSel = v.toString();
        msg.textContent = '✓ Found in your Collection';
        msg.style.color = '#48e29a';
        body.querySelector('.big').textContent = fmtCompact(v);
        body.querySelector('.big').setAttribute('style', bgOf(v));
        body.querySelector('.full').textContent = fmtFull(v);
      } else {
        msg.textContent = 'You have not discovered that number yet.';
        msg.style.color = '#ff9aa4';
      }
    });
    body.querySelector('.primary').addEventListener('click', () => {
      const b = g.spawnValue(BigInt(this.state.spawnSel));
      if (b) this.close();
    });
    body.querySelector('[data-col]').addEventListener('click', () => this.open('collection'));
  }

  // ------------------------------------------------------------------ daily

  renderDaily({ body, sub }) {
    const g = this.game;
    const d = g.daily;
    const st = g.save.data.stats;
    sub.textContent = `★ ${st.stars}`;
    const rewards = g.save.data.rewards;
    body.innerHTML = `
      <p class="note">New challenges appear every day and work offline. Missing a day never costs you anything. Finish all three to earn a star and a new merge effect.</p>
      <div class="quests"></div>
      <div class="note countdown" style="text-align:center"></div>
      <div class="section">Merge effects</div>
      <div class="fxrow"></div>`;
    const qs = body.querySelector('.quests');
    for (const q of d.quests) {
      const pct = Math.round(d.fraction(q) * 100);
      qs.appendChild(
        el(`<div class="quest${q.done ? ' done' : ''}"><div class="t"><span>${q.title}</span><span>${q.done ? '✓' : ''}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="p">${d.progressText(q)}</div></div>`),
      );
    }
    const row = body.querySelector('.fxrow');
    for (const f of FX_LIST) {
      const unlocked = rewards.unlocked.includes(f.id);
      const b = el(`<button class="fx${rewards.selectedFx === f.id ? ' on' : ''}${unlocked ? '' : ' lock'}" type="button">${unlocked ? f.name : '🔒 ' + f.name}</button>`);
      b.addEventListener('click', () => {
        if (!unlocked) {
          g.events.emit('toast', { text: 'Complete all daily challenges to unlock', kind: 'hint' });
          return;
        }
        rewards.selectedFx = f.id;
        g.save.save(true);
        g.audio.tap();
        this.render();
      });
      row.appendChild(b);
    }
    this.updateCountdown();
  }

  updateCountdown() {
    const n = new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    const ms = next - n;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const el2 = this.sheets.daily.body.querySelector('.countdown');
    if (el2) el2.textContent = `New challenges in ${h}h ${m}m`;
  }

  // ------------------------------------------------------------------ settings

  renderSettings({ body }) {
    const g = this.game;
    const s = g.save.data.settings;
    const st = g.save.data.stats;
    body.innerHTML = `
      <div class="section" style="margin-top:4px">Graphics quality</div>
      <div class="seg">${Object.values(QUALITY)
        .map((q) => `<button type="button" data-q="${q.id}" class="${s.quality === q.id ? 'on' : ''}">${q.label}</button>`)
        .join('')}</div>
      <p class="note">Low is the default and keeps phones cool. You can change this at any time without restarting.</p>
      <div class="setting"><label>Shadows</label><button class="switch${s.shadows ? ' on' : ''}" type="button" data-shadows aria-label="Toggle shadows"></button></div>
      <div class="section">Audio &amp; controls</div>
      <div class="setting"><label>Sound</label><button class="switch${s.sound ? ' on' : ''}" type="button" data-sound aria-label="Toggle sound"></button></div>
      <div class="setting"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-vol /></div>
      <div class="setting"><label>Look speed</label><input type="range" min="0.5" max="2" step="0.1" value="${s.sensitivity}" data-sens /></div>
      <div class="setting"><label>Fullscreen</label><button class="secondary" type="button" data-fs>Toggle</button></div>
      <div class="section">Your stats</div>
      <div class="detail" style="margin:0;padding:12px"><dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:13.5px">
        <dt style="color:var(--muted)">Merges</dt><dd style="margin:0;text-align:right;font-weight:700">${st.merges}</dd>
        <dt style="color:var(--muted)">Numbers discovered</dt><dd style="margin:0;text-align:right;font-weight:700">${g.collection.size}</dd>
        <dt style="color:var(--muted)">Highest number</dt><dd style="margin:0;text-align:right;font-weight:700;word-break:break-all">${fmtCompact(g.collection.maxValue)}</dd>
        <dt style="color:var(--muted)">Blocks spawned</dt><dd style="margin:0;text-align:right;font-weight:700">${st.spawned}</dd>
        <dt style="color:var(--muted)">Splashes</dt><dd style="margin:0;text-align:right;font-weight:700">${st.splashes}</dd>
        <dt style="color:var(--muted)">Days played</dt><dd style="margin:0;text-align:right;font-weight:700">${st.daysPlayed}</dd>
        <dt style="color:var(--muted)">Daily stars</dt><dd style="margin:0;text-align:right;font-weight:700">${st.stars}</dd>
      </dl></div>
      <div class="section">Danger zone</div>
      <p class="note">“Reset Blocks” (the ↺ button) only clears blocks in the world. This button wipes your saved progress.</p>
      <button class="danger" type="button" data-reset>Reset Progress…</button>`;
    body.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        g.setQuality(b.dataset.q);
        g.audio.tap();
        this.render();
      }),
    );
    body.querySelector('[data-shadows]').addEventListener('click', () => {
      g.setShadows(!s.shadows);
      g.audio.tap();
      this.render();
    });
    body.querySelector('[data-sound]').addEventListener('click', () => {
      s.sound = !s.sound;
      g.audio.unlock();
      g.audio.setEnabled(s.sound);
      g.save.save(true);
      this.render();
      g.audio.tap();
    });
    body.querySelector('[data-vol]').addEventListener('input', (e) => {
      s.volume = parseFloat(e.target.value);
      g.audio.setVolume(s.volume);
      g.save.save();
    });
    body.querySelector('[data-sens]').addEventListener('input', (e) => {
      s.sensitivity = parseFloat(e.target.value);
      g.save.save();
    });
    body.querySelector('[data-fs]').addEventListener('click', () => g.toggleFullscreen());
    body.querySelector('[data-reset]').addEventListener('click', () => this.modal.classList.add('open'));
  }

  // ------------------------------------------------------------------ help

  renderHelp({ body }) {
    body.innerHTML = `
      <p class="note" style="font-size:14px">Use your Physics Gun to grab, push and throw number blocks. Smash two blocks together hard enough and they merge into one bigger number. Every new number is saved in your Collection.</p>
      <div class="section">Controls</div>
      <ul class="helplist">
        <li><b>Left thumb</b> (lower-left): drag for the virtual joystick and walk.</li>
        <li><b>Drag anywhere else</b> to look around.</li>
        <li><b>Grab / Release</b>: aim at a block and tap to hold it, tap again to let go.</li>
        <li><b>Push</b>: shove the block you aim at. <b>Pull</b>: hold to draw it to you.</li>
        <li><b>Rotate</b>: while holding a block, tap Rotate, then drag to turn it.</li>
        <li><b>Throw</b>: launch the held block hard. Merging needs a real impact!</li>
        <li><b>Numbers</b> opens your Collection. <b>Spawn</b> conjures a collected number. <b>Reset</b> clears the blocks only.</li>
      </ul>
      <div class="section">Tips</div>
      <ul class="helplist">
        <li>Grab one “1”, turn around and throw it at the other “1”.</li>
        <li>Blocks of different values merge too: 2 + 4 = 6.</li>
        <li>Look at a block to see its exact value. Try dropping blocks into the pond!</li>
      </ul>
      <div class="section">Keyboard (desktop)</div>
      <ul class="helplist">
        <li><span class="kbd">WASD</span> move · drag mouse to look · <span class="kbd">E</span> grab · <span class="kbd">F</span> push · hold <span class="kbd">Q</span> pull · <span class="kbd">R</span> rotate · <span class="kbd">T</span> throw · wheel: hold distance</li>
        <li><span class="kbd">C</span> collection · <span class="kbd">N</span> spawn · <span class="kbd">X</span> reset blocks · <span class="kbd">Esc</span> close panel</li>
      </ul>
      <button class="primary" type="button" data-tips>Show welcome tips</button>`;
    body.querySelector('[data-tips]').addEventListener('click', () => {
      this.close();
      this.ui.showTutorial(8000);
    });
  }
}
