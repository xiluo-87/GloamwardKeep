// The contract between main.ts/UI and the renderer. The renderer reads this each frame; it never
// changes the simulation.
import type { HeroId, TowerId } from '../data/balance';

export interface ViewState {
  /** uid of the selected tower or hero, or 0. */
  selectedUid: number;
  /** Tile under the pointer, or null when off the board. */
  hoverTile: { col: number; row: number } | null;
  /** Type being placed from the build bar, or null. */
  placing: TowerId | HeroId | null;
  /** Whether `placing` can go on `hoverTile` right now. */
  placeOk: boolean;
  /** Game speed shown by the debug overlay. */
  speed: number;
  debug: boolean;
  fps: number;
}

export const defaultView = (): ViewState => ({
  selectedUid: 0, hoverTile: null, placing: null, placeOk: false, speed: 1, debug: false, fps: 60,
});
