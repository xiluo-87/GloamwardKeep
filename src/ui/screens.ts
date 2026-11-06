import { CHARACTERS, CharacterId, SHOP, WEAPONS } from '../data/content';
import { buyUpgrade, characterUnlocked, newMoonUnlocked, SaveData } from '../save/save';
import type { Choice } from '../sim/state';

export const fmtTime = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export interface Summary { outcome: 'death' | 'dawn'; t: number; kills: number; level: number; wax: number }

export interface UiHandlers {
  start(character: CharacterId, newMoon: boolean): void;
  resume(): void;
  quit(): void;
  choose(i: number): void;
  reroll(): void;
  saveChanged(): void;
  click(): void;
}

/** All menus are DOM over the canvas. Nothing here touches the simulation directly. */
export class Screens {
  private root: HTMLElement;
  private newMoon = false;

  constructor(private save: SaveData, private h: UiHandlers) {
    this.root = document.getElementById('overlay') as HTMLElement;
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el && !el.hasAttribute('disabled')) { this.h.click(); this.act(el.dataset.act as string, el.dataset.arg ?? ''); }
    });
  }

  private set(html: string, cls = ''): void {
    this.root.className = cls;
    this.root.innerHTML = html;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private act(act: string, arg: string): void {
    switch (act) {
      case 'title': this.title(); break;
      case 'chars': this.characters(); break;
      case 'shop': this.shop(); break;
      case 'start': this.h.start(arg as CharacterId, this.newMoon); break;
      case 'moon': this.newMoon = !this.newMoon; this.characters(); break;
      case 'buy':
        if (buyUpgrade(this.save, arg as Parameters<typeof buyUpgrade>[1])) this.h.saveChanged();
        this.shop();
        break;
      case 'resume': this.h.resume(); break;
      case 'quit': this.h.quit(); break;
      case 'choose': this.h.choose(Number(arg)); break;
      case 'reroll': this.h.reroll(); break;
      case 'motion':
        this.save.reduceMotion = !this.save.reduceMotion;
        this.h.saveChanged();
        this.title();
        break;
      case 'mute':
        this.save.muted = !this.save.muted;
        this.h.saveChanged();
        this.title();
        break;
    }
  }

  title(): void {
    const s = this.save;
    this.set(`
      <div class="panel title">
        <h1>Gloamward</h1>
        <p class="tag">Keep the flame alive until dawn.</p>
        <button class="primary" data-act="chars">Light the lantern</button>
        <button data-act="shop">Chandlery <span class="wax">${s.wax} wax</span></button>
        <div class="row">
          <button class="small" data-act="motion">Screen shake: ${s.reduceMotion ? 'off' : 'on'}</button>
          <button class="small" data-act="mute">Sound: ${s.muted ? 'off' : 'on'}</button>
        </div>
        <p class="hint">Move with WASD or arrows. Hold Space to dim. On touch: left thumb moves, hold the right side to dim.</p>
        ${s.bestTime > 0 ? `<p class="hint">Longest night: ${fmtTime(s.bestTime)}</p>` : ''}
      </div>`, 'center');
  }

  characters(): void {
    const s = this.save;
    const cards = CHARACTERS.map((c) => {
      const open = characterUnlocked(s, c.id);
      return `<button class="card ${open ? '' : 'locked'}" ${open ? `data-act="start" data-arg="${c.id}"` : 'disabled'}>
        <strong>${esc(c.name)}</strong>
        <span>${open ? `Starts with ${esc(WEAPONS[c.weapon].name)}. ${esc(c.trait)}` : esc(c.unlock)}</span>
      </button>`;
    }).join('');
    const moon = newMoonUnlocked(s)
      ? `<button class="small" data-act="moon">New Moon: ${this.newMoon ? 'on' : 'off'} (light capped at 120, ×1.5 wax)</button>`
      : '';
    this.set(`<div class="panel"><h2>Who walks tonight?</h2><div class="cards">${cards}</div>${moon}<button class="small" data-act="title">Back</button></div>`, 'center');
  }

  shop(): void {
    const s = this.save;
    const rows = SHOP.map((i) => {
      const rank = s.shop[i.id] ?? 0;
      const maxed = rank >= i.ranks;
      const cost = i.cost(rank);
      const can = !maxed && s.wax >= cost;
      return `<button class="card" ${can ? `data-act="buy" data-arg="${i.id}"` : 'disabled'}>
        <strong>${esc(i.name)} <em>${rank}/${i.ranks}</em></strong>
        <span>${esc(i.desc)}. ${maxed ? 'Fully bought.' : `${cost} wax.`}</span>
      </button>`;
    }).join('');
    this.set(`<div class="panel"><h2>The Chandlery</h2><p class="wax big">${s.wax} wax</p><div class="cards">${rows}</div><button class="small" data-act="title">Back</button></div>`, 'center');
  }

  pause(): void {
    this.set(`<div class="panel"><h2>Paused</h2><button class="primary" data-act="resume">Resume</button><button class="small" data-act="quit">Give up the night</button></div>`, 'center');
  }

  levelUp(choices: Choice[], rerolls: number): void {
    const cards = choices.map((c, i) => `<button class="card choice" data-act="choose" data-arg="${i}">
        <i style="color:${c.colour};border-color:${c.colour}">${esc(c.glyph)}</i>
        <strong>${esc(c.name)}${c.rank > 0 && c.kind !== 'combo' ? ` <em>rank ${c.rank}</em>` : ''}</strong>
        <span>${esc(c.desc)}</span><kbd>${i + 1}</kbd>
      </button>`).join('');
    const reroll = rerolls > 0 ? `<button class="small" data-act="reroll">Reroll (${rerolls} left, R)</button>` : '';
    this.set(`<div class="panel wide"><h2>The flame takes</h2><div class="cards">${cards}</div>${reroll}</div>`, 'center dim');
  }

  summary(r: Summary): void {
    const dawn = r.outcome === 'dawn';
    this.set(`<div class="panel ${dawn ? 'dawn' : ''}">
      <h2>${dawn ? 'Morning.' : 'The flame went out.'}</h2>
      <p class="tag">${dawn ? 'The lantern goes out on its own.' : `You lasted until ${fmtTime(r.t)}.`}</p>
      <dl><dt>Night survived</dt><dd>${fmtTime(r.t)}</dd><dt>Enemies felled</dt><dd>${r.kills}</dd><dt>Level</dt><dd>${r.level}</dd><dt>Wax earned</dt><dd class="wax">+${r.wax}</dd></dl>
      <button class="primary" data-act="chars">Another night</button>
      <button data-act="shop">Chandlery <span class="wax">${this.save.wax} wax</span></button>
      <button class="small" data-act="title">Title</button>
    </div>`, 'center');
  }
}
