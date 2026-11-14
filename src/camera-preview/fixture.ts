// A deterministic readability fixture built through real game actions. It is not a combat run.
import { KEEP, type MapId, type TowerId } from '../data/balance';
import { build, canBuild, clearTile, upgrade } from '../sim/actions';
import { hexNeighbours, hexDistance, tileCenter } from '../sim/hex';
import { FEATURE } from '../sim/mapgen';
import { createRun, type RunState, type Tower } from '../sim/state';

const TYPES: TowerId[] = ['archer', 'catapult', 'mage', 'lightning', 'aviary', 'frost', 'shrine'];
export interface DensityFixture {
  run: RunState;
  routes: number[][];
  towerCount: number;
  wallCount: number;
  cleared: number;
}

export interface ArtFixture extends DensityFixture {
  sampleTowerUid: number;
  sampleRoute: number[];
}

/** Open level-0 routes, excluding every occupied tile and an optional proposed blocker. */
export function openRoutes(s: RunState, blocked = -1): number[][] {
  const { cols, rows, height, goal, spawns } = s.terrain;
  const target = goal[1] * cols + goal[0];
  const next = new Int32Array(height.length).fill(-1);
  const queue = [target];
  next[target] = target;
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q];
    const col = at % cols;
    const row = Math.floor(at / cols);
    for (const [dx, dy] of hexNeighbours(row)) {
      const x = col + dx;
      const y = row + dy;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const i = y * cols + x;
      if (height[i] || s.occ[i] || i === blocked || next[i] !== -1) continue;
      next[i] = at;
      queue.push(i);
    }
  }
  return spawns.map(([col, row]) => {
    let at = row * cols + col;
    const route: number[] = [];
    if (next[at] === -1) return route;
    while (at !== target) { route.push(at); at = next[at]; }
    route.push(target);
    return route;
  });
}

const noise = (index: number, seed: number): number => ((Math.imul(index + 1, 1664525) ^ seed) >>> 0) / 0x100000000;

function dressTower(s: RunState, tower: Tower, index: number): void {
  const steps = 1 + index % 5;
  for (let n = 0; n < steps; n++) upgrade(s, tower.uid, index % 2 ? 'a' : 'b');
}

export function createDensityFixture(map: MapId, seed: number, requested: number, archersOnly = false): DensityFixture {
  const s = createRun({ map, mapSeed: seed, seed: 1, heroes: [], perks: [] });
  // Fixture budget/unlocks allow a late-game layout without changing game balance or saves.
  s.gold = 1e9;
  s.keep = KEEP.max;
  const count = Math.max(0, Math.min(80, Math.floor(Number.isFinite(requested) ? requested : 40)));
  const { cols, rows, height, feature, goal } = s.terrain;
  const sites: { index: number; score: number }[] = [];
  const road = Array.from(height.keys()).filter((i) => height[i] === 0);
  for (let i = 0; i < height.length; i++) {
    if (height[i] === 0) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    let distance = Infinity;
    for (const j of road) distance = Math.min(distance, Math.hypot(x - j % cols, y - Math.floor(j / cols)));
    sites.push({ index: i, score: distance * 4 + (feature[i] ? 0.5 : 0) + noise(i, seed) * 3 });
  }
  sites.sort((a, b) => a.score - b.score || a.index - b.index);
  let towerCount = 0;
  let cleared = 0;
  for (const { index } of sites) {
    if (towerCount >= count) break;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const type = archersOnly ? 'archer' : TYPES[towerCount % TYPES.length];
    if (feature[index] !== FEATURE.none && clearTile(s, col, row)) cleared++;
    if (canBuild(s, type, col, row) !== 'ok') continue;
    const tower = build(s, type, col, row);
    if (!tower) continue;
    if (archersOnly) {
      const state = towerCount % 7;
      const steps = [0, 1, 2, 3, 4, 3, 4][state];
      for (let n = 0; n < steps; n++) upgrade(s, tower.uid, state < 5 ? 'a' : 'b');
    } else dressTower(s, tower, towerCount);
    towerCount++;
  }

  const wallTarget = archersOnly ? 0 : Math.min(16, Math.floor(count / 4));
  const wallSites = road.filter((i) => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    return x > 1 && x < cols - 2 && y > 0 && y < rows - 1 && !(x === goal[0] && y === goal[1]);
  }).sort((a, b) => noise(a, seed ^ 0x4567) - noise(b, seed ^ 0x4567));
  let wallCount = 0;
  for (const i of wallSites) {
    if (wallCount >= wallTarget) break;
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (canBuild(s, 'palisade', col, row) !== 'ok' || openRoutes(s, i).some((route) => route.length === 0)) continue;
    const wall = build(s, 'palisade', col, row);
    if (!wall) continue;
    if (wallCount % 2) upgrade(s, wall.uid);
    wallCount++;
  }
  return { run: s, routes: openRoutes(s), towerCount, wallCount, cleared };
}

/** One legally placed archer beside an open goblin route, for art previews only. */
export function createArtFixture(map: MapId, seed: number): ArtFixture {
  const s = createRun({ map, mapSeed: seed, seed: 1, heroes: [], perks: [] });
  s.gold = 1e9;
  s.keep = KEEP.max;
  const { cols, rows, height } = s.terrain;
  const routes = openRoutes(s);
  const cx = cols / 2;
  const cy = rows / 2;
  const candidates: { index: number; route: number[]; routeAt: number; score: number }[] = [];

  for (const route of routes) {
    for (let at = 0; at < route.length; at++) {
      const roadIndex = route[at];
      const road = tileCenter(roadIndex % cols, Math.floor(roadIndex / cols));
      for (let index = 0; index < height.length; index++) {
        if (height[index] === 0) continue;
        const col = index % cols;
        const row = Math.floor(index / cols);
        if (s.occ[index] || (s.terrain.goal[0] === col && s.terrain.goal[1] === row) || s.terrain.spawns.some(([x, y]) => x === col && y === row)) continue;
        const tower = tileCenter(col, row);
        const hexGap = hexDistance(col, row, roadIndex % cols, Math.floor(roadIndex / cols));
        if (hexGap > 2) continue;
        const southeast = road.x > tower.x && road.y > tower.y;
        const centerPenalty = Math.hypot(col - cx, row - cy);
        const preference = (southeast ? 1000 : 0) + (height[index] === 1 ? 100 : 0);
        candidates.push({ index, route, routeAt: at, score: centerPenalty * 4 + hexGap * 10 + Math.hypot(road.x - tower.x, road.y - tower.y) / 100 - preference });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.index - b.index || a.routeAt - b.routeAt);

  for (const candidate of candidates) {
    const col = candidate.index % cols;
    const row = Math.floor(candidate.index / cols);
    let cleared = 0;
    const check = canBuild(s, 'archer', col, row);
    if (check === 'blocked' && s.terrain.feature[candidate.index] !== FEATURE.none) {
      // Raised, non-gate, unoccupied sites are otherwise buildable, so clearing
      // this selected candidate is the only terrain mutation the fixture makes.
      if (!clearTile(s, col, row)) continue;
      cleared = 1;
    } else if (check !== 'ok') continue;
    if (canBuild(s, 'archer', col, row) !== 'ok') throw new Error('Selected art fixture site was not buildable after clearing');
    const tower = build(s, 'archer', col, row);
    if (!tower) continue;
    const start = Math.max(0, candidate.routeAt - 1);
    const sampleRoute = candidate.route.slice(start, Math.min(candidate.route.length, start + 3));
    return { run: s, routes, towerCount: 1, wallCount: 0, cleared, sampleTowerUid: tower.uid, sampleRoute };
  }
  throw new Error(`No legal raised archer site beside an open route for ${map} seed ${seed}`);
}
