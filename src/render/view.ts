// The contract between main.ts/UI and the renderer. The renderer reads this each frame; it never
// changes the simulation.
import type { HeroId, TowerId } from '../data/balance';

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
  selectedUid: 0, selectedTile: null, hoverTile: null, placing: null, placeOk: false,
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
  panBy(dx: number, dy: number): void;
  /** Zoom by `factor` keeping the point (x, y) fixed on screen. Clamped between fit and max zoom. */
  zoomAt(x: number, y: number, factor: number): void;
  /** Zoom out so the whole board fits. */
  fitBoard(): void;
  /** Pan (smoothly) so the tile is centred in the free area, leaving `avoidBottom` px free at the bottom. */
  focusTile(col: number, row: number, avoidBottom?: number): void;
  /** Screen centre of a tile's top surface (including height lift) and the on-screen hex radius. */
  tileToScreen(col: number, row: number): { x: number; y: number; r: number };
  /** If (x, y) hits an edge arrow pointing at something off-screen, the tile it points to. */
  edgeArrowAt(x: number, y: number): { col: number; row: number } | null;
}
