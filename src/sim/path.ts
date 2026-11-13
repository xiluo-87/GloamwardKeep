// Enemy pathing on the hex board. Enemies walk on height-0 tiles only, following a flow field
// built from the keep outward. Towers on the road are passable at a high cost: when the player
// seals every route, enemies walk to the cheapest blocking tower and smash it.
import { PATHING } from '../data/balance';
import { hexNeighbours } from './hex';
import { RunState } from './state';

/**
 * Cost of stepping onto tile `j`, treating `extra` (a tile index, or -1) as if a tower stood there.
 * extra = -2 means "ignore towers entirely" (the flyers' route over walls).
 */
const enterCost = (s: RunState, j: number, extra = -1): number =>
  extra === -2 ? 1 : 1 + (s.occ[j] || j === extra ? PATHING.towerCost : 0);

/** The flyers' field: the road with every tower ignored. Terrain never changes on level 0, so it's built once. */
export function buildAirFlow(s: RunState): void {
  computeFlow(s, s.airFlow, -2);
}

/** The next tile for a flyer at tile `i`: along the road, flying over walls. */
export function nextAirTile(s: RunState, i: number): number {
  return nextTileIn(s, s.airFlow, i, -2);
}

/** Tiles of the flyers' route from each gate to the keep (gates concatenated). */
export function airRoute(s: RunState): number[] {
  const { cols, goal } = s.terrain;
  const goalIdx = goal[1] * cols + goal[0];
  const tiles: number[] = [];
  for (const [gx, gy] of s.terrain.spawns) {
    let i = gy * cols + gx;
    for (let guard = 0; guard < s.airFlow.length && i >= 0; guard++) {
      tiles.push(i);
      if (i === goalIdx) break;
      i = nextAirTile(s, i);
    }
  }
  return tiles;
}

/** Rebuilds the flow field. Call after any change to towers on level 0. */
export function rebuildFlow(s: RunState): void {
  computeFlow(s, s.flow, -1);
  s.flowVersion++;
}

/** Fills `flow` with walking costs to the keep, optionally pretending a tower stands on tile `extra`. */
function computeFlow(s: RunState, flow: Float32Array, extra: number): void {
  const { cols, rows, height, goal } = s.terrain;
  const n = cols * rows;
  flow.fill(Infinity);
  const done = new Uint8Array(n);
  const start = goal[1] * cols + goal[0];
  flow[start] = 0;
  // Dijkstra with a plain scan: the board has a few hundred tiles and this runs only on builds.
  for (;;) {
    let i = -1;
    let best = Infinity;
    for (let k = 0; k < n; k++) if (!done[k] && flow[k] < best) { best = flow[k]; i = k; }
    if (i < 0) break;
    done[i] = 1;
    const x = i % cols;
    const y = (i - x) / cols;
    const cost = enterCost(s, i, extra);
    for (const [dx, dy] of hexNeighbours(y)) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const j = ty * cols + tx;
      if (height[j] !== 0 || done[j]) continue;
      // Walking from j into i costs entering i.
      const d = flow[i] + cost;
      if (d < flow[j]) flow[j] = d;
    }
  }
}

/** The neighbour of tile `i` an enemy should step to next, or -1 if none. */
export function nextTile(s: RunState, i: number): number {
  return nextTileIn(s, s.flow, i, -1);
}

function nextTileIn(s: RunState, flow: Float32Array, i: number, extra: number): number {
  const { cols, rows, height } = s.terrain;
  const x = i % cols;
  const y = (i - x) / cols;
  let best = -1;
  let bestCost = Infinity;
  for (const [dx, dy] of hexNeighbours(y)) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
    const j = ty * cols + tx;
    if (height[j] !== 0) continue;
    const c = flow[j] + enterCost(s, j, extra);
    if (c < bestCost) { bestCost = c; best = j; }
  }
  return best;
}

/** True if some spawn gate can reach the keep without passing through a tower. */
export function routeOpen(s: RunState): boolean {
  const { cols } = s.terrain;
  return s.terrain.spawns.every(([x, y]) => s.flow[y * cols + x] < PATHING.towerCost);
}

export interface RoutePreview {
  /** Tile indexes of the route from each gate to the keep, in walking order, gates concatenated. */
  tiles: number[];
  /** True if the route has to go through at least one tower (enemies would smash through). */
  sealed: boolean;
}

/**
 * The route enemies would walk if a tower were built on (col, row), for showing the effect of a
 * wall before it's placed. Pass col = -1 for the current route.
 */
export function previewRoute(s: RunState, col: number, row: number): RoutePreview {
  const { cols, goal } = s.terrain;
  const extra = col < 0 ? -1 : row * cols + col;
  const flow = new Float32Array(s.flow.length);
  computeFlow(s, flow, extra);
  const goalIdx = goal[1] * cols + goal[0];
  const tiles: number[] = [];
  let sealed = false;
  for (const [gx, gy] of s.terrain.spawns) {
    let i = gy * cols + gx;
    if (flow[i] >= PATHING.towerCost) sealed = true;
    for (let guard = 0; guard < flow.length && i >= 0; guard++) {
      tiles.push(i);
      if (i === goalIdx) break;
      i = nextTileIn(s, flow, i, extra);
    }
  }
  return { tiles, sealed };
}
