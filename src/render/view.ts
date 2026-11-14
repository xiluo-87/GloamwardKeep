// The contract between main.ts/UI and the renderer. The renderer reads this each frame; it never
// changes the simulation.
import type { HeroId, TowerId } from '../data/balance';
import type { Terrain } from '../sim/mapgen';
import type { RunState } from '../sim/state';

export interface ViewState {
  /** uid of the selected tower or hero, or 0. */
  selectedUid: number;
  /** Tile the player has selected (first tap), highlighted on the board, or null. */
  selectedTile: { col: number; row: number } | null;
  /** Tile under the pointer (desktop hover) or being previewed, or null when off the board. */
  hoverTile: { col: number; row: number } | null;
  /** Type being previewed for placement (ghost + range on hoverTile), or null. */
  placing: TowerId | HeroId | null;
  /** Whether `placing` can go on `hoverTile` right now. */
  placeOk: boolean;
  /** Upgrade whose additional range is being previewed for the selected tower. */
  upgradePreview: { uid: number; path: 'tier' | 'a' | 'b' } | null;
  /**
   * Route enemies would walk if the previewed tower were built (tile indexes from previewRoute), drawn
   * as a dotted line with arrows; null to hide. routeSealed draws it as a warning (they'd smash through).
   */
  routePreview: number[] | null;
  routeSealed: boolean;
  /**
   * Player option: draw enemy paths (flyers' straight flight lines and the current ground route).
   * The placement route preview (routePreview) is shown regardless.
   */
  showPaths: boolean;
  /** Game speed shown by the debug overlay. */
  speed: number;
  debug: boolean;
  fps: number;
}

export const defaultView = (): ViewState => ({
  selectedUid: 0, selectedTile: null, hoverTile: null, placing: null, placeOk: false, upgradePreview: null,
  routePreview: null, routeSealed: false, showPaths: true, speed: 1, debug: false, fps: 60,
});

/**
 * Camera controls the renderer adds on top of its drawing API (see renderer.ts). All coordinates are
 * CSS pixels relative to the canvas.
 */
export interface CameraApi {
  /** True when the board is drawn turned 90°: gates at the top, keep at the bottom (portrait screens). */
  readonly rotated: boolean;
  /** Current zoom, 1 = whole board fits the free area. */
  readonly zoom: number;
  /** Configure the initial 3D view using the shared four-direction/four-tilt preset indexes. */
  configureCamera?(directionIndex: number, tiltIndex: number): void;
  /** Legacy 2D panning; the fixed-view 3D backend ignores drag deltas. */
  panBy(dx: number, dy: number): void;
  /** Zoom by `factor` keeping the point (x, y) fixed on screen. Clamped between fit and max zoom. */
  zoomAt(x: number, y: number, factor: number): void;
  /** Zoom out so the whole board fits. */
  fitBoard(): void;
  /** Bring a tile into view: 2D pans; the initial 3D slice fits the board around reserved UI space. */
  focusTile(col: number, row: number, avoidBottom?: number): void;
  /** Screen centre of a tile's top surface (including height lift) and the on-screen hex radius. */
  tileToScreen(col: number, row: number): { x: number; y: number; r: number };
  /** If (x, y) hits an edge arrow pointing at something off-screen, the tile it points to. */
  edgeArrowAt(x: number, y: number): { col: number; row: number } | null;
}

/** The rendering surface used by the game loop and input, independent of its drawing backend. */
export interface GameRenderer extends CameraApi {
  /** Pause the run while a graphics context is interrupted; restoration keeps current state. */
  onGraphicsInterrupted?: () => void;
  reduceMotion: boolean;
  resize(): void;
  setInsets(top: number, bottom: number, left: number, right: number): void;
  screenToWorld(x: number, y: number): { x: number; y: number };
  screenToTile(x: number, y: number): { col: number; row: number } | null;
  resetFx(): void;
  /** Initialize a newly created run before input/picking resumes. */
  syncState?(s: RunState): void;
  consumeEvents(s: RunState): void;
  draw(s: RunState, alpha: number, frameDt: number, wallTime: number, view: ViewState): void;
  drawTitle(time: number, terrain?: Terrain): void;
  dispose?(): void;
}
