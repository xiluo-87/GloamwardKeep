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
  /** Spawn gates (tiles on the left edge) and the keep (a tile on the right edge). */
  spawns: [number, number][];
  goal: [number, number];
  /** Seed that produced this map, after any rejected attempts. */
  seed: number;
}

const MAX_ATTEMPTS = 40;

export function generateMap(preset: MapId, seed: number): Terrain {
  const p = MAP_BALANCE[preset].gen;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const t = tryGenerate(p, s);
    if (t) return t;
  }
  // Fallback that can't fail: a flat field.
  const t = tryGenerate({ ...p, heightShare: [1, 0, 0, 0, 0], minPathTiles: 0 }, seed) as Terrain;
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

  // 3. Carve a winding valley from each spawn to the keep.
  const carved = new Uint8Array(n);
  for (const sp of spawns) {
    const bends = p.bends[0] + rng.int(p.bends[1] - p.bends[0] + 1);
    const points: [number, number][] = [sp];
    for (let b = 0; b < bends; b++) {
      const x = Math.round(((b + 1) / (bends + 1)) * (cols - 1) + rng.range(-1.5, 1.5));
      const y = 1 + rng.int(rows - 2);
      points.push([Math.max(1, Math.min(cols - 2, x)), y]);
    }
    points.push(goal);
    for (let i = 1; i < points.length; i++) carveLine(carved, cols, rows, points[i - 1], points[i], p.valleyRadius, rng);
  }

  // 4. Clearings joined to the valley give room to build mazes.
  const valleyTiles: number[] = [];
  for (let i = 0; i < n; i++) if (carved[i]) valleyTiles.push(i);
  const clearings = p.clearings[0] + rng.int(p.clearings[1] - p.clearings[0] + 1);
  for (let c = 0; c < clearings; c++) {
    const at = valleyTiles[rng.int(valleyTiles.length)];
    const r = p.clearingRadius[0] + rng.int(p.clearingRadius[1] - p.clearingRadius[0] + 1);
    const cx = (at % cols) + rng.int(3) - 1;
    const cy = Math.floor(at / cols) + rng.int(3) - 1;
    carveBlob(carved, cols, rows, cx, cy, r, rng);
  }

  // 5. Heights by quantile, so each preset gets its share of every level.
  const height = new Uint8Array(n);
  // Shares count only tiles outside the valley, so carving doesn't eat into the hills.
  const sorted = Array.from(noise).filter((_, i) => !carved[i]).sort((a, b) => a - b);
  const m = sorted.length;
  const cuts: number[] = [];
  let acc = 0;
  for (let h = 0; h < HEIGHT.max; h++) {
    acc += p.heightShare[h];
    cuts.push(m ? sorted[Math.min(m - 1, Math.floor(acc * m))] : 0);
  }
  for (let i = 0; i < n; i++) {
    let h = 0;
    while (h < HEIGHT.max && noise[i] > cuts[h]) h++;
    height[i] = carved[i] ? 0 : h;
  }
  for (const [x, y] of [...spawns, goal]) height[y * cols + x] = 0;

  // 6. Terraces: neighbours differ by at most maxStep levels. Only lowers tiles, so the valley survives.
  terrace(height, cols, rows, p.maxStep);

  // 7. Raise small level-0 pockets that don't touch the valley, so the road reads clearly.
  const main = floodZero(height, cols, rows, spawns[0][1] * cols + spawns[0][0]);
  if (!main[goal[1] * cols + goal[0]]) return null;
  for (const [x, y] of spawns) if (!main[y * cols + x]) return null;
  raisePockets(height, main, cols, rows, p.minPocket);
  terraceUp(height, cols, rows, p.maxStep);

  // 8. The walk must be long enough to defend.
  const dist = walkDistance(height, cols, rows, goal);
  for (const [x, y] of spawns) {
    const d = dist[y * cols + x];
    if (!Number.isFinite(d) || d < p.minPathTiles) return null;
  }
  return { cols, rows, height, spawns, goal, seed };
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

function raisePockets(h: Uint8Array, main: Uint8Array, cols: number, rows: number, minPocket: number): void {
  const seen = new Uint8Array(cols * rows);
  for (let i = 0; i < h.length; i++) {
    if (h[i] !== 0 || main[i] || seen[i]) continue;
    const pocket = floodZero(h, cols, rows, i);
    const tiles: number[] = [];
    for (let j = 0; j < pocket.length; j++) if (pocket[j]) { tiles.push(j); seen[j] = 1; }
    // Small pockets become low hills. Big ones stay as sunken fields: buildable, never walked.
    if (tiles.length < minPocket) for (const j of tiles) h[j] = 1;
  }
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

/** Text picture of a map for tests and debugging: digits are heights, S spawns, K the keep. Odd rows are indented. */
export function terrainToString(t: Terrain): string {
  const lines: string[] = [];
  for (let y = 0; y < t.rows; y++) {
    let line = y & 1 ? ' ' : '';
    for (let x = 0; x < t.cols; x++) {
      if (x > 0) line += ' ';
      if (t.spawns.some(([sx, sy]) => sx === x && sy === y)) line += 'S';
      else if (t.goal[0] === x && t.goal[1] === y) line += 'K';
      else line += t.height[y * t.cols + x] === 0 ? '.' : String(t.height[y * t.cols + x]);
    }
    lines.push(line);
  }
  return lines.join('\n');
}
