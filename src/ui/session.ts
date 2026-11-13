// The live run as the UI sees it: the simulation state, the render view, and the player's commands.
// HUD, panel and input all go through this, so rules (and messages) live in one place.
import { HERO_IDS, HeroId, TOWER_IDS, TowerId } from '../data/balance';
import {
  BuildCheck, build, callWave, canBuild, canCallWave, cycleTarget, findTower, learnSkill, sell, upgrade, useAbility,
} from '../sim/actions';
import { buildCost, isHeroType, sellValue, upgradeOptions } from '../sim/stats';
import { RunState, towerAt, Tower } from '../sim/state';
import { defaultView, ViewState } from '../render/view';

export const CHECK_TEXT: Record<BuildCheck, string> = {
  ok: '',
  offBoard: 'Off the board',
  blocked: "Forest or rocks — can't build here",
  gate: "Gate or keep — can't build here",
  occupied: 'Something is already built here',
  enemy: 'An enemy is standing there',
  gold: 'Not enough gold',
  heroTaken: 'That hero is already on the board',
  heroNotInLoadout: 'That hero is not in your loadout',
  over: 'The run is over',
};

export class Session {
  run: RunState | null = null;
  view: ViewState = defaultView();
  paused = false;
  speed = 1;
  /** Fires when something the panel or bar shows may have changed structurally. */
  onChange: () => void = () => undefined;
  onToast: (msg: string, bad?: boolean) => void = () => undefined;
  onPauseRequest: () => void = () => undefined;
  private sellArm = { uid: 0, at: 0 };

  begin(run: RunState): void {
    this.run = run;
    this.view = { ...defaultView(), speed: this.speed, debug: this.view.debug };
    this.paused = false;
    this.sellArm.uid = 0;
    this.onChange();
  }

  end(): void {
    this.run = null;
    this.view.placing = null;
    this.view.selectedUid = 0;
    this.view.hoverTile = null;
  }

  get selected(): Tower | undefined {
    return this.run && this.view.selectedUid ? findTower(this.run, this.view.selectedUid) : undefined;
  }

  select(uid: number): void {
    this.view.selectedUid = uid;
    this.view.placing = null;
    this.sellArm.uid = 0;
    this.onChange();
  }

  setPlacing(id: TowerId | HeroId | null): void {
    this.view.placing = this.view.placing === id ? null : id;
    if (this.view.placing) this.view.selectedUid = 0;
    this.onChange();
  }

  cancel(): boolean {
    if (this.view.placing || this.view.selectedUid) {
      this.view.placing = null;
      this.view.selectedUid = 0;
      this.sellArm.uid = 0;
      this.onChange();
      return true;
    }
    return false;
  }

  /** Keeps the view's placement flag in step with gold, enemies and the hovered tile. */
  refreshView(): void {
    const v = this.view;
    const s = this.run;
    if (v.selectedUid && s && !findTower(s, v.selectedUid)) this.select(0);
    if (!s || !v.placing || !v.hoverTile) { v.placeOk = false; return; }
    v.placeOk = canBuild(s, v.placing, v.hoverTile.col, v.hoverTile.row) === 'ok';
  }

  /** Slot n of the loadout heroes (Q = 0, W = 1). Selects the hero if already placed. */
  heroSlot(n: number): void {
    const s = this.run;
    if (!s) return;
    const id = s.cfg.heroes[n];
    if (!id) return;
    if (s.heroesPlaced.includes(id)) {
      const t = s.towers.find((x) => x.type === id);
      if (t) this.select(t.uid);
    } else {
      this.setPlacing(id);
    }
  }

  towerSlot(n: number): void {
    const id = TOWER_IDS[n];
    if (id) this.setPlacing(id);
  }

  /** Builds the placing type at a tile. Returns true if built. */
  placeAt(col: number, row: number, keepGoing: boolean): boolean {
    const s = this.run;
    const type = this.view.placing;
    if (!s || !type) return false;
    const check = canBuild(s, type, col, row);
    if (check !== 'ok') {
      this.onToast(CHECK_TEXT[check], true);
      return false;
    }
    const t = build(s, type, col, row);
    if (!t) return false;
    if (isHeroType(type)) {
      this.select(t.uid);
      return true;
    }
    this.view.selectedUid = 0;
    if (!keepGoing || s.gold < buildCost(type, s.mods)) this.view.placing = null;
    this.onChange();
    return true;
  }

  upgradeSelected(path?: 'a' | 'b'): void {
    const s = this.run;
    const t = this.selected;
    if (!s || !t || t.hero) return;
    const opts = upgradeOptions(t, s.mods);
    if (opts.length === 0) { this.onToast('Fully upgraded'); return; }
    if (path === 'b' && opts.length !== 2) return;
    if (opts.length === 2 && !path) path = 'a';
    const opt = opts.length === 2 ? opts.find((o) => o.path === path) : opts[0];
    if (opt && s.gold < opt.cost) { this.onToast('Not enough gold', true); return; }
    if (upgrade(s, t.uid, path)) this.onChange();
  }

  /** Sell needs a second press within three seconds, so a stray click can't lose a tower. */
  sellSelected(now: number): void {
    const s = this.run;
    const t = this.selected;
    if (!s || !t) return;
    if (this.sellArm.uid === t.uid && now - this.sellArm.at < 3000) {
      const v = sellValue(t, s.mods);
      if (sell(s, t.uid)) this.onToast(`Sold for ${v} gold`);
      this.sellArm.uid = 0;
      this.view.selectedUid = 0;
    } else {
      this.sellArm.uid = t.uid;
      this.sellArm.at = now;
    }
    this.onChange();
  }

  sellArmed(now: number): boolean {
    return this.sellArm.uid !== 0 && this.sellArm.uid === this.view.selectedUid && now - this.sellArm.at < 3000;
  }

  target(): void {
    const s = this.run;
    const t = this.selected;
    if (s && t && cycleTarget(s, t.uid)) this.onChange();
  }

  ability(uid: number): void {
    const s = this.run;
    if (!s) return;
    const t = findTower(s, uid);
    if (!t || !t.hero) return;
    if (t.abilityCd > 0) { this.onToast('Ability is recharging'); return; }
    useAbility(s, uid);
  }

  learn(uid: number, branch: number, node: number): void {
    const s = this.run;
    if (s && learnSkill(s, uid, branch, node)) this.onChange();
  }

  call(): void {
    const s = this.run;
    if (!s) return;
    if (!canCallWave(s)) { this.onToast('The current wave is still arriving'); return; }
    callWave(s);
  }

  tileTower(col: number, row: number): Tower | undefined {
    return this.run ? towerAt(this.run, col, row) : undefined;
  }
}

export const isHeroId = (id: string): id is HeroId => (HERO_IDS as string[]).includes(id);
