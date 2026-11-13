// The selection panel: a side panel on wide screens, a bottom sheet on phones (CSS decides).
// It rebuilds its DOM only when something discrete changes (signature) and patches numbers in place otherwise.
import { HERO, HEROES, HEIGHT, HeroId, KEEP, TOWER_IDS, TowerId } from '../data/balance';
import { ABILITY_TEXT, CLEAR_TEXT, describeMod, HERO_TEXT, TOWER_TEXT } from '../data/text';
import { canClear, clearCost } from '../sim/actions';
import { isUndo } from './session';
import { FEATURE } from '../sim/mapgen';
import { attackRate } from '../sim/step';
import {
  heroProgress, sellValue, skillCost, skillState, SkillState, upgradeOptions,
} from '../sim/stats';
import type { RunState, Tower } from '../sim/state';
import { esc, flagList, roman, statRows } from './format';
import { iconFor } from './icons';
import type { Session } from './session';

const TARGET_TEXT: Record<string, string> = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };

const SKILL_LABEL: Record<SkillState, string> = {
  learned: 'Learned', available: 'Learn', needsLevel: 'Needs level', needsKeep: 'Needs keep', needsPrevious: 'Needs previous',
  capstoneTaken: 'Capstone taken', tooExpensive: 'Too expensive',
};

const WIDE = window.matchMedia('(min-width: 820px)');
const IDLE_HTML = `<h3>The Keep</h3>
  <p class="sub">Click a tile to select it, click it again for the action ring (build, upgrade, sell). Hotkeys act on the selected tile.</p>
  <h4>Controls</h4>
  <dl class="stats keys"><dt>1–${TOWER_IDS.length}</dt><dd>Build tower here</dd><dt>Q / W</dt><dd>Place hero here</dd><dt>Space</dt><dd>Call next wave</dd>
  <dt>U / I</dt><dd>Upgrade (fork A / B)</dd><dt>S</dt><dd>Sell</dd><dt>T</dt><dd>Target mode</dd><dt>A</dt><dd>Hero ability</dd>
  <dt>K</dt><dd>Raise the keep</dd><dt>C</dt><dd>Clear forest / rocks</dd><dt>F</dt><dd>Fit whole map</dd><dt>Esc</dt><dd>Cancel / pause</dd></dl>
  <p class="sub">Build walls on the road to steer enemies onto longer routes. Higher ground gives more range.</p>`;

export function towerName(t: Tower): string {
  if (t.hero) return HERO_TEXT[t.type as HeroId].name;
  const tx = TOWER_TEXT[t.type as TowerId];
  return t.fork ? tx.forks[t.fork].tiers[Math.max(0, t.forkTier - 1)] : tx.tiers[t.tier - 1];
}

export class Panel {
  private sig = '';
  private fields: HTMLElement[] = [];
  private bars: HTMLElement[] = [];
  private cds: HTMLElement[] = [];
  private poorEls: { el: HTMLElement; cost: number }[] = [];
  private flatS: RunState | null = null;

  constructor(readonly el: HTMLElement, private session: Session, private onLayout: () => void) {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      this.act(b.dataset.act as string, b);
    });
  }

  private act(act: string, b: HTMLElement): void {
    const ss = this.session;
    const t = ss.selected;
    switch (act) {
      case 'close': if (!ss.closeOverlays()) ss.cancel(); break;
      case 'up': ss.upgradeSelected((b.dataset.arg as 'a' | 'b' | '') || undefined); break;
      case 'sell': ss.sellSelected(performance.now()); break;
      case 'target': ss.target(); break;
      case 'ability': if (t) ss.ability(t.uid); break;
      case 'learn': if (t) ss.learn(t.uid, Number(b.dataset.b), Number(b.dataset.n)); break;
      case 'clear': ss.clearHere(); break;
    }
  }

  get visible(): boolean { return !this.el.hidden; }

  update(s: RunState, now: number): void {
    const ss = this.session;
    if (this.flatS !== s) { this.flatS = s; this.sig = ''; }
    const t = ss.selected;
    const tile = ss.tile;
    const wide = WIDE.matches;
    let sig = '';
    if (t && (wide || (ss.sheet === 'skills' && t.hero))) sig = this.towerSig(s, t, now);
    else if (tile && wide && !t) {
      const cost = clearCost(s, tile.col, tile.row);
      if (cost > 0) sig = `F|${tile.col},${tile.row}|${cost}|${canClear(s, tile.col, tile.row)}`;
    }
    this.el.classList.toggle('sheet', !wide);
    // On wide screens the panel stays put (so the board never shifts under the pointer) and shows help when idle.
    if (!sig && wide) sig = 'idle';
    if (sig !== this.sig) {
      const wasVisible = this.visible;
      this.sig = sig;
      if (!sig) { this.el.hidden = true; this.el.innerHTML = ''; }
      else if (sig === 'idle') {
        this.el.innerHTML = IDLE_HTML;
        this.el.hidden = false;
        this.fields = []; this.bars = []; this.cds = []; this.poorEls = [];
      } else {
        this.el.innerHTML = t ? (t.hero ? this.heroHtml(s, t) : this.towerHtml(s, t, now)) : this.tileHtml(s);
        this.el.hidden = false;
        this.fields = [...this.el.querySelectorAll<HTMLElement>('[data-f]')];
        this.bars = [...this.el.querySelectorAll<HTMLElement>('[data-bar]')];
        this.cds = [...this.el.querySelectorAll<HTMLElement>('[data-cd]')];
        this.poorEls = [...this.el.querySelectorAll<HTMLElement>('[data-cost]')].map((el) => ({ el, cost: Number(el.dataset.cost) }));
      }
      if (wasVisible !== this.visible || sig) this.onLayout();
    }
    if (t && sig && sig !== 'idle') this.patch(s, t);
    for (const p of this.poorEls) p.el.classList.toggle('poor', s.gold < p.cost);
  }

  // -- signatures -------------------------------------------------------------------------------

  private towerSig(s: RunState, t: Tower, now: number): string {
    const labels = statRows(t.stats).map((r) => r[0]).join(',');
    let sig = `${t.hero ? 'H' : 'T'}|${isUndo(t) ? 1 : 0}|${t.uid}|${t.tier}|${t.fork}|${t.forkTier}|${t.heroLevel}|${t.skills.join('.')}|${t.target}|${labels}|${this.session.sellArmed(now) ? 1 : 0}|${t.maxHp}`;
    if (t.hero) {
      for (let b = 0; b < 3; b++) for (let n = 0; n < 4; n++) sig += skillState(s, t, b, n) + ',';
    } else {
      sig += '|' + s.keep + upgradeOptions(t, s.mods).map((o) => (s.gold >= o.cost ? 1 : 0)).join('');
    }
    return sig;
  }

  // -- html -------------------------------------------------------------------------------------

  private tileHtml(s: RunState): string {
    const tile = this.session.tile as { col: number; row: number };
    const i = tile.row * s.terrain.cols + tile.col;
    const f = s.terrain.feature[i] === FEATURE.forest ? CLEAR_TEXT.forest : CLEAR_TEXT.rocks;
    const cost = clearCost(s, tile.col, tile.row);
    const ok = canClear(s, tile.col, tile.row) === 'ok';
    return `<header><div><h3>${f.name}</h3><p class="sub">Height ${s.terrain.height[i]}</p></div><button class="small x" data-act="close" aria-label="Close">×</button></header>
      <p>${CLEAR_TEXT.hint}</p>
      <button class="primary wide" data-act="clear" data-cost="${cost}" ${ok ? '' : 'disabled'}>${f.action} — ${cost} gold <kbd>C</kbd></button>`;
  }

  private statsHtml(t: Tower): string {
    const rows = statRows(t.stats).map(([l, v]) => `<dt>${esc(l)}</dt><dd data-f="s:${esc(l)}">${esc(v)}</dd>`).join('');
    const flags = flagList(t.stats).map((f) => `<span class="chip">${f}</span>`).join('');
    return `<dl class="stats">${rows}</dl><div class="tags">${flags}</div>`;
  }

  private headerHtml(t: Tower, sub: string): string {
    return `<header><i class="ic">${iconFor(t.type)}</i><div><h3>${esc(towerName(t))}</h3><p class="sub">${sub}</p></div><button class="small x" data-act="close" aria-label="Close">×</button></header>`;
  }

  private towerHtml(s: RunState, t: Tower, now: number): string {
    const bonus = Math.round((HEIGHT.rangePerLevel + s.mods.heightRangeBonus) * t.height * 100);
    const tx = TOWER_TEXT[t.type as TowerId];
    const stage = t.fork ? `${tx.forks[t.fork].name} · tier ${t.forkTier} of 2` : `Tier ${t.tier} of 3`;
    const opts = upgradeOptions(t, s.mods);
    let up = '';
    if (opts.length === 2) {
      up = `<div class="fork">${opts.map((o) => {
        const ft = tx.forks[o.path as 'a' | 'b'];
        return `<button class="forkopt" data-act="up" data-arg="${o.path}" data-cost="${o.cost}"><strong>${esc(ft.name)}</strong><em>${esc(ft.blurb)}</em><span>${esc(describeMod(o.upgrade.add))}</span><b class="price${o.keep > s.keep ? ' poor' : ''}">${o.keep > s.keep ? `Needs Keep ${roman(o.keep)}` : `${o.cost} gold`}</b><kbd>${o.path === 'a' ? 'U' : 'I'}</kbd></button>`;
      }).join('')}</div><p class="sub">Choose a path — it can't be changed later.</p>`;
    } else if (opts.length === 1) {
      const o = opts[0];
      const next = o.path === 'tier' ? tx.tiers[o.level - 1] : tx.forks[o.path].tiers[o.level - 1];
      up = `<button class="upgrade wide" data-act="up" data-cost="${o.cost}"><strong>Upgrade: ${esc(next)}</strong><span>${esc(describeMod(o.upgrade.add))}</span><b class="price${o.keep > s.keep ? ' poor' : ''}">${o.keep > s.keep ? `Needs Keep ${roman(o.keep)}` : `${o.cost} gold`}</b><kbd>U</kbd></button>`;
    } else up = '<p class="sub">Fully upgraded.</p>';
    const armed = this.session.sellArmed(now);
    const value = sellValue(t, s.mods);
    const undo = isUndo(t);
    return `${this.headerHtml(t, stage)}
      <p class="terrain">Height ${t.height}${bonus ? ` — +${bonus}% range` : ''}</p>
      ${this.statsHtml(t)}
      <div class="hpbar"><i data-bar="hp"></i><span data-f="hp"></span></div>
      <p class="sub" data-f="record"></p>
      <button class="wide" data-act="target">Target: <b>${TARGET_TEXT[t.target]}</b> <kbd>T</kbd></button>
      <h4>Upgrade</h4>${up}
      <button class="wide sell ${armed ? 'armed' : ''}" data-act="sell">${undo ? `Undo — full refund (+${value})` : armed ? `Confirm sell (+${value})` : `Sell for ${value} gold`} <kbd>S</kbd></button>`;
  }

  private heroHtml(s: RunState, t: Tower): string {
    const h = HEROES[t.type as HeroId];
    const tx = HERO_TEXT[t.type as HeroId];
    const bonus = Math.round((HEIGHT.rangePerLevel + s.mods.heightRangeBonus) * t.height * 100);
    const cols = tx.branches.map((br, b) => {
      const nodes = [0, 1, 2, 3].map((n) => {
        const st = skillState(s, t, b, n);
        const label = st === 'needsLevel' ? `Needs level ${HERO.nodeLevel[n]}` : st === 'needsKeep' ? `Needs Keep ${roman(KEEP.skillNode[n])}` : SKILL_LABEL[st];
        const cost = skillCost(n, s.mods);
        return `<button class="node ${st}${n === 3 ? ' cap' : ''}" data-act="learn" data-b="${b}" data-n="${n}" ${st === 'available' ? '' : 'disabled'} title="${esc(label)}">
          <strong>${esc(br.nodes[n])}</strong><span>${esc(describeMod(h.branches[b][n].add))}</span>
          <em>${st === 'learned' ? '✓ Learned' : st === 'available' || st === 'tooExpensive' ? `${cost} gold${st === 'tooExpensive' ? ' — too expensive' : ''}` : esc(label)}</em></button>`;
      }).join('');
      return `<div class="branch"><h5>${esc(br.name)}</h5>${nodes}</div>`;
    }).join('');
    return `${this.headerHtml(t, esc(tx.title))}
      <div class="lvl"><b>Level <span data-f="lvl"></span></b><div class="xp"><i data-bar="xp"></i></div></div>
      <p class="terrain">Height ${t.height}${bonus ? ` — +${bonus}% range` : ''}</p>
      ${this.statsHtml(t)}
      <div class="hpbar"><i data-bar="hp"></i><span data-f="hp"></span></div>
      <p class="sub" data-f="record"></p>
      <button class="wide ability" data-act="ability"><strong>${esc(ABILITY_TEXT[h.ability])}</strong><span>${esc(tx.abilityDesc)}</span><b data-cd>Ready</b><kbd>A</kbd></button>
      <button class="wide" data-act="target">Target: <b>${TARGET_TEXT[t.target]}</b> <kbd>T</kbd></button>
      <h4>Skills <span class="sub">one capstone only · level ${HERO.nodeLevel.join(' / ')}</span></h4>
      <div class="tree">${cols}</div>
      <button class="wide sell ${this.session.sellArmed(performance.now()) ? 'armed' : ''}" data-act="sell">${isUndo(t) ? 'Undo — full refund' : this.session.sellArmed(performance.now()) ? 'Confirm dismiss' : 'Dismiss'} (+${sellValue(t, s.mods)}) <kbd>S</kbd></button>`;
  }

  // -- live numbers -----------------------------------------------------------------------------

  private patch(_s: RunState, t: Tower): void {
    const over: Partial<Record<'damage' | 'rate', number>> = { damage: t.stats.damage * (1 + t.buffDamage), rate: attackRate(t) };
    const rows = new Map(statRows(t.stats, over));
    const set = (f: HTMLElement, v: string): void => { if (f.textContent !== v) f.textContent = v; };
    for (const f of this.fields) {
      const k = f.dataset.f as string;
      if (k.startsWith('s:')) set(f, rows.get(k.slice(2)) ?? '');
      else if (k === 'hp') set(f, `HP ${Math.ceil(t.hp)} / ${t.maxHp}`);
      else if (k === 'record') set(f, `${t.kills} kills · ${Math.round(t.dealt)} damage dealt${t.jinxT > 0 ? ' · jinxed' : ''}${t.silenceT > 0 ? ' · silenced' : ''}`);
      else if (k === 'lvl') {
        set(f, t.heroLevel >= HERO.maxLevel ? `${t.heroLevel} (max)` : `${t.heroLevel}`);
      }
    }
    for (const b of this.bars) {
      const k = b.dataset.bar;
      const w = k === 'hp' ? t.hp / t.maxHp : heroProgress(t);
      const txt = `${Math.round(Math.max(0, Math.min(1, w)) * 100)}%`;
      if (b.style.width !== txt) b.style.width = txt;
    }
    for (const c of this.cds) {
      const cd = Math.max(0, t.abilityCd);
      set(c, cd > 0 ? `${Math.ceil(cd)}s` : 'Ready');
      (c.parentElement as HTMLButtonElement).disabled = cd > 0;
    }
  }
}
