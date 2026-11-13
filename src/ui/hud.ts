// The in-run HUD: a slim top bar, the corner card for the selected tile, toasts and the thumb-zone
// bottom row (call wave, speed, hero abilities, fit map).
import { HEIGHT, HEROES, HeroId, KEEP, RUN } from '../data/balance';
import { ABILITY_TEXT, CLEAR_TEXT } from '../data/text';
import { canCallWave, clearCost, earlyBonus } from '../sim/actions';
import { keepCost } from '../sim/stats';
import { FEATURE } from '../sim/mapgen';
import { towerAt } from '../sim/state';
import type { RunState } from '../sim/state';
import { ACTION_ICONS, GOLD_ICON, HEART_ICON, WAVE_ICON, iconFor } from './icons';
import { keepUnlocks, roman } from './format';
import { towerName } from './panel';
import type { Session } from './session';

export interface HudHooks { togglePause(): void; cycleSpeed(): void; fitMap(): void; focusKeep(): void; togglePaths(): void; pathsOn(): boolean }

const HEIGHT_NAME = ['Road', 'Field', 'Rise', 'Hill', 'Peak'];

export class Hud {
  readonly top: HTMLElement;
  readonly bar: HTMLElement;
  private root: HTMLElement;
  private gold!: HTMLElement;
  private lives!: HTMLElement;
  private wave!: HTMLElement;
  private call!: HTMLButtonElement;
  private callMain!: HTMLElement;
  private callSub!: HTMLElement;
  private speed!: HTMLButtonElement;
  private keepBtn!: HTMLButtonElement;
  private pathsBtn!: HTMLButtonElement;
  private keepLabel!: HTMLElement;
  private toasts: HTMLElement;
  private card: HTMLElement;
  private cardSig = '';
  private cardHp: HTMLElement | null = null;
  private abilityHost: HTMLElement;
  private abilityKey = '';
  private abilityBtns: { uid: number; el: HTMLButtonElement; label: HTMLElement }[] = [];
  private cache = new Map<string, string | number | boolean>();
  private builtFor: RunState | null = null;

  constructor(root: HTMLElement, private session: Session, private hooks: HudHooks) {
    this.root = root;
    root.innerHTML = `
      <div id="topbar">
        <div class="stat" title="Gold"><i class="ico">${GOLD_ICON}</i><b data-k="gold">0</b></div>
        <div class="stat" title="Lives left"><i class="ico">${HEART_ICON}</i><b data-k="lives">0</b></div>
        <div class="stat" title="Wave"><i class="ico">${WAVE_ICON}</i><span>Wave <b data-k="wave">0</b>/${RUN.waves}</span></div>
        <button class="small keepbtn" data-k="keep" title="The keep: raise it to unlock more towers"><i class="ico">${ACTION_ICONS.keep}</i><b>Keep I</b></button>
        <span class="grow"></span>
        <button class="small" data-k="pause" title="Pause (Esc)" aria-label="Pause">II</button>
      </div>
      <div id="card" hidden></div>
      <div id="toast"></div>
      <div id="thumb">
        <button class="call primary" data-k="call"><b>Start</b><small></small></button>
        <button class="small spd" data-k="speed" title="Game speed" aria-label="Game speed">1×</button>
        <div class="abilities"></div>
        <button class="small pathbtn" data-k="paths" title="Show enemy paths (V)" aria-label="Show enemy paths" aria-pressed="true"><i class="ico">${ACTION_ICONS.paths}</i><s class="strike"></s></button>
        <button class="small fit" data-k="fit" title="Fit the whole map" aria-label="Fit map"><i class="ico">${ACTION_ICONS.fit}</i></button>
      </div>
      <div id="ring"></div>
      <div id="desc" hidden></div>`;
    this.top = root.querySelector('#topbar') as HTMLElement;
    this.bar = root.querySelector('#thumb') as HTMLElement;
    this.toasts = root.querySelector('#toast') as HTMLElement;
    this.card = root.querySelector('#card') as HTMLElement;
    this.abilityHost = root.querySelector('.abilities') as HTMLElement;
    const q = (k: string): HTMLElement => root.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.gold = q('gold'); this.lives = q('lives'); this.wave = q('wave');
    this.call = q('call') as HTMLButtonElement;
    this.callMain = this.call.querySelector('b') as HTMLElement;
    this.callSub = this.call.querySelector('small') as HTMLElement;
    this.speed = q('speed') as HTMLButtonElement;
    this.call.addEventListener('click', () => this.session.call());
    this.speed.addEventListener('click', () => this.hooks.cycleSpeed());
    q('pause').addEventListener('click', () => this.hooks.togglePause());
    this.keepBtn = q('keep') as HTMLButtonElement;
    this.keepLabel = this.keepBtn.querySelector('b') as HTMLElement;
    this.keepBtn.addEventListener('click', () => this.hooks.focusKeep());
    this.pathsBtn = q('paths') as HTMLButtonElement;
    this.pathsBtn.addEventListener('click', () => this.hooks.togglePaths());
    q('fit').addEventListener('click', () => this.hooks.fitMap());
    this.card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      if (b.dataset.act === 'actions') this.session.openRing();
      else if (b.dataset.act === 'clear') this.session.clearHere();
    });
  }

  get ringEl(): HTMLElement { return this.root.querySelector('#ring') as HTMLElement; }
  get descEl(): HTMLElement { return this.root.querySelector('#desc') as HTMLElement; }

  show(run: RunState): void {
    this.root.hidden = false;
    this.cache.clear();
    this.abilityKey = '';
    this.cardSig = '';
    this.toasts.innerHTML = '';
    this.builtFor = run;
  }

  hide(): void {
    this.root.hidden = true;
    this.builtFor = null;
  }

  toast(msg: string, bad = false): void {
    const last = this.toasts.lastElementChild as HTMLElement | null;
    if (last && last.textContent === msg) {
      window.clearTimeout(Number(last.dataset.t));
      last.dataset.t = String(window.setTimeout(() => last.remove(), 2600));
      return;
    }
    const el = document.createElement('div');
    el.textContent = msg;
    if (bad) el.className = 'bad';
    el.dataset.t = String(window.setTimeout(() => el.remove(), 2600));
    this.toasts.appendChild(el);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
  }

  private set(k: string, el: HTMLElement, text: string): void {
    if (this.cache.get(k) === text) return;
    this.cache.set(k, text);
    el.textContent = text;
  }

  private flag(k: string, el: HTMLElement, cls: string, on: boolean): void {
    if (this.cache.get(k) === on) return;
    this.cache.set(k, on);
    el.classList.toggle(cls, on);
  }

  update(s: RunState): void {
    if (this.builtFor !== s) this.show(s);
    this.set('gold', this.gold, String(Math.floor(s.gold)));
    this.set('lives', this.lives, String(s.lives));
    this.set('wave', this.wave, String(s.wave));
    this.flag('lowlives', this.lives, 'warn', s.lives <= 5);

    const spawning = s.spawnIdx < s.spawns.length;
    let timer: string;
    if (s.outcome) timer = s.outcome === 'won' ? 'Victory' : 'The keep has fallen';
    else if (s.waiting) timer = 'Prepare your defences';
    else if (s.wave >= RUN.waves) timer = spawning ? 'Final wave arriving' : 'Final wave — hold the keep';
    else if (spawning) timer = `Wave ${s.wave} arriving`;
    else timer = `Next wave in ${Math.max(0, Math.ceil(s.nextIn))}s`;
    let label = 'Start';
    if (!s.waiting) {
      const b = earlyBonus(s);
      label = b > 0 ? `Call wave (+${b} gold)` : 'Call wave';
    }
    this.set('callMain', this.callMain, label);
    this.set('callSub', this.callSub, timer);
    const can = canCallWave(s);
    if (this.cache.get('callOff') !== !can) { this.cache.set('callOff', !can); this.call.disabled = !can; }
    this.call.hidden = s.wave >= RUN.waves && !can;
    this.set('keep', this.keepLabel, `Keep ${roman(s.keep)}`);
    this.flag('keepReady', this.keepBtn, 'ready', keepCost(s) > 0 && s.gold >= keepCost(s));
    const on = this.hooks.pathsOn();
    if (this.cache.get('paths') !== on) { this.cache.set('paths', on); this.pathsBtn.classList.toggle('off', !on); this.pathsBtn.setAttribute('aria-pressed', String(on)); }
    this.set('speed', this.speed, `${this.session.speed}×`);
    this.updateAbilities(s);
    this.updateCard(s);
  }

  private updateCard(s: RunState): void {
    const ss = this.session;
    const tile = ss.tile;
    if (!tile || ss.previewing || ss.sheet) {
      if (this.cardSig !== 'off') { this.cardSig = 'off'; this.card.hidden = true; }
      return;
    }
    const i = tile.row * s.terrain.cols + tile.col;
    const h = s.terrain.height[i];
    const f = s.terrain.feature[i];
    const t = towerAt(s, tile.col, tile.row);
    const cost = f !== FEATURE.none ? clearCost(s, tile.col, tile.row) : 0;
    const isKeep = s.terrain.goal[0] === tile.col && s.terrain.goal[1] === tile.row;
    const sig = `${s.keep}|${tile.col},${tile.row}|${t ? `${t.uid}.${t.tier}.${t.fork}.${t.forkTier}.${t.heroLevel}` : 'e'}|${f}|${cost}|${s.gold >= cost ? 1 : 0}|${ss.ring ? 1 : 0}`;
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      const bonus = Math.round((HEIGHT.rangePerLevel + s.mods.heightRangeBonus) * h * 100);
      const ter = f === FEATURE.forest ? CLEAR_TEXT.forest.name : f === FEATURE.rocks ? CLEAR_TEXT.rocks.name : HEIGHT_NAME[h] ?? 'Ground';
      let l1 = `${ter} · height ${h}${bonus && f === FEATURE.none ? ` · +${bonus}% range` : ''}`;
      let kl = '';
      if (isKeep) {
        l1 = `Keep · level ${roman(s.keep)}${s.keep >= KEEP.max ? ' (highest)' : ''}`;
        if (s.keep < KEEP.max) kl = `<div class="l2 sub">Next: ${keepUnlocks(s.keep + 1).join(' · ')}</div>`;
      }
      let l2 = '';
      if (t) {
        const stage = t.hero ? `level ${t.heroLevel}` : t.fork ? `fork tier ${t.forkTier}` : `tier ${t.tier}`;
        l2 = `<div class="l2"><strong>${towerName(t)}</strong> <span class="sub">${stage}</span><div class="hpbar"><i></i></div></div>`;
      }
      const clear = cost > 0 ? `<button class="small primary" data-act="clear" ${s.gold >= cost ? '' : 'disabled'}>${f === FEATURE.forest ? CLEAR_TEXT.forest.action : CLEAR_TEXT.rocks.action} — ${cost} gold</button>` : '';
      const actions = ss.ring ? '' : `<button class="small" data-act="actions">Actions</button>`;
      this.card.innerHTML = `<div class="l1">${l1}</div>${kl}${l2}<div class="btns">${clear}${actions}</div>`;
      this.card.hidden = false;
      this.cardHp = this.card.querySelector('.hpbar i');
    }
    if (t && this.cardHp) {
      const w = `${Math.round(Math.max(0, Math.min(1, t.hp / t.maxHp)) * 100)}%`;
      if (this.cardHp.style.width !== w) this.cardHp.style.width = w;
    }
  }

  private updateAbilities(s: RunState): void {
    const placed = s.towers.filter((t) => t.hero);
    const key = placed.map((t) => t.uid).join(',');
    if (key !== this.abilityKey) {
      this.abilityKey = key;
      this.abilityHost.innerHTML = '';
      this.abilityBtns = [];
      for (const t of placed) {
        const kind = HEROES[t.type as HeroId].ability;
        const el = document.createElement('button');
        el.className = 'bb ability';
        el.innerHTML = `<span class="ic">${iconFor(t.type as HeroId)}</span><span class="nm">${ABILITY_TEXT[kind]}</span><span class="co" data-cd>Ready</span><i class="sweep"></i>`;
        el.addEventListener('click', () => { this.session.ability(t.uid); });
        this.abilityHost.appendChild(el);
        this.abilityBtns.push({ uid: t.uid, el, label: el.querySelector('[data-cd]') as HTMLElement });
      }
    }
    for (const b of this.abilityBtns) {
      const t = s.towers.find((x) => x.uid === b.uid);
      if (!t) continue;
      const cd = Math.max(0, t.abilityCd);
      const total = Math.max(1, t.stats.abilityCd);
      const frac = Math.round((cd / total) * 100);
      if (this.cache.get(`cdf-${b.uid}`) !== frac) { this.cache.set(`cdf-${b.uid}`, frac); b.el.style.setProperty('--cd', `${frac}%`); }
      this.set(`cdt-${b.uid}`, b.label, cd > 0 ? `${Math.ceil(cd)}s` : 'Ready');
      this.flag(`cdr-${b.uid}`, b.el, 'ready', cd <= 0);
    }
  }
}
