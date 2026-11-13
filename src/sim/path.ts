// Enemy pathing on the hex board. Enemies walk on height-0 tiles only, following a flow field
// built from the keep outward. Towers on the road are passable at a high cost: when the player
// seals every route, enemies walk to the cheapest blocking tower and smash it.
import { PATHING } from '../data/balance';
import { hexNeighbours } from './hex';
import { RunState } from './state';

/** Cost of stepping onto tile `j`. */
const enterCost = (s: RunState, j: number): number => 1 + (s.occ[j] ? PATHING.towerCost : 0);

/** Rebuilds the flow field. Call after any change to towers on level 0. */
export function rebuildFlow(s: RunState): void {
  const { cols, rows, height, goal } = s.terrain;
  const n = cols * rows;
  const flow = s.flow;
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
    const cost = enterCost(s, i);
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
  s.flowVersion++;
}

/** The neighbour of tile `i` an enemy should step to next, or -1 if none. */
export function nextTile(s: RunState, i: number): number {
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
    const c = s.flow[j] + enterCost(s, j);
    if (c < bestCost) { bestCost = c; best = j; }
  }
  return best;
}

/** True if some spawn gate can reach the keep without passing through a tower. */
export function routeOpen(s: RunState): boolean {
  const { cols } = s.terrain;
  return s.terrain.spawns.every(([x, y]) => s.flow[y * cols + x] < PATHING.towerCost);
}
