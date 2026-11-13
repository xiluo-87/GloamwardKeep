// The live run as the UI sees it: the simulation state, the render view, and the player's commands.
// Input, HUD, ring, card and panel all go through this, so rules (and messages) live in one place.
import { HeroId, TOWER_IDS, TowerId } from '../data/balance';
import { CLEAR_TEXT } from '../data/text';
import {
  BuildCheck, build, callWave, canBuild, canCallWave, clearCost, clearTile, cycleTarget, findTower, learnSkill, sell, upgrade, useAbility,
} from '../sim/actions';
import { FEATURE } from '../sim/mapgen';
import { previewRoute } from '../sim/path';
import { RunState, towerAt, Tower } from '../sim/state';
import { buildCost, isHeroType, sellValue, upgradeOptions } from '../sim/stats';
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

/** Failure text for a placement, mentioning the clearing price when forest or rocks are in the way. */
export function checkMessage(s: RunState, check: BuildCheck, col: number, row: number): string {
  if (check === 'blocked') {
    const cost = clearCost(s, col, row);
    if (cost > 0) {
      const f = s.terrain.feature[row * s.terrain.cols + col] === FEATURE.forest ? CLEAR_TEXT.forest : CLEAR_TEXT.rocks;
      return `${f.name} — clear it for ${cost} gold first`;
    }
  }
  return CHECK_TEXT[check];
}

export const isUndo = (t: Tower): boolean => t.fresh === t.invested;

export class Session {
  run: RunState | null = null;
  view: ViewState = defaultView();
  paused = false;
  speed = 1;
  /** The action ring is open around the selected tile. */
  ring = false;
  /** Which build folder the ring shows (null = top level). */
  ringGroup: string | null = null;
  /** A bottom sheet is open (the hero skill tree). */
  sheet: 'skills' | null = null;
  /** The player is pressing / hovering a ring item and reading its description card. */
  previewing = false;
  /** Set when a sheet opened and the camera should bring the tile above it. */
  sheetFocus = false;
  onChange: () => void = () => undefined;
  onToast: (msg: string, bad?: boolean) => void = () => undefined;
  private sellArm = { uid: 0, at: 0 };
  private histPushed = false;

  begin(run: RunState): void {
    this.run = run;
    this.view = { ...defaultView(), speed: this.speed, debug: this.view.debug };
    this.paused = false;
    this.ring = false;
    this.sheet = null;
    this.previewing = false;
    this.sellArm.uid = 0;
    this.histPushed = false;
    this.onChange();
  }

  end(): void {
    this.run = null;
    this.ring = false;
    this.sheet = null;
    this.previewing = false;
    this.view.placing = null;
    this.view.selectedUid = 0;
    this.view.selectedTile = null;
    this.view.hoverTile = null;
    this.view.routePreview = null;
    this.dropHistory();
  }

  get selected(): Tower | undefined {
    return this.run && this.view.selectedUid ? findTower(this.run, this.view.selectedUid) : undefined;
  }

  get tile(): { col: number; row: number } | null { return this.view.selectedTile; }

  /** True while a menu-like layer is open, so the game can slow down. */
  get menuOpen(): boolean { return this.ring || this.sheet !== null || this.previewing; }

  // -- history (Android back closes the topmost layer) ------------------------------------------

  private pushHistory(): void {
    if (this.histPushed) return;
    try { window.history.pushState({ gk: 1 }, ''); this.histPushed = true; } catch { /* history may be unavailable */ }
  }

  /**
   * Closing a layer from the UI leaves its history entry in place (navigating back from code races with new
   * pushes). The entry is reused by the next layer; a back press with nothing open just consumes it.
   */
  private dropHistory(): void { /* intentionally empty */ }

  /** Called from the popstate listener. */
  handlePop(): void {
    this.histPushed = false;
    // Back inside a build folder goes up one level and keeps the history entry for the next press.
    if (this.ring && this.ringGroup) {
      this.ringGroup = null;
      this.clearPreview();
      this.pushHistory();
      this.onChange();
      return;
    }
    this.closeOverlays(false);
  }

  // -- selection --------------------------------------------------------------------------------

  private clearPreview(): void {
    this.previewing = false;
    this.view.placing = null;
    this.view.routePreview = null;
    this.view.routeSealed = false;
    this.view.placeOk = false;
  }

  selectTile(col: number, row: number): void {
    this.closeOverlays();
    this.view.selectedTile = { col, row };
    const t = this.run ? towerAt(this.run, col, row) : undefined;
    this.view.selectedUid = t ? t.uid : 0;
    this.view.hoverTile = null;
    this.sellArm.uid = 0;
    this.onChange();
  }

  openRing(): void {
    if (!this.view.selectedTile) return;
    this.ring = true;
    this.ringGroup = null;
    this.pushHistory();
    this.onChange();
  }

  openSheet(): void {
    this.ring = false;
    this.clearPreview();
    this.sheet = 'skills';
    this.sheetFocus = true;
    this.pushHistory();
    this.onChange();
  }

  /** Closes the ring, any preview and any sheet. Returns true if something was open. */
  closeOverlays(touchHistory = true): boolean {
    const was = this.ring || this.sheet !== null || this.previewing;
    this.ring = false;
    this.ringGroup = null;
    this.sheet = null;
    this.clearPreview();
    if (touchHistory) this.dropHistory();
    if (was) this.onChange();
    return was;
  }

  /** Esc: closes layers one by one, then the selection. */
  cancel(): boolean {
    if (this.ring && this.ringGroup) { this.ringGroup = null; this.clearPreview(); this.onChange(); return true; }
    if (this.closeOverlays()) return true;
    if (this.view.selectedTile || this.view.selectedUid) {
      this.view.selectedTile = null;
      this.view.selectedUid = 0;
      this.sellArm.uid = 0;
      this.onChange();
      return true;
    }
    return false;
  }

  /** Keeps the view's placement flag in step with gold, enemies and the previewed tile. */
  refreshView(): void {
    const v = this.view;
    const s = this.run;
    if (v.selectedUid && s && !findTower(s, v.selectedUid)) { v.selectedUid = 0; if (this.sheet) this.closeOverlays(); this.onChange(); }
    if (!s || !v.placing || !v.hoverTile) { v.placeOk = false; return; }
    v.placeOk = canBuild(s, v.placing, v.hoverTile.col, v.hoverTile.row) === 'ok';
  }

  /** Ghost, range and (on the road) route preview for a build item pressed in the ring. */
  previewBuild(id: TowerId | HeroId | null): void {
    const s = this.run;
    const tile = this.view.selectedTile;
    if (!id || !s || !tile) { this.clearPreview(); return; }
    this.previewing = true;
    this.view.placing = id;
    this.view.hoverTile = { col: tile.col, row: tile.row };
    this.view.placeOk = canBuild(s, id, tile.col, tile.row) === 'ok';
    if (s.terrain.height[tile.row * s.terrain.cols + tile.col] === 0) {
      const r = previewRoute(s, tile.col, tile.row);
      this.view.routePreview = r.tiles;
      this.view.routeSealed = r.sealed;
    } else {
      this.view.routePreview = null;
      this.view.routeSealed = false;
    }
  }

  /** Reading a description without a ghost (upgrades, sell, ...). */
  previewPlain(on: boolean): void {
    if (on) this.previewing = true;
    else this.clearPreview();
  }

  /** Whether building here on the road would seal it (for the description card). */
  get routeSealed(): boolean { return this.view.routeSealed; }

  // -- commands ---------------------------------------------------------------------------------

  /** Builds at the selected tile. Returns true if built. */
  buildHere(type: TowerId | HeroId): boolean {
    const s = this.run;
    const tile = this.view.selectedTile;
    if (!s || !tile) return false;
    const check = canBuild(s, type, tile.col, tile.row);
    if (check !== 'ok') {
      this.onToast(checkMessage(s, check, tile.col, tile.row), true);
      return false;
    }
    const t = build(s, type, tile.col, tile.row);
    if (!t) return false;
    this.closeOverlays();
    this.view.selectedUid = t.uid;
    this.onChange();
    return true;
  }

  /** Hotkeys 1–8 (one per tower type) and Q/W: build on the selected tile, or the hovered one. */
  hotkeyBuild(type: TowerId | HeroId | undefined): void {
    if (!type || !this.run) return;
    if (!this.view.selectedTile && this.view.hoverTile) this.selectTile(this.view.hoverTile.col, this.view.hoverTile.row);
    if (!this.view.selectedTile) { this.onToast('Select a tile first'); return; }
    this.buildHere(type);
  }

  towerSlot(n: number): void { this.hotkeyBuild(TOWER_IDS[n]); }

  heroSlot(n: number): void {
    const s = this.run;
    if (!s) return;
    const id = s.cfg.heroes[n];
    if (!id) return;
    if (s.heroesPlaced.includes(id)) {
      const t = s.towers.find((x) => x.type === id);
      if (t) { this.selectTile(t.tx, t.ty); }
    } else this.hotkeyBuild(id);
  }

  clearHere(): void {
    const s = this.run;
    const tile = this.view.selectedTile ?? this.view.hoverTile;
    if (!s || !tile) return;
    const cost = clearCost(s, tile.col, tile.row);
    if (cost === 0) return;
    if (s.gold < cost) { this.onToast('Not enough gold', true); return; }
    if (clearTile(s, tile.col, tile.row)) { this.closeOverlays(); this.onChange(); }
  }

  upgradeSelected(path?: 'a' | 'b'): boolean {
    const s = this.run;
    const t = this.selected;
    if (!s || !t || t.hero) return false;
    const opts = upgradeOptions(t, s.mods);
    if (opts.length === 0) { this.onToast('Fully upgraded'); return false; }
    if (path === 'b' && opts.length !== 2) return false;
    if (opts.length === 2 && !path) path = 'a';
    const opt = opts.length === 2 ? opts.find((o) => o.path === path) : opts[0];
    if (opt && s.gold < opt.cost) { this.onToast('Not enough gold', true); return false; }
    const ok = upgrade(s, t.uid, path);
    if (ok) this.onChange();
    return ok;
  }

  /** Sells the selected tower right now (the ring's hold gesture and undo end up here). */
  sellNow(): void {
    const s = this.run;
    const t = this.selected;
    if (!s || !t) return;
    const v = sellValue(t, s.mods);
    const undo = isUndo(t);
    if (sell(s, t.uid)) this.onToast(undo ? `Undone — ${v} gold back` : `Sold for ${v} gold`);
    this.sellArm.uid = 0;
    this.closeOverlays();
    this.view.selectedUid = 0;
    this.onChange();
  }

  /** Panel and S key: an undo is instant, a real sale needs a second press within three seconds. */
  sellSelected(now: number): void {
    const t = this.selected;
    if (!t) return;
    if (isUndo(t) || (this.sellArm.uid === t.uid && now - this.sellArm.at < 3000)) this.sellNow();
    else { this.sellArm.uid = t.uid; this.sellArm.at = now; this.onChange(); }
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

  costOf(type: TowerId | HeroId): number {
    return this.run ? buildCost(type, this.run.mods) : 0;
  }
}

export const isHeroId = (id: string): id is HeroId => isHeroType(id);
