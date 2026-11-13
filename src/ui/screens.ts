// Menus: title, map and loadout, profile, pause and end screens. All DOM over the canvas.
// Nothing here touches the simulation.
import { ENEMIES, ENEMY_IDS, HERO_IDS, HEROES, MAP_BALANCE, MapId, PERK_IDS, PERKS, PROFILE, RUN } from '../data/balance';
import { ENEMY_TEXT, GAME_NAME, GAME_TAG, HERO_TEXT, MAP_TEXT, PERK_TEXT } from '../data/text';
import {
  heroSlots, heroUnlocked, levelOf, levelProgress, mapUnlocked, perkSlots, perkUnlocked, Profile, unlocksAt,
} from '../meta/profile';
import type { Renderer } from '../render/renderer';
import { boardHeight, boardWidth } from '../sim/hex';
import { generateMap, Terrain } from '../sim/mapgen';
import { WORLD } from '../data/balance';
import { esc } from './format';
import { iconFor } from './icons';

export interface EndInfo {
  won: boolean; gaveUp: boolean; cleared: number; kills: number; xp: number; before: number; after: number; map: MapId;
}

export interface ScreenHandlers {
  start(map: MapId, mapSeed: number): void;
  resume(): void;
  restart(): void;
  giveUp(): void;
  /** Called after any change to the profile (loadout, settings). */
  saved(): void;
  click(): void;
  onTitle(): void;
}

const newSeed = (): number => Math.floor(Math.random() * 90000) + 10000;
const MAPS = Object.keys(MAP_BALANCE) as MapId[];

export class Screens {
  private root: HTMLElement;
  mapSeed = newSeed();
  private terrainCache = new Map<string, Terrain>();
  private endInfo: EndInfo | null = null;
  private armedAt = 0;

  constructor(private profile: Profile, private renderer: Renderer, private h: ScreenHandlers) {
    this.root = document.getElementById('overlay') as HTMLElement;
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el && !el.hasAttribute('disabled')) this.act(el.dataset.act as string, el.dataset.arg ?? '');
    });
    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.act === 'seed') {
        const v = Math.floor(Number(el.value));
        if (Number.isFinite(v) && v >= 0) { this.mapSeed = v; this.play(); }
      }
    });
  }

  get visible(): boolean { return !this.root.hidden; }

  hide(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private set(html: string, cls = ''): void {
    const keep = this.root.scrollTop;
    this.root.className = cls;
    this.root.innerHTML = html;
    this.root.hidden = false;
    this.root.scrollTop = keep;
  }

  terrain(map: MapId, seed: number): Terrain {
    const key = `${map}:${seed}`;
    let t = this.terrainCache.get(key);
    if (!t) {
      t = generateMap(map, seed);
      if (this.terrainCache.size > 12) this.terrainCache.clear();
      this.terrainCache.set(key, t);
    }
    return t;
  }

  private act(act: string, arg: string): void {
    this.h.click();
    const p = this.profile;
    const level = levelOf(p.xp);
    switch (act) {
      case 'title': this.h.onTitle(); this.title(); break;
      case 'play': this.mapSeed = this.mapSeed || newSeed(); this.play(); break;
      case 'profile': this.profileScreen(); break;
      case 'sound': p.muted = !p.muted; this.h.saved(); this.title(); break;
      case 'shake': p.reduceMotion = !p.reduceMotion; this.h.saved(); this.title(); break;
      case 'map': if (mapUnlocked(level, arg as MapId)) { p.map = arg as MapId; this.h.saved(); this.play(); } break;
      case 'reroll': this.mapSeed = newSeed(); this.play(); break;
      case 'hero': this.toggleHero(arg, level); break;
      case 'perk': this.togglePerk(arg, level); break;
      case 'go': this.h.start(p.map, this.mapSeed); break;
      case 'resume': this.h.resume(); break;
      case 'restart': this.h.restart(); break;
      case 'giveup':
        if (Date.now() - this.armedAt < 3000) this.h.giveUp();
        else { this.armedAt = Date.now(); this.pause(true); }
        break;
      case 'again': this.h.start(this.endInfo?.map ?? p.map, this.mapSeed); break;
      case 'newmap': this.mapSeed = newSeed(); this.play(); break;
    }
  }

  private toggleHero(id: string, level: number): void {
    const p = this.profile;
    const slots = heroSlots(level);
    const hid = id as (typeof p.heroes)[number];
    if (!heroUnlocked(level, hid)) return;
    if (p.heroes.includes(hid)) {
      if (p.heroes.length > 1) p.heroes = p.heroes.filter((x) => x !== hid);
    } else if (p.heroes.length < slots) p.heroes = [...p.heroes, hid];
    else if (slots === 1) p.heroes = [hid];
    this.h.saved();
    this.play();
  }

  private togglePerk(id: string, level: number): void {
    const p = this.profile;
    const pid = id as (typeof p.perks)[number];
    if (!perkUnlocked(level, pid)) return;
    if (p.perks.includes(pid)) p.perks = p.perks.filter((x) => x !== pid);
    else if (p.perks.length < perkSlots(level)) p.perks = [...p.perks, pid];
    this.h.saved();
    this.play();
  }

  // -- title ------------------------------------------------------------------------------------

  title(): void {
    const p = this.profile;
    const lp = levelProgress(p.xp);
    this.set(`<div class="panel title">
      <h1>${esc(GAME_NAME)}</h1>
      <p class="tag">${esc(GAME_TAG)}</p>
      <button class="primary" data-act="play">Play</button>
      <button data-act="profile">Profile <em>Level ${lp.level}</em></button>
      <div class="row">
        <button class="small" data-act="sound">Sound: ${p.muted ? 'Off' : 'On'}</button>
        <button class="small" data-act="shake">Screen shake: ${p.reduceMotion ? 'Off' : 'On'}</button>
      </div>
    </div>`, 'center');
  }

  // -- map and loadout --------------------------------------------------------------------------

  play(): void {
    const p = this.profile;
    const level = levelOf(p.xp);
    if (!mapUnlocked(level, p.map)) p.map = 'meadow';
    const maps = MAPS.map((id) => {
      const open = mapUnlocked(level, id);
      const rec = p.maps[id];
      const info = open
        ? `Best wave ${rec?.bestWave ?? 0}/${RUN.waves} · ${rec?.wins ?? 0} win${rec?.wins === 1 ? '' : 's'} · ×${MAP_BALANCE[id].xpMul} XP`
        : `Unlocks at level ${MAP_BALANCE[id].unlock}`;
      return `<button class="card ${id === p.map ? 'sel' : ''} ${open ? '' : 'locked'}" data-act="map" data-arg="${id}" ${open ? '' : 'disabled'}>
        <strong>${esc(MAP_TEXT[id].name)}</strong><span>${esc(MAP_TEXT[id].blurb)}</span><em>${info}</em></button>`;
    }).join('');
    const hs = heroSlots(level);
    const heroes = HERO_IDS.map((id) => {
      const open = heroUnlocked(level, id);
      const on = p.heroes.includes(id);
      const tx = HERO_TEXT[id];
      return `<button class="card hero ${on ? 'sel' : ''} ${open ? '' : 'locked'}" data-act="hero" data-arg="${id}" ${open ? '' : 'disabled'}>
        <i class="ic">${iconFor(id)}</i><strong>${esc(tx.name)}</strong><span>${esc(tx.blurb)}</span>
        <em>${open ? `${esc(tx.ability)} · ${HEROES[id].cost} gold` : `Unlocks at level ${HEROES[id].unlock}`}</em></button>`;
    }).join('');
    const ps = perkSlots(level);
    const perks = PERK_IDS.map((id) => {
      const open = perkUnlocked(level, id);
      const on = p.perks.includes(id);
      return `<button class="card perk ${on ? 'sel' : ''} ${open ? '' : 'locked'}" data-act="perk" data-arg="${id}" ${open ? '' : 'disabled'}>
        <strong>${esc(PERK_TEXT[id].name)}</strong><span>${esc(PERK_TEXT[id].desc)}</span>
        <em>${open ? (on ? 'Equipped' : '') : `Unlocks at level ${PERKS[id].unlock}`}</em></button>`;
    }).join('');
    const aspect = boardHeight(WORLD.rows) / boardWidth(WORLD.cols);
    this.set(`<div class="panel wide play">
      <h2>Choose your battlefield</h2>
      <div class="cols">
        <section>
          <div class="cards">${maps}</div>
          <canvas id="preview" width="520" height="${Math.round(520 * aspect)}"></canvas>
          <div class="row seedrow"><label>Map seed <input data-act="seed" type="number" min="0" value="${this.mapSeed}"></label>
            <button class="small" data-act="reroll">New map</button></div>
        </section>
        <section>
          <h3>Heroes <span class="sub">${p.heroes.length}/${hs}${hs < 2 ? ` · second slot at level ${RUN.secondHeroSlotLevel}` : ''}</span></h3>
          <div class="cards grid">${heroes}</div>
          <h3>Perks <span class="sub">${p.perks.length}/${ps}${ps === 0 ? ` · first slot at level ${PROFILE.perkSlotLevels[0]}` : ''}</span></h3>
          <div class="cards grid">${perks}</div>
        </section>
      </div>
      <div class="row"><button data-act="title">Back</button><button class="primary" data-act="go">Start</button></div>
    </div>`, 'scroll');
    const cv = this.root.querySelector('#preview') as HTMLCanvasElement | null;
    const g = cv?.getContext('2d');
    if (cv && g) this.renderer.drawPreview(g, this.terrain(p.map, this.mapSeed), cv.width, cv.height);
  }

  // -- profile ----------------------------------------------------------------------------------

  profileScreen(): void {
    const p = this.profile;
    const lp = levelProgress(p.xp);
    const rows: string[] = [];
    for (let l = 2; l <= PROFILE.maxLevel; l++) {
      const u = unlocksAt(l);
      const items: string[] = [
        ...u.heroes.map((h) => `Hero: ${HERO_TEXT[h].name}`),
        ...u.perks.map((k) => `Perk: ${PERK_TEXT[k].name}`),
        ...u.maps.map((m) => `Map: ${MAP_TEXT[m].name}`),
        ...(u.perkSlot ? ['Perk slot'] : []),
        ...(u.heroSlot ? ['Second hero slot'] : []),
      ];
      if (items.length) rows.push(`<li class="${l <= lp.level ? 'got' : ''}"><b>Level ${l}</b><span>${items.map(esc).join(' · ')}</span></li>`);
    }
    const foes = ENEMY_IDS.map((id) => {
      const d = ENEMIES[id];
      const tags = [d.flying ? 'Flying' : '', d.stealth ? 'Stealthy' : '', d.boss ? 'Boss' : ''].filter(Boolean).join(' · ');
      return `<div class="foe"><strong>${esc(ENEMY_TEXT[id].name)}</strong><span>${esc(ENEMY_TEXT[id].blurb)}</span>
        <em>${d.hp} HP · speed ${d.speed} · ${d.lives} ${d.lives === 1 ? 'life' : 'lives'}${tags ? ' · ' + tags : ''}</em></div>`;
    }).join('');
    this.set(`<div class="panel wide">
      <h2>Profile</h2>
      <p class="big">Level ${lp.level}${lp.need ? ` <span class="sub">${lp.into} / ${lp.need} XP</span>` : ' <span class="sub">max</span>'}</p>
      <div class="xp wideBar"><i style="width:${lp.need ? Math.round((lp.into / lp.need) * 100) : 100}%"></i></div>
      <p class="sub">${p.runs} run${p.runs === 1 ? '' : 's'} played · ${p.xp} XP in total</p>
      <h3>Unlocks</h3><ul class="unlocks">${rows.join('')}</ul>
      <h3>Compendium</h3><div class="foes">${foes}</div>
      <div class="row"><button data-act="title">Back</button></div>
    </div>`, 'scroll');
  }

  // -- pause and end ----------------------------------------------------------------------------

  pause(armed = false): void {
    this.set(`<div class="panel">
      <h2>Paused</h2>
      <button class="primary" data-act="resume">Resume</button>
      <button data-act="restart">Restart this map</button>
      <button data-act="giveup" class="${armed ? 'danger' : ''}">${armed ? 'Really give up?' : 'Give up'}</button>
      <p class="hint">Space calls the next wave · 1–7 build · Q/W heroes · U/I upgrade · S sell · T target · A ability · Esc pause</p>
    </div>`, 'center dim');
  }

  end(info: EndInfo): void {
    this.endInfo = info;
    const ups: string[] = [];
    for (let l = info.before + 1; l <= info.after; l++) {
      const u = unlocksAt(l);
      ups.push(`<li><b>Level ${l}</b> ${[
        ...u.heroes.map((h) => `Hero: ${HERO_TEXT[h].name}`),
        ...u.perks.map((k) => `Perk: ${PERK_TEXT[k].name}`),
        ...u.maps.map((m) => `Map: ${MAP_TEXT[m].name}`),
        ...(u.perkSlot ? ['Perk slot'] : []),
        ...(u.heroSlot ? ['Second hero slot'] : []),
      ].map(esc).join(' · ')}</li>`);
    }
    this.set(`<div class="panel ${info.won ? 'victory' : 'defeat'}">
      <h2>${info.won ? 'Victory' : info.gaveUp ? 'You withdrew' : 'The keep has fallen'}</h2>
      <p class="tag">${info.won ? 'Dawn finds the keep standing.' : 'The enemy marches on. Rebuild and try again.'}</p>
      <dl>
        <dt>Waves cleared</dt><dd>${info.cleared} / ${RUN.waves}</dd>
        <dt>Enemies slain</dt><dd>${info.kills}</dd>
        <dt>XP gained</dt><dd>+${info.xp}</dd>
        <dt>Level</dt><dd>${info.after}${info.after > info.before ? ` (was ${info.before})` : ''}</dd>
      </dl>
      ${ups.length ? `<h3>New unlocks</h3><ul class="unlocks">${ups.join('')}</ul>` : ''}
      <button class="primary" data-act="again">Again <em>same map</em></button>
      <button data-act="newmap">New map</button>
      <button data-act="title">Menu</button>
    </div>`, 'center dim');
  }
}
