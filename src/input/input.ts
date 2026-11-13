// Pointer (mouse and touch) and keyboard. Both only talk to the Session; the simulation is never touched here.
import type { Renderer } from '../render/renderer';
import { towerAt } from '../sim/state';
import type { Session } from '../ui/session';
import { checkMessage } from '../ui/session';
import { clearCost } from '../sim/actions';
import { canBuild } from '../sim/actions';

export interface ControlHooks {
  /** True while a run is on screen and not paused. */
  active(): boolean;
  /** True while a run exists (even paused), for Esc handling. */
  inRun(): boolean;
  togglePause(): void;
  toggleDebug(): void;
  stepSpeed(dir: number): void;
  anyKey(): void;
}

export class Controls {
  private pending: { col: number; row: number } | null = null;
  private down: { x: number; y: number; id: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private session: Session, private renderer: Renderer, private hooks: ControlHooks) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => { this.down = null; });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.session.view.hoverTile = null;
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.hooks.active()) this.session.cancel();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Forget a half-confirmed touch placement (placing mode ended, new run, ...). */
  reset(): void {
    this.pending = null;
    this.down = null;
  }

  private onDown(e: PointerEvent): void {
    this.hooks.anyKey();
    if (e.button === 2) return;
    this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || !this.hooks.active()) return;
    this.session.view.hoverTile = this.renderer.screenToTile(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId || !this.hooks.active() || e.button === 2) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) return;
    this.tap(this.renderer.screenToTile(e.clientX, e.clientY), e.pointerType === 'mouse');
  }

  private tap(tile: { col: number; row: number } | null, mouse: boolean): void {
    const ss = this.session;
    const s = ss.run;
    if (!s) return;
    const v = ss.view;
    if (!tile) {
      this.pending = null;
      ss.cancel();
      return;
    }
    const tower = towerAt(s, tile.col, tile.row);
    if (v.placing) {
      if (tower) {
        this.pending = null;
        ss.select(tower.uid);
        return;
      }
      if (mouse) {
        v.hoverTile = tile;
        ss.placeAt(tile.col, tile.row, true);
        ss.refreshView();
        return;
      }
      // Touch: the first tap previews, a second tap on the same tile confirms.
      if (this.pending && this.pending.col === tile.col && this.pending.row === tile.row) {
        this.pending = null;
        ss.placeAt(tile.col, tile.row, false);
        v.hoverTile = null;
        return;
      }
      this.pending = tile;
      v.hoverTile = tile;
      const check = canBuild(s, v.placing, tile.col, tile.row);
      if (check !== 'ok') ss.onToast(checkMessage(s, check, tile.col, tile.row), true);
      ss.refreshView();
      return;
    }
    this.pending = null;
    if (!tower && clearCost(s, tile.col, tile.row) > 0) ss.selectTile(tile.col, tile.row);
    else ss.select(tower ? tower.uid : 0);
  }

  private onKey(e: KeyboardEvent): void {
    this.hooks.anyKey();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (e.code === 'Space' || key === 'f3') e.preventDefault();
    if (key === 'escape') {
      if (!this.hooks.inRun()) return;
      if (this.hooks.active() && this.session.cancel()) { this.pending = null; return; }
      this.hooks.togglePause();
      return;
    }
    if (key === 'p' && this.hooks.inRun()) { this.hooks.togglePause(); return; }
    if (key === 'f3' || key === '`') { this.hooks.toggleDebug(); return; }
    if (!this.hooks.active()) return;
    const ss = this.session;
    if (key >= '1' && key <= '7') ss.towerSlot(Number(key) - 1);
    else if (key === 'q') ss.heroSlot(0);
    else if (key === 'w') ss.heroSlot(1);
    else if (e.code === 'Space') ss.call();
    else if (key === 'u') ss.upgradeSelected('a');
    else if (key === 'i') ss.upgradeSelected('b');
    else if (key === 's') ss.sellSelected(performance.now());
    else if (key === 'c') { const h = ss.view.hoverTile ?? ss.selectedTile; if (h) ss.clearAt(h.col, h.row); }
    else if (key === 't') ss.target();
    else if (key === 'a') { const h = ss.selected; if (h?.hero) ss.ability(h.uid); }
    else if (key === '[') this.hooks.stepSpeed(-1);
    else if (key === ']') this.hooks.stepSpeed(1);
  }
}
