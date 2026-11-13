import type { MapId } from './balance';

/**
 * Map layouts. Paths are lists of tile coordinates joined by straight, axis-aligned segments.
 * The first point sits just off the board (where enemies appear) and the last point is the hearth.
 * Enemies alternate between a map's paths.
 */
export interface MapDef {
  id: MapId;
  paths: [number, number][][];
  /** Tiles that hold scenery and can't be built on. */
  blocked: [number, number][];
}

export const MAPS: Record<MapId, MapDef> = {
  lane: {
    id: 'lane',
    paths: [[[-1, 2], [4, 2], [4, 8], [9, 8], [9, 3], [15, 3], [15, 9], [20, 9]]],
    blocked: [[1, 6], [7, 0], [12, 10], [18, 1], [12, 6]],
  },
  crossing: {
    id: 'crossing',
    paths: [
      [[-1, 1], [6, 1], [6, 5], [13, 5], [13, 10], [20, 10]],
      [[-1, 10], [3, 10], [3, 7], [9, 7], [9, 5], [13, 5], [13, 10], [20, 10]],
    ],
    blocked: [[1, 4], [10, 2], [16, 3], [17, 7], [6, 11]],
  },
  row: {
    id: 'row',
    paths: [[[8, -1], [8, 3], [2, 3], [2, 6], [17, 6], [17, 9], [10, 9], [10, 12]]],
    blocked: [[0, 0], [14, 1], [5, 9], [19, 11], [13, 3]],
  },
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
