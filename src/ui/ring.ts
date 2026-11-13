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
    key: 'skills', icon: ACTION_ICONS.skills, label: 'Skills', keepOpen: true,
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
  private lay = '';
  private guide: SVGSVGElement | null = null;
  private sig = '';
  private shown = false;
  private cur = -1;
  private pressId: number | null = null;
  private holdTimer = 0;
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

  private rebuild(items: RingItem[]): void {
    this.items = items;
    this.root.innerHTML = '<svg class="rg" aria-hidden="true"></svg>';
    this.guide = this.root.firstChild as SVGSVGElement;
    this.els = items.map((it, k) => {
      const b = document.createElement('button');
      b.className = `ri${it.hold ? ' hold' : ''}`;
      b.setAttribute('aria-label', it.desc(this.session.run as RunState).title);
      b.innerHTML = `<span class="cir"><span class="ic">${it.icon}</span></span><span class="co">${it.cost ?? ''}</span>`;
      b.dataset.i = String(k);
      this.root.appendChild(b);
      return b;
    });
    this.lay = '';
  }

  /** Per-frame: rebuild on structural change, otherwise lay out around the tile and patch affordability. */
  update(s: RunState, free: Rect): void {
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
      this.rebuild(items);
    }
    const c = this.cam.tileToScreen(tile.col, tile.row);
    const cardEl = document.getElementById('card');
    const card = cardEl && !cardEl.hidden ? cardEl.getBoundingClientRect() : null;
    const key = `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.r)}|${free.left},${free.top},${free.right},${free.bottom}|${card ? `${Math.round(card.right)},${Math.round(card.bottom)}` : ''}|${this.items.length}`;
    if (key !== this.lay) {
      this.lay = key;
      const L = layoutRing(this.items.length, c.x, c.y, c.r, free, card ? { left: card.left - 4, top: card.top - 4, right: card.right + 4, bottom: card.bottom + 4 } : null);
      this.els.forEach((el, k) => { el.style.transform = `translate(${Math.round(L.pts[k][0])}px, ${Math.round(L.pts[k][1])}px)`; });
      this.drawGuide(c.x, c.y, L);
    }
    this.items.forEach((it, k) => {
      const st = it.state(s);
      const el = this.els[k];
      el.classList.toggle('poor', st.poor);
      const co = el.querySelector('.co') as HTMLElement;
      const txt = st.sub ?? (it.cost !== undefined ? String(it.cost) : '');
      if (co.textContent !== txt) co.textContent = txt;
    });
  }

  private drawGuide(cx: number, cy: number, L: RingLayout): void {
    if (!this.guide) return;
    let d = '';
    for (const row of L.rows) {
      const { r, a0, a1, full } = row;
      if (full) d += `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 `;
      else {
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        d += `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} `;
      }
    }
    this.guide.innerHTML = `<path d="${d}" />`;
  }
}

// -- layout -------------------------------------------------------------------------------------

export interface Rect { left: number; top: number; right: number; bottom: number }
interface Row { r: number; a0: number; a1: number; full: boolean }
export interface RingLayout { pts: [number, number][]; rows: Row[]; fits: boolean }

const CIR = 46;
const GAP = 4;
const ROW_GAP = 70;

type Pt = [number, number];
/** Item shapes: the 46 px circle and, under it, the cost pill (about 40 x 15, 2 px below). */
const circBox = (p: Pt): Rect => ({ left: p[0] - CIR / 2, top: p[1] - CIR / 2, right: p[0] + CIR / 2, bottom: p[1] + CIR / 2 });
const pillBox = (p: Pt): Rect => ({ left: p[0] - 20, top: p[1] + CIR / 2 + 2, right: p[0] + 20, bottom: p[1] + CIR / 2 + 17 });
const hits = (a: Rect, b: Rect, m = 0): boolean => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
const inside = (b: Rect, f: Rect): boolean => b.left >= f.left && b.right <= f.right && b.top >= f.top && b.bottom <= f.bottom;
function circleHitsBox(c: Pt, b: Rect, m: number): boolean {
  const dx = Math.max(b.left - c[0], 0, c[0] - b.right);
  const dy = Math.max(b.top - c[1], 0, c[1] - b.bottom);
  return Math.hypot(dx, dy) < CIR / 2 + m;
}
function itemsHit(a: Pt, b: Pt): boolean {
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < CIR + GAP) return true;
  const pa = pillBox(a), pb = pillBox(b);
  return hits(pa, pb, 2) || circleHitsBox(a, pb, 2) || circleHitsBox(b, pa, 2);
}

function rowPoints(n: number, r: number, mid: number, span: number, phase: number, cx: number, cy: number): Pt[] {
  const out: Pt[] = [];
  const full = span >= Math.PI * 2 - 1e-6;
  for (let k = 0; k < n; k++) {
    let a: number;
    if (n === 1) a = mid;
    else if (full) a = mid + Math.PI + ((k + phase) * 2 * Math.PI) / n;
    else a = mid - span / 2 + ((k + phase) * span) / (n - 1 + (phase ? 1 : 0));
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function valid(pts: Pt[], free: Rect, card: Rect | null): boolean {
  for (let i = 0; i < pts.length; i++) {
    const c = circBox(pts[i]);
    const pl = pillBox(pts[i]);
    if (!inside(c, free) || !inside(pl, free)) return false;
    if (card && (hits(c, card) || hits(pl, card))) return false;
    for (let j = 0; j < i; j++) if (itemsHit(pts[i], pts[j])) return false;
  }
  return true;
}

/** Items per row, roughly in proportion to each row's radius (outer rows hold more). */
function splitCounts(n: number, radii: number[]): number[] {
  if (radii.length === 1) return [n];
  const sum = radii.reduce((a, b) => a + b, 0);
  const out = radii.map((r) => Math.max(1, Math.floor((n * r) / sum)));
  let left = n - out.reduce((a, b) => a + b, 0);
  for (let j = out.length - 1; left > 0; j = (j + out.length - 1) % out.length) { out[j]++; left--; }
  while (left < 0) { const j = out.indexOf(Math.max(...out)); out[j]--; left++; }
  return out;
}

/** Places n items evenly on an arc around (cx, cy), pointing away from the screen edges. */
export function layoutRing(n: number, cx: number, cy: number, tileR: number, free: Rect, card: Rect | null): RingLayout {
  const fx = (free.left + free.right) / 2;
  const fy = (free.top + free.bottom) / 2;
  // Away from the edges: toward the middle of the free area (any direction if the tile is near the middle).
  const near = Math.hypot(fx - cx, fy - cy) < 8;
  const mid = near ? -Math.PI / 2 : Math.atan2(fy - cy, fx - cx);
  const r0 = Math.max(46, tileR) + 44;
  const rMax = r0 * 2.2;
  const TAU = Math.PI * 2;
  // Nudges of the arc's middle direction, smallest first, for when its ends would poke off screen.
  const MIN_SPAN = 0.5;
  const nudges = [0];
  for (let d = 8; d <= 96; d += 8) nudges.push((d * Math.PI) / 180, (-d * Math.PI) / 180);
  // One row if it fits, then two concentric rows, then three (a tile squeezed into a corner).
  const maxRows = n >= 6 ? 3 : n >= 3 ? 2 : 1;
  for (let rows = 1; rows <= maxRows; rows++) {
    for (let span = TAU; span >= MIN_SPAN - 1e-6; span -= (15 * Math.PI) / 180) {
      const s = Math.min(span, TAU);
      const full = s >= TAU - 1e-6;
      for (let r = r0; r <= rMax + 0.1; r += 6) {
        const radii = Array.from({ length: rows }, (_, j) => r + ROW_GAP * j);
        const counts = splitCounts(n, radii);
        for (const nd of full ? [0] : nudges) {
          const m = mid + nd;
          const pts: Pt[] = [];
          radii.forEach((rr, j) => pts.push(...rowPoints(counts[j], rr, m, s, full && j % 2 ? 0.5 : 0, cx, cy)));
          if (valid(pts, free, card)) return { pts, fits: true, rows: radii.map((rr) => ({ r: rr, a0: m - s / 2, a1: m + s / 2, full })) };
        }
      }
    }
  }
  // Best effort: the base arc, each item clamped into the free area.
  const pts = rowPoints(n, r0 + 20, mid, Math.PI, 0, cx, cy).map(([x, y]): Pt => [
    Math.min(free.right - CIR / 2, Math.max(free.left + CIR / 2, x)),
    Math.min(free.bottom - CIR / 2 - 17, Math.max(free.top + CIR / 2, y)),
  ]);
  return { pts, fits: false, rows: [{ r: r0 + 20, a0: mid - Math.PI / 2, a1: mid + Math.PI / 2, full: false }] };
}
