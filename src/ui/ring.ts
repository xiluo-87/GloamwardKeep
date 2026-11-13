// The action ring around the selected tile, and the description card shown while an item is pressed
// (touch) or hovered (mouse). Pressing shows the card and a ghost on the map; releasing on the item acts;
// sliding off before release cancels.
import { HEROES, HeroId, TOWERS, TOWER_IDS, TowerId } from '../data/balance';
import { ABILITY_TEXT, CLEAR_TEXT, describeMod, HERO_TEXT, TOWER_TEXT } from '../data/text';
import type { CameraApi } from '../render/view';
import { canBuild, clearCost } from '../sim/actions';
import { FEATURE } from '../sim/mapgen';
import { towerAt, Tower, TARGET_MODES } from '../sim/state';
import type { RunState } from '../sim/state';
import { sellValue, upgradeOptions } from '../sim/stats';
import { esc, flagList, statLine } from './format';
import { ACTION_ICONS, iconFor } from './icons';
import { checkMessage, isUndo } from './session';
import type { Session } from './session';

const TARGET_TEXT: Record<string, string> = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };
const HOLD_MS = 600;

export interface DescInfo { title: string; sub?: string; body: string; cost?: number; warn?: string }

export interface RingItem {
  key: string;
  icon: string;
  label: string;
  cost?: number;
  hold?: boolean;
  keepOpen?: boolean;
  /** Build item: shows a ghost on the tile while pressed. */
  place?: TowerId | HeroId;
  desc: (s: RunState) => DescInfo;
  /** Per-frame state: greyed out, and an optional replacement for the cost line. */
  state: (s: RunState) => { poor: boolean; sub?: string };
  run: () => void;
}

// -- descriptions -------------------------------------------------------------------------------

function towerDesc(id: TowerId): DescInfo {
  const d = TOWERS[id];
  const t = TOWER_TEXT[id];
  const flags = flagList(d.base).join(' · ');
  return {
    title: t.name, cost: d.cost,
    body: `<p>${esc(t.blurb)}</p><p class="stats">${esc(statLine(d.base))}${flags ? ` · ${flags}` : ''}</p>` +
      (id === 'palisade' ? '<p><b>Mazing:</b> walls on the road steer enemies onto longer routes. They only smash walls when every route is sealed.</p>' : '') +
      `<p class="sub">Upgrades twice, then forks: ${esc(t.forks.a.name)} or ${esc(t.forks.b.name)}. Higher ground gives more range.</p>`,
  };
}

function heroDesc(id: HeroId): DescInfo {
  const d = HEROES[id];
  const t = HERO_TEXT[id];
  const flags = flagList(d.base).join(' · ');
  return {
    title: t.name, sub: t.title, cost: d.cost,
    body: `<p>${esc(t.blurb)}</p><p class="stats">${esc(statLine(d.base))}${flags ? ` · ${flags}` : ''}</p>` +
      `<p><b>${esc(t.ability)}:</b> ${esc(t.abilityDesc)}</p><p class="sub">Unique: one on the board. Levels up from kills, learns skills for gold.</p>`,
  };
}

// -- items --------------------------------------------------------------------------------------

export function buildItems(s: RunState, ss: Session): RingItem[] {
  const tile = ss.tile;
  if (!tile) return [];
  const { col, row } = tile;
  const i = row * s.terrain.cols + col;
  const t = towerAt(s, col, row);
  if (t) return t.hero ? heroItems(s, ss, t) : towerItems(s, ss, t);
  if (s.terrain.feature[i] !== FEATURE.none) {
    const cost = clearCost(s, col, row);
    if (cost === 0) return [];
    const f = s.terrain.feature[i] === FEATURE.forest ? CLEAR_TEXT.forest : CLEAR_TEXT.rocks;
    return [{
      key: 'clear', icon: ACTION_ICONS.clear, label: 'Clear', cost,
      desc: () => ({ title: f.action, cost, body: `<p>${esc(CLEAR_TEXT.hint)}</p>` }),
      state: (st) => ({ poor: st.gold < cost }),
      run: () => ss.clearHere(),
    }];
  }
  const { goal, spawns } = s.terrain;
  if ((goal[0] === col && goal[1] === row) || spawns.some(([x, y]) => x === col && y === row)) return [];
  const items: RingItem[] = [];
  const add = (id: TowerId | HeroId, desc: DescInfo, name: string): void => {
    const cost = ss.costOf(id);
    items.push({
      key: id, icon: iconFor(id), label: name, cost, place: id,
      desc: (st) => {
        const d = { ...desc, cost };
        const check = canBuild(st, id, col, row);
        if (check !== 'ok' && check !== 'gold') d.warn = checkMessage(st, check, col, row);
        else if (ss.view.routeSealed) d.warn = 'Enemies will smash through here — every route would be sealed.';
        else if (ss.view.routePreview && st.terrain.height[i] === 0) d.sub = 'Enemies will walk the dotted route';
        return d;
      },
      state: (st) => ({ poor: st.gold < cost }),
      run: () => { ss.buildHere(id); },
    });
  };
  for (const id of TOWER_IDS) add(id, towerDesc(id), TOWER_TEXT[id].name.replace(' Tower', ''));
  for (const h of s.cfg.heroes) if (!s.heroesPlaced.includes(h)) add(h, heroDesc(h), HERO_TEXT[h].name.replace('The ', ''));
  return items;
}

function commonItems(s: RunState, ss: Session, t: Tower, items: RingItem[]): void {
  items.push({
    key: 'target', icon: ACTION_ICONS.target, label: TARGET_TEXT[t.target], keepOpen: true,
    desc: () => ({
      title: `Target: ${TARGET_TEXT[t.target]}`,
      body: `<p>Which enemy it aims at. Tap to cycle: ${TARGET_MODES.map((m) => TARGET_TEXT[m]).join(' → ')}.</p>`,
    }),
    state: () => ({ poor: false }),
    run: () => ss.target(),
  });
  const undo = isUndo(t);
  const value = sellValue(t, s.mods);
  items.push({
    key: 'sell', icon: undo ? ACTION_ICONS.undo : ACTION_ICONS.sell, label: undo ? 'Undo' : t.hero ? 'Dismiss' : 'Sell', hold: !undo,
    desc: () => ({
      title: undo ? 'Undo — full refund' : t.hero ? 'Dismiss hero' : 'Sell',
      body: undo
        ? `<p>Built or upgraded this wave, so you get all ${value} gold back.</p>`
        : `<p>Returns ${value} gold.</p><p><b>Press and hold</b> to confirm.</p>`,
    }),
    state: () => ({ poor: false, sub: `+${value}` }),
    run: () => ss.sellNow(),
  });
}

function towerItems(s: RunState, ss: Session, t: Tower): RingItem[] {
  const items: RingItem[] = [];
  const tx = TOWER_TEXT[t.type as TowerId];
  const opts = upgradeOptions(t, s.mods);
  for (const o of opts) {
    const fork = o.path === 'tier' ? null : tx.forks[o.path];
    const next = o.path === 'tier' ? tx.tiers[o.level - 1] : tx.forks[o.path].tiers[o.level - 1];
    items.push({
      key: `up-${o.path}`, icon: ACTION_ICONS.upgrade, label: fork && t.forkTier === 0 ? fork.name : 'Upgrade', cost: o.cost, keepOpen: true,
      desc: () => ({
        title: fork && t.forkTier === 0 ? fork.name : `Upgrade: ${next}`,
        sub: fork && t.forkTier === 0 ? `Fork ${o.path.toUpperCase()} — a permanent choice` : next,
        cost: o.cost,
        body: `${fork && t.forkTier === 0 ? `<p>${esc(fork.blurb)}</p>` : ''}<p class="mod">${esc(describeMod(o.upgrade.add))}</p>`,
      }),
      state: (st) => ({ poor: st.gold < o.cost }),
      run: () => { ss.upgradeSelected(o.path === 'tier' ? undefined : o.path); },
    });
  }
  commonItems(s, ss, t, items);
  return items;
}

function heroItems(s: RunState, ss: Session, t: Tower): RingItem[] {
  const items: RingItem[] = [];
  const h = HEROES[t.type as HeroId];
  const tx = HERO_TEXT[t.type as HeroId];
  items.push({
    key: 'ability', icon: ACTION_ICONS.ability, label: ABILITY_TEXT[h.ability], keepOpen: true,
    desc: () => ({ title: ABILITY_TEXT[h.ability], sub: t.abilityCd > 0 ? `Recharging: ${Math.ceil(t.abilityCd)}s` : 'Ready', body: `<p>${esc(tx.abilityDesc)}</p>` }),
    state: () => ({ poor: t.abilityCd > 0, sub: t.abilityCd > 0 ? `${Math.ceil(t.abilityCd)}s` : 'Ready' }),
    run: () => ss.ability(t.uid),
  });
  items.push({
    key: 'skills', icon: ACTION_ICONS.skills, label: 'Skills',
    desc: () => ({ title: 'Skills', sub: `Level ${t.heroLevel}`, body: '<p>Three branches of four skills, bought with gold. Only one capstone.</p>' }),
    state: () => ({ poor: false }),
    run: () => ss.openSheet(),
  });
  commonItems(s, ss, t, items);
  return items;
}

// -- the ring and description card --------------------------------------------------------------

export class Ring {
  private items: RingItem[] = [];
  private els: HTMLElement[] = [];
  private offsets: [number, number][] = [];
  private sig = '';
  private shown = false;
  private cur = -1;
  private pressId: number | null = null;
  private holdTimer = 0;
  private pos = '';
  private card: HTMLElement;

  constructor(private root: HTMLElement, card: HTMLElement, private session: Session, private cam: CameraApi) {
    this.card = card;
    root.addEventListener('pointerdown', (e) => {
      const i = this.indexAt(e.target as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      this.pressId = e.pointerId;
      try { root.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
      this.enter(i, true);
    });
    root.addEventListener('pointermove', (e) => {
      if (this.pressId === null) {
        if (e.pointerType === 'mouse') this.enter(this.indexAt(document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null), false);
        return;
      }
      if (e.pointerId !== this.pressId) return;
      const i = this.indexAt(document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null);
      if (i !== this.cur) this.enter(i, true);
    });
    root.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.pressId) return;
      const i = this.cur;
      const it = this.items[i];
      this.pressId = null;
      window.clearTimeout(this.holdTimer);
      this.root.querySelectorAll('.holding').forEach((x) => x.classList.remove('holding'));
      if (it && !it.hold) this.activate(it);
      else this.leave();
    });
    root.addEventListener('pointercancel', () => { this.pressId = null; this.leave(); });
    root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this.pressId === null) this.leave(); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private indexAt(el: HTMLElement | null): number {
    const b = el?.closest?.('.ri') as HTMLElement | null;
    return b ? this.els.indexOf(b) : -1;
  }

  private enter(i: number, press: boolean): void {
    window.clearTimeout(this.holdTimer);
    this.root.querySelectorAll('.holding').forEach((x) => x.classList.remove('holding'));
    if (i === this.cur && !press) return;
    this.cur = i;
    const it = this.items[i];
    const s = this.session.run;
    if (!it || !s) { this.leave(); return; }
    if (it.place) this.session.previewBuild(it.place); else this.session.previewPlain(true);
    this.showCard(it.desc(s));
    if (press && it.hold) {
      this.els[i].classList.add('holding');
      this.holdTimer = window.setTimeout(() => { this.pressId = null; this.activate(it); }, HOLD_MS);
    }
  }

  private leave(): void {
    window.clearTimeout(this.holdTimer);
    this.cur = -1;
    this.card.hidden = true;
    this.session.previewPlain(false);
  }

  private activate(it: RingItem): void {
    this.leave();
    it.run();
    if (!it.keepOpen) this.session.closeOverlays();
  }

  private showCard(d: DescInfo): void {
    const ys = this.session.tile && this.session.run ? this.cam.tileToScreen(this.session.tile.col, this.session.tile.row).y : 400;
    this.card.className = ys < 330 ? 'bottom' : 'top';
    const s = this.session.run;
    const warn = d.warn ? `<p class="warn">${esc(d.warn)}</p>` : '';
    this.card.innerHTML = `<div class="dh"><h4>${esc(d.title)}</h4>${d.cost !== undefined ? `<b class="price${s && s.gold < d.cost ? ' poor' : ''}">${d.cost} gold</b>` : ''}</div>${d.sub ? `<p class="sub">${esc(d.sub)}</p>` : ''}${d.body}${warn}`;
    this.card.hidden = false;
  }

  private rebuild(s: RunState, items: RingItem[]): void {
    this.items = items;
    this.root.innerHTML = '';
    this.els = items.map((it, k) => {
      const b = document.createElement('button');
      b.className = `ri${it.hold ? ' hold' : ''}`;
      b.setAttribute('aria-label', it.label);
      b.innerHTML = `<span class="rl">${esc(it.label)}</span><span class="ic">${it.icon}</span><span class="co">${it.cost ?? ''}</span>`;
      b.dataset.i = String(k);
      this.root.appendChild(b);
      return b;
    });
    const n = items.length;
    const offs: [number, number][] = [];
    if (n <= 5) {
      const r = 82;
      for (let k = 0; k < n; k++) {
        const th = n === 1 ? -Math.PI / 2 : -Math.PI - 0.2 + (k * (Math.PI + 0.4)) / (n - 1);
        offs.push([r * Math.cos(th), r * Math.sin(th)]);
      }
    } else {
      const r = Math.max(96, (74 * n) / (2 * Math.PI) + 8);
      for (let k = 0; k < n; k++) {
        const th = -Math.PI / 2 + (k * 2 * Math.PI) / n;
        offs.push([r * Math.cos(th), r * Math.sin(th)]);
      }
    }
    this.offsets = offs;
    this.els.forEach((el, k) => { el.style.transform = `translate(${offs[k][0].toFixed(1)}px, ${offs[k][1].toFixed(1)}px)`; });
    this.pos = '';
    void s;
  }

  /** Per-frame: rebuild on structural change, otherwise reposition and patch affordability. */
  update(s: RunState, safe: { top: number; bottom: number }): void {
    const ss = this.session;
    const tile = ss.tile;
    if (!ss.ring || !tile) {
      if (this.shown) { this.shown = false; this.root.hidden = true; this.root.innerHTML = ''; this.items = []; this.els = []; this.sig = ''; this.leave(); }
      return;
    }
    const t = towerAt(s, tile.col, tile.row);
    const sig = `${tile.col},${tile.row}|${t ? `${t.uid}.${t.tier}.${t.fork}.${t.forkTier}.${t.target}.${isUndo(t) ? 1 : 0}` : 'e'}|${s.terrain.feature[tile.row * s.terrain.cols + tile.col]}|${s.heroesPlaced.join()}`;
    if (!this.shown || sig !== this.sig) {
      const items = buildItems(s, ss);
      if (items.length === 0) { ss.closeOverlays(); return; }
      this.sig = sig;
      this.shown = true;
      this.root.hidden = false;
      if (this.pressId === null) this.cur = -1;
      this.rebuild(s, items);
    }
    const c = this.cam.tileToScreen(tile.col, tile.row);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [x, y] of this.offsets) {
      minX = Math.min(minX, x - 34); maxX = Math.max(maxX, x + 34);
      minY = Math.min(minY, y - 36); maxY = Math.max(maxY, y + 36);
    }
    let cx = c.x;
    let cy = c.y;
    const W = window.innerWidth;
    if (cx + minX < 6) cx = 6 - minX;
    if (cx + maxX > W - 6) cx = W - 6 - maxX;
    if (cy + minY < safe.top + 6) cy = safe.top + 6 - minY;
    if (cy + maxY > safe.bottom - 6) cy = safe.bottom - 6 - maxY;
    const pos = `${Math.round(cx)},${Math.round(cy)}`;
    if (pos !== this.pos) { this.pos = pos; this.root.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`; }
    this.items.forEach((it, k) => {
      const st = it.state(s);
      const el = this.els[k];
      el.classList.toggle('poor', st.poor);
      const co = el.querySelector('.co') as HTMLElement;
      const txt = st.sub ?? (it.cost !== undefined ? String(it.cost) : '');
      if (co.textContent !== txt) co.textContent = txt;
    });
  }
}
