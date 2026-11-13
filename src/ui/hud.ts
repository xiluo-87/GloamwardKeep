// The in-run HUD: top bar, build bar, hero ability buttons, placing hint, toasts and tooltips.
import { HEROES, HeroId, RUN, TOWERS, TOWER_IDS, TowerId } from '../data/balance';
import { ABILITY_TEXT, HERO_TEXT, TOWER_TEXT } from '../data/text';
import { canCallWave, earlyBonus } from '../sim/actions';
import { buildCost } from '../sim/stats';
import type { RunState } from '../sim/state';
import { flagList, statLine } from './format';
import { GOLD_ICON, HEART_ICON, WAVE_ICON, iconFor } from './icons';
import type { Session } from './session';

export interface HudHooks { togglePause(): void; cycleSpeed(): void }

const HERO_KEYS = ['Q', 'W'];

export class Hud {
  readonly top: HTMLElement;
  readonly bar: HTMLElement;
  private root: HTMLElement;
  private gold!: HTMLElement;
  private lives!: HTMLElement;
  private wave!: HTMLElement;
  private timer!: HTMLElement;
  private call!: HTMLButtonElement;
  private speed!: HTMLButtonElement;
  private hint: HTMLElement;
  private toasts: HTMLElement;
  private tip: HTMLElement;
  private towerBtns: { id: TowerId; el: HTMLButtonElement; cost: number }[] = [];
  private heroBtns: { id: HeroId; el: HTMLButtonElement; cost: number }[] = [];
  private abilityHost: HTMLElement;
  private abilityKey = '';
  private abilityBtns: { uid: number; el: HTMLButtonElement; label: HTMLElement }[] = [];
  private cache = new Map<string, string | number | boolean>();
  private suppressClick = false;
  private pressTimer = 0;
  private builtFor: RunState | null = null;

  constructor(root: HTMLElement, private session: Session, private hooks: HudHooks) {
    this.root = root;
    root.innerHTML = `
      <div id="topbar">
        <div class="stat" title="Gold"><i class="ico">${GOLD_ICON}</i><b data-k="gold">0</b></div>
        <div class="stat" title="Lives left"><i class="ico">${HEART_ICON}</i><b data-k="lives">0</b></div>
        <div class="stat" title="Wave"><i class="ico">${WAVE_ICON}</i><span>Wave <b data-k="wave">0</b>/${RUN.waves}</span></div>
        <div class="timer" data-k="timer"></div>
        <button class="call primary" data-k="call">Start</button>
        <button class="small" data-k="speed" title="Game speed ([ ] in debug)">1×</button>
        <button class="small" data-k="pause" title="Pause (Esc)" aria-label="Pause">II</button>
      </div>
      <div id="bottom">
        <div id="toast"></div>
        <div id="placing" hidden></div>
        <div id="buildbar"><div class="group towers"></div><div class="group heroes"></div><div class="group abilities"></div></div>
      </div>
      <div id="tip" hidden></div>`;
    this.top = root.querySelector('#topbar') as HTMLElement;
    this.bar = root.querySelector('#buildbar') as HTMLElement;
    this.hint = root.querySelector('#placing') as HTMLElement;
    this.toasts = root.querySelector('#toast') as HTMLElement;
    this.tip = root.querySelector('#tip') as HTMLElement;
    this.abilityHost = root.querySelector('.abilities') as HTMLElement;
    const q = (k: string): HTMLElement => root.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.gold = q('gold'); this.lives = q('lives'); this.wave = q('wave'); this.timer = q('timer');
    this.call = q('call') as HTMLButtonElement;
    this.speed = q('speed') as HTMLButtonElement;
    this.call.addEventListener('click', () => this.session.call());
    this.speed.addEventListener('click', () => this.hooks.cycleSpeed());
    q('pause').addEventListener('click', () => this.hooks.togglePause());
    this.hint.addEventListener('click', () => this.session.cancel());
  }

  show(run: RunState): void {
    this.root.hidden = false;
    this.cache.clear();
    this.abilityKey = '';
    this.toasts.innerHTML = '';
    this.buildBar(run);
    this.builtFor = run;
  }

  hide(): void {
    this.root.hidden = true;
    this.tip.hidden = true;
    this.builtFor = null;
  }

  toast(msg: string, bad = false): void {
    const last = this.toasts.lastElementChild as HTMLElement | null;
    if (last && last.textContent === msg) {
      last.classList.remove('out');
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

  private buildBar(run: RunState): void {
    const mods = run.mods;
    const towers = this.bar.querySelector('.towers') as HTMLElement;
    const heroes = this.bar.querySelector('.heroes') as HTMLElement;
    towers.innerHTML = '';
    heroes.innerHTML = '';
    this.towerBtns = [];
    this.heroBtns = [];
    TOWER_IDS.forEach((id, n) => {
      const cost = buildCost(id, mods);
      const el = this.button(id, TOWER_TEXT[id].name, cost, String(n + 1), 'tower');
      towers.appendChild(el);
      this.towerBtns.push({ id, el, cost });
    });
    run.cfg.heroes.forEach((id, n) => {
      const cost = buildCost(id, mods);
      const el = this.button(id, HERO_TEXT[id].name.replace('The ', ''), cost, HERO_KEYS[n] ?? '', 'hero');
      heroes.appendChild(el);
      this.heroBtns.push({ id, el, cost });
    });
  }

  private button(id: TowerId | HeroId, name: string, cost: number, key: string, kind: 'tower' | 'hero'): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = `bb ${kind}`;
    el.dataset.id = id;
    el.innerHTML = `<span class="ic">${iconFor(id)}</span><span class="nm">${name}</span><span class="co">${cost}</span><kbd>${key}</kbd>`;
    el.addEventListener('click', () => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.session.setPlacing(id);
    });
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTip(id, el); });
    el.addEventListener('pointerleave', () => { this.tip.hidden = true; window.clearTimeout(this.pressTimer); });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => { this.suppressClick = true; this.showTip(id, el); }, 420);
    });
    const stop = (): void => {
      window.clearTimeout(this.pressTimer);
      // After a long press the tip stays until the next touch elsewhere.
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  private showTip(id: TowerId | HeroId, el: HTMLElement): void {
    const isHero = id in HEROES;
    let html: string;
    if (isHero) {
      const d = HEROES[id as HeroId];
      const t = HERO_TEXT[id as HeroId];
      html = `<h4>${t.name}</h4><p class="sub">${t.title}</p><p>${t.blurb}</p>
        <p class="stats">${statLine(d.base)}</p><p>${[...flagList(d.base)].join(' · ')}</p>
        <p><b>${t.ability}:</b> ${t.abilityDesc}</p><p class="sub">Unique: one on the board at a time. Levels up from kills, learns skills for gold.</p>`;
    } else {
      const d = TOWERS[id as TowerId];
      const t = TOWER_TEXT[id as TowerId];
      html = `<h4>${t.name}</h4><p>${t.blurb}</p><p class="stats">${statLine(d.base)}</p><p>${flagList(d.base).join(' · ')}</p>
        ${id === 'palisade' ? '<p><b>Mazing:</b> walls built on the road steer enemies onto longer routes. They only smash walls when every route is sealed.</p>' : ''}
        <p class="sub">Upgrades twice, then forks into ${t.forks.a.name} or ${t.forks.b.name}. Higher ground gives more range.</p>`;
    }
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    this.tip.style.width = `${w}px`;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    this.tip.style.left = `${left}px`;
    this.tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }

  hideTip(): void { this.tip.hidden = true; }

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
    let timer = '';
    if (s.outcome) timer = s.outcome === 'won' ? 'Victory' : 'The keep has fallen';
    else if (s.waiting) timer = 'Prepare your defences';
    else if (s.wave >= RUN.waves) timer = spawning ? 'Final wave arriving' : 'Final wave — hold the keep';
    else if (spawning) timer = `Wave ${s.wave} arriving`;
    else timer = `Next wave in ${Math.max(0, Math.ceil(s.nextIn))}s`;
    this.set('timer', this.timer, timer);

    const can = canCallWave(s);
    let label = 'Start';
    if (!s.waiting) {
      const b = earlyBonus(s);
      label = b > 0 ? `Call wave (+${b} gold)` : 'Call wave';
    }
    this.set('call', this.call, label);
    if (this.cache.get('callOff') !== !can) { this.cache.set('callOff', !can); this.call.disabled = !can; }
    this.call.hidden = s.wave >= RUN.waves || !!s.outcome;
    this.set('speed', this.speed, `${this.session.speed}×`);

    const placing = this.session.view.placing;
    for (const b of this.towerBtns) this.refreshBtn(s, b, placing);
    for (const b of this.heroBtns) {
      const placed = s.heroesPlaced.includes(b.id);
      if (this.cache.get(`h-${b.id}`) !== placed) { this.cache.set(`h-${b.id}`, placed); b.el.hidden = placed; }
      if (!placed) this.refreshBtn(s, b, placing);
    }
    this.updateAbilities(s);

    const view = this.session.view;
    const hintKey = view.placing ?? '';
    if (this.cache.get('hint') !== hintKey) {
      this.cache.set('hint', hintKey);
      if (view.placing) {
        const id = view.placing;
        const name = id in HEROES ? HERO_TEXT[id as HeroId].name : TOWER_TEXT[id as TowerId].name;
        this.hint.innerHTML = `Placing <b>${name}</b> — click a tile to build · right-click / Esc to cancel <button class="small">Cancel</button>`;
        this.hint.hidden = false;
      } else this.hint.hidden = true;
    }
  }

  private refreshBtn(s: RunState, b: { id: TowerId | HeroId; el: HTMLButtonElement; cost: number }, placing: string | null): void {
    this.flag(`poor-${b.id}`, b.el, 'poor', s.gold < b.cost);
    this.flag(`on-${b.id}`, b.el, 'on', placing === b.id);
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
        el.innerHTML = `<span class="ic">${iconFor(t.type as HeroId)}</span><span class="nm">${ABILITY_TEXT[kind]}</span><span class="co" data-cd>Ready</span><kbd>A</kbd><i class="sweep"></i>`;
        el.addEventListener('click', () => { this.session.select(t.uid); this.session.ability(t.uid); });
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
      this.flag(`cds-${b.uid}`, b.el, 'on', this.session.view.selectedUid === b.uid);
    }
  }
}
