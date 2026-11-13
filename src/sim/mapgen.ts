// Seeded terrain generator on a hex grid (see hex.ts). Heights 0..4; enemies walk on height 0 only.
// Same seed and preset always give the same map.
import { HEIGHT, MAP_BALANCE, MapGenParams, MapId, WORLD } from '../data/balance';
import { hexDistance, hexNeighbours } from './hex';
import { Rng } from './rng';

export interface Terrain {
  cols: number;
  rows: number;
  /** Height per tile, row-major. */
  height: Uint8Array;
  /** Feature per tile: FEATURE.none, forest or rocks. Never set on height 0. */
  feature: Uint8Array;
  /** Spawn gates (tiles on the left edge) and the keep (a tile on the right edge). */
  spawns: [number, number][];
  goal: [number, number];
  /** Seed that produced this map, after any rejected attempts. */
  seed: number;
}

const MAX_ATTEMPTS = 200;

export const FEATURE = { none: 0, forest: 1, rocks: 2 } as const;

export function generateMap(preset: MapId, seed: number): Terrain {
  const p = MAP_BALANCE[preset].gen;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const t = tryGenerate(p, s);
    if (t) return t;
  }
  // Fallback that can't fail: the road on flat low ground, with no length or reach checks.
  const t = tryGenerate({ ...p, heightShare: [1, 0, 0, 0], minPathTiles: 0, minReach: 0 }, seed) as Terrain;
  return t;
}

function tryGenerate(p: MapGenParams, seed: number): Terrain | null {
  const { cols, rows } = WORLD;
  const rng = new Rng(seed);
  const n = cols * rows;

  // 1. Layered value noise.
  const noise = new Float32Array(n);
  p.noiseScales.forEach((scale, i) => addValueNoise(noise, cols, rows, scale, p.noiseWeights[i] ?? 0, rng));

  // 2. Spawns on the left edge, the keep on the right edge, kept away from the corners.
  const margin = 2;
  const spawns: [number, number][] = [];
  for (let i = 0; i < p.spawns; i++) {
    // Spread several gates over separate bands of the edge.
    const band = (rows - margin * 2) / p.spawns;
    const y = Math.floor(margin + band * i + rng.range(0.2, 0.8) * band);
    spawns.push([0, Math.min(rows - 1 - margin, y)]);
  }
  const goal: [number, number] = [cols - 1, margin + rng.int(rows - margin * 2)];

  // 3. Carve the road as a serpentine: legs that sweep between the top and bottom bands, spread
  //    across the board, so the route passes near most tiles. Extra gates join the first leg.
  const carved = new Uint8Array(n);
  const legs = p.legs[0] + rng.int(p.legs[1] - p.legs[0] + 1);
  const band = Math.max(1, Math.round((rows - 2) * p.bendBand));
  const topY = (): number => rng.int(band);
  const bottomY = (): number => rows - 1 - rng.int(band);
  const route: [number, number][] = [spawns[0]];
  let down = rng.chance(0.5);
  for (let k = 0; k < legs; k++) {
    const x = Math.round(((k + 1) / (legs + 1)) * (cols - 1) + rng.range(-0.8, 0.8));
    const clampX = (v: number): number => Math.max(1, Math.min(cols - 2, v));
    route.push([clampX(x), down ? topY() : bottomY()]);
    route.push([clampX(x + rng.int(3) - 1), down ? bottomY() : topY()]);
    down = !down;
  }
  route.push(goal);
  for (let i = 1; i < route.length; i++) carveLine(carved, cols, rows, route[i - 1], route[i], p.valleyRadius, rng);
  for (let g = 1; g < spawns.length; g++) carveLine(carved, cols, rows, spawns[g], route[1], p.valleyRadius, rng);

  // 4. Clearings at the road's turns give room to build mazes. Turns sit near the top and bottom
  //    edges, so a clearing there widens the bend without bridging two legs into a shortcut.
  const turns = route.slice(1, -1);
  const clearings = Math.min(turns.length, p.clearings[0] + rng.int(p.clearings[1] - p.clearings[0] + 1));
  for (let c = 0; c < clearings; c++) {
    const [tx, ty] = turns.splice(rng.int(turns.length), 1)[0];
    const r = p.clearingRadius[0] + rng.int(p.clearingRadius[1] - p.clearingRadius[0] + 1);
    // Push the centre toward the nearer edge, away from the neighbouring legs.
    const cy = ty < rows / 2 ? Math.max(0, ty - 1) : Math.min(rows - 1, ty + 1);
    carveBlob(carved, cols, rows, tx, cy, r, rng);
  }

  // 5. Off-road heights 1..4 by quantile, so each preset gets its share of every level.
  const height = new Uint8Array(n);
  const sorted = Array.from(noise).filter((_, i) => !carved[i]).sort((a, b) => a - b);
  const m = sorted.length;
  const cuts: number[] = [];
  let acc = 0;
  for (let h = 0; h < HEIGHT.max - 1; h++) {
    acc += p.heightShare[h];
    cuts.push(m ? sorted[Math.min(m - 1, Math.floor(acc * m))] : 0);
  }
  for (let i = 0; i < n; i++) {
    let h = 1;
    while (h < HEIGHT.max && noise[i] > cuts[h - 1]) h++;
    height[i] = carved[i] ? 0 : h;
  }
  for (const [x, y] of [...spawns, goal]) height[y * cols + x] = 0;

  // 6. Terraces: neighbours differ by at most maxStep levels. Only lowers tiles, so the valley survives.
  terrace(height, cols, rows, p.maxStep);

  // 7. Every level-0 tile must be part of the road network: raise pockets cut off from it.
  const main = floodZero(height, cols, rows, spawns[0][1] * cols + spawns[0][0]);
  if (!main[goal[1] * cols + goal[0]]) return null;
  for (const [x, y] of spawns) if (!main[y * cols + x]) return null;
  raisePockets(height, main);
  terraceUp(height, cols, rows, p.maxStep);

  // 8. The walk must be long enough, and the route must pass near enough of the board.
  const dist = walkDistance(height, cols, rows, goal);
  for (const [x, y] of spawns) {
    const d = dist[y * cols + x];
    if (!Number.isFinite(d) || d < p.minPathTiles) return null;
  }
  if (routeReach(dist, cols, rows, spawns, p.reachRadius) < p.minReach) return null;

  const feature = placeFeatures(p, height, cols, rows, rng);
  return { cols, rows, height, feature, spawns, goal, seed };
}

/**
 * Forest groves follow their own noise layer over low hills; rocks are scattered over high ground,
 * more often on cliff edges. Both only cover tiles of height 1 or more.
 */
function placeFeatures(p: MapGenParams, height: Uint8Array, cols: number, rows: number, rng: Rng): Uint8Array {
  const n = cols * rows;
  const feature = new Uint8Array(n);
  const inBand = (h: number, [lo, hi]: [number, number]): boolean => h >= Math.max(1, lo) && h <= hi;

  // Forest: take the highest-noise share of eligible tiles, so trees clump into groves.
  const grove = new Float32Array(n);
  addValueNoise(grove, cols, rows, p.forest.scale, 1, rng);
  const forestCandidates: number[] = [];
  for (let i = 0; i < n; i++) if (inBand(height[i], p.forest.heights)) forestCandidates.push(i);
  forestCandidates.sort((a, b) => grove[b] - grove[a]);
  const forestCount = Math.round(p.forest.share * forestCandidates.length);
  for (let k = 0; k < forestCount; k++) feature[forestCandidates[k]] = FEATURE.forest;

  // Rocks: random picks among free high tiles, with extra weight where the ground drops away.
  for (let i = 0; i < n; i++) {
    if (feature[i] || !inBand(height[i], p.rocks.heights)) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    let cliff = false;
    for (const [dx, dy] of hexNeighbours(y)) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < cols && ty < rows && height[i] - height[ty * cols + tx] >= 2) cliff = true;
    }
    if (rng.chance(p.rocks.share + (cliff ? p.rocks.cliffBonus : 0))) feature[i] = FEATURE.rocks;
  }
  return feature;
}

// ---------------------------------------------------------------------------------------------

function addValueNoise(out: Float32Array, cols: number, rows: number, scale: number, weight: number, rng: Rng): void {
  const gw = Math.ceil((cols + 1) / scale) + 2;
  const gh = Math.ceil(rows / scale) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const ox = rng.next() * scale;
  const oy = rng.next() * scale;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Sample at the hex centre so the noise isn't skewed by the row offset.
      const fx = (x + 0.5 * (y & 1) + ox) / scale;
      const fy = (y * 0.866 + oy) / scale;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const a = grid[iy * gw + ix];
      const b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix];
      const d = grid[(iy + 1) * gw + ix + 1];
      out[y * cols + x] += weight * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
  }
}

function mark(carved: Uint8Array, cols: number, rows: number, x: number, y: number, r: number): void {
  for (let ty = y - r; ty <= y + r; ty++) {
    for (let tx = x - r - 1; tx <= x + r + 1; tx++) {
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      if (hexDistance(x, y, tx, ty) <= r) carved[ty * cols + tx] = 1;
    }
  }
}

/**
 * Walks from a to b one hex at a time, carving a road. Each step goes to a neighbour that gets
 * closer to b; when two neighbours are equally good it picks one at random, which makes the road wander.
 */
function carveLine(carved: Uint8Array, cols: number, rows: number, a: [number, number], b: [number, number], r: number, rng: Rng): void {
  let [x, y] = a;
  mark(carved, cols, rows, x, y, r);
  let guard = 0;
  while ((x !== b[0] || y !== b[1]) && guard++ < 400) {
    const here = hexDistance(x, y, b[0], b[1]);
    let options = 0;
    let nx = x;
    let ny = y;
    for (const [dx, dy] of hexNeighbours(y)) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      if (hexDistance(tx, ty, b[0], b[1]) >= here) continue;
      options++;
      if (rng.next() < 1 / options) { nx = tx; ny = ty; }
    }
    x = nx;
    y = ny;
    mark(carved, cols, rows, x, y, r);
  }
}

function carveBlob(carved: Uint8Array, cols: number, rows: number, cx: number, cy: number, r: number, rng: Rng): void {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      if (x < 1 || y < 0 || x >= cols - 1 || y >= rows) continue;
      // A slightly ragged edge so clearings don't look like perfect hexagons.
      if (hexDistance(cx, cy, x, y) <= r + rng.range(-0.4, 0.6)) carved[y * cols + x] = 1;
    }
  }
}

function terrace(h: Uint8Array, cols: number, rows: number, step: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        for (const [dx, dy] of hexNeighbours(y)) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
          const o = h[ty * cols + tx];
          if (h[i] > o + step) { h[i] = o + step; changed = true; }
        }
      }
    }
  }
}

/** After raising pockets, lift any tile that sits more than `step` below a neighbour, except the road. */
function terraceUp(h: Uint8Array, cols: number, rows: number, step: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (h[i] === 0) continue;
        for (const [dx, dy] of hexNeighbours(y)) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
          const o = h[ty * cols + tx];
          if (o > h[i] + step) { h[i] = o - step; changed = true; }
        }
      }
    }
  }
}

function floodZero(h: Uint8Array, cols: number, rows: number, start: number): Uint8Array {
  const seen = new Uint8Array(cols * rows);
  if (h[start] !== 0) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % cols;
    const y = Math.floor(i / cols);
    for (const [dx, dy] of hexNeighbours(y)) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const j = ty * cols + tx;
      if (!seen[j] && h[j] === 0) { seen[j] = 1; stack.push(j); }
    }
  }
  return seen;
}

function raisePockets(h: Uint8Array, main: Uint8Array): void {
  for (let i = 0; i < h.length; i++) if (h[i] === 0 && !main[i]) h[i] = 1;
}

/** Shortest walk over level-0 hexes from every tile to the goal, in tiles. Infinity if unreachable. */
export function walkDistance(h: Uint8Array, cols: number, rows: number, goal: [number, number]): Float32Array {
  const dist = new Float32Array(cols * rows).fill(Infinity);
  const start = goal[1] * cols + goal[0];
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % cols;
    const y = Math.floor(i / cols);
    for (const [dx, dy] of hexNeighbours(y)) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const j = ty * cols + tx;
      if (h[j] === 0 && dist[j] === Infinity) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  return dist;
}

/** Tiles on the shortest route from each spawn to the keep (following the walk distance downhill). */
export function routeTiles(dist: Float32Array, cols: number, rows: number, spawns: [number, number][]): Uint8Array {
  const on = new Uint8Array(cols * rows);
  for (const [sx, sy] of spawns) {
    let x = sx;
    let y = sy;
    on[y * cols + x] = 1;
    while (dist[y * cols + x] > 0) {
      let best = dist[y * cols + x];
      let nx = x;
      let ny = y;
      for (const [dx, dy] of hexNeighbours(y)) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
        if (dist[ty * cols + tx] < best) { best = dist[ty * cols + tx]; nx = tx; ny = ty; }
      }
      if (nx === x && ny === y) break;
      x = nx;
      y = ny;
      on[y * cols + x] = 1;
    }
  }
  return on;
}

/** Share of all tiles within `radius` hexes of the route. */
export function routeReach(dist: Float32Array, cols: number, rows: number, spawns: [number, number][], radius: number): number {
  const on = routeTiles(dist, cols, rows, spawns);
  const route: [number, number][] = [];
  for (let i = 0; i < on.length; i++) if (on[i]) route.push([i % cols, Math.floor(i / cols)]);
  let near = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (route.some(([rx, ry]) => Math.abs(ry - y) <= radius && hexDistance(rx, ry, x, y) <= radius)) near++;
    }
  }
  return near / (cols * rows);
}

/** Text picture of a map for tests and debugging: digits are heights, f forest, r rocks, S spawns, K the keep. Odd rows are indented. */
export function terrainToString(t: Terrain): string {
  const lines: string[] = [];
  for (let y = 0; y < t.rows; y++) {
    let line = y & 1 ? ' ' : '';
    for (let x = 0; x < t.cols; x++) {
      if (x > 0) line += ' ';
      if (t.spawns.some(([sx, sy]) => sx === x && sy === y)) line += 'S';
      else if (t.goal[0] === x && t.goal[1] === y) line += 'K';
      else if (t.feature[y * t.cols + x] === FEATURE.forest) line += 'f';
      else if (t.feature[y * t.cols + x] === FEATURE.rocks) line += 'r';
      else line += t.height[y * t.cols + x] === 0 ? '.' : String(t.height[y * t.cols + x]);
    }
    lines.push(line);
  }
  return lines.join('\n');
}
