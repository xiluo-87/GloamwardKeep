// Pointer (mouse and touch) and keyboard. Both only talk to the Session and the camera; the simulation
// is never touched here. A drag over 8 px pans, two fingers pinch, a tap selects a tile and a second
// tap on the same tile opens the action ring.
import { TOWER_IDS } from '../data/balance';
import type { Renderer } from '../render/renderer';
import type { Session } from '../ui/session';

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

const DRAG = 8;

interface Ptr { x: number; y: number; sx: number; sy: number; moved: boolean }

export class Controls {
  private ptrs = new Map<number, Ptr>();
  /** Set once a gesture became a pan or pinch, so lifting a finger never counts as a tap. */
  private dead = false;
  private pinch: { dist: number; cx: number; cy: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private session: Session, private renderer: Renderer, private hooks: ControlHooks) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.drop(e));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.session.previewing) this.session.view.hoverTile = null;
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.hooks.active()) this.session.cancel();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.hooks.active()) this.renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Forget any gesture in progress (new run, menu opened, ...). */
  reset(): void {
    this.ptrs.clear();
    this.pinch = null;
    this.dead = false;
  }

  private onDown(e: PointerEvent): void {
    this.hooks.anyKey();
    if (e.button === 2) return;
    if (this.ptrs.size === 0) this.dead = false;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    if (this.ptrs.size === 2) {
      this.dead = true;
      this.pinch = this.measure();
    }
  }

  private measure(): { dist: number; cx: number; cy: number } {
    const [a, b] = [...this.ptrs.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private onMove(e: PointerEvent): void {
    if (!this.hooks.active()) return;
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && !this.session.previewing) this.session.view.hoverTile = this.renderer.screenToTile(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.ptrs.size >= 2 && this.pinch) {
      const m = this.measure();
      this.renderer.zoomAt(m.cx, m.cy, m.dist / this.pinch.dist);
      this.renderer.panBy(m.cx - this.pinch.cx, m.cy - this.pinch.cy);
      this.pinch = m;
      return;
    }
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG) {
      p.moved = true;
      this.dead = true;
      // The finger already travelled DRAG px: carry that over so the map doesn't lag the finger.
      this.renderer.panBy(e.clientX - p.sx, e.clientY - p.sy);
      return;
    }
    if (p.moved) this.renderer.panBy(dx, dy);
    else if (e.pointerType === 'mouse' && !this.session.previewing) this.session.view.hoverTile = this.renderer.screenToTile(e.clientX, e.clientY);
  }

  private drop(e: PointerEvent): void {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
  }

  private onUp(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId);
    this.drop(e);
    if (!p || !this.hooks.active() || e.button === 2) return;
    if (this.dead || p.moved) {
      if (this.ptrs.size === 0) this.dead = false;
      return;
    }
    this.tap(e.clientX, e.clientY, e.pointerType === 'mouse');
  }

  private tap(x: number, y: number, mouse: boolean): void {
    const ss = this.session;
    const s = ss.run;
    if (!s) return;
    const arrow = this.renderer.edgeArrowAt(x, y);
    if (arrow) {
      ss.closeOverlays();
      this.renderer.focusTile(arrow.col, arrow.row);
      return;
    }
    // A tap on the map while the ring or a sheet is open only closes it.
    if (ss.ring || ss.sheet) { ss.closeOverlays(); return; }
    const tile = this.renderer.screenToTile(x, y);
    if (!tile) { ss.cancel(); return; }
    if (mouse) ss.view.hoverTile = tile;
    const cur = ss.tile;
    if (cur && cur.col === tile.col && cur.row === tile.row) ss.openRing();
    else ss.selectTile(tile.col, tile.row);
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
      if (this.hooks.active() && this.session.cancel()) return;
      this.hooks.togglePause();
      return;
    }
    if (key === 'p' && this.hooks.inRun()) { this.hooks.togglePause(); return; }
    if (key === 'f3' || key === '`') { this.hooks.toggleDebug(); return; }
    if (!this.hooks.active()) return;
    const ss = this.session;
    if (key >= '1' && key <= String(TOWER_IDS.length)) ss.towerSlot(Number(key) - 1);
    else if (key === 'q') ss.heroSlot(0);
    else if (key === 'w') ss.heroSlot(1);
    else if (e.code === 'Space') ss.call();
    else if (key === 'u') ss.upgradeSelected('a');
    else if (key === 'i') ss.upgradeSelected('b');
    else if (key === 's') ss.sellSelected(performance.now());
    else if (key === 'c') ss.clearHere();
    else if (key === 'k') ss.raiseKeep();
    else if (key === 't') ss.target();
    else if (key === 'a') { const h = ss.selected; if (h?.hero) ss.ability(h.uid); }
    else if (key === 'f') this.renderer.fitBoard();
    else if (key === '[') this.hooks.stepSpeed(-1);
    else if (key === ']') this.hooks.stepSpeed(1);
  }
}
