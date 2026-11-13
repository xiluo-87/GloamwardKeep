// Shared builders for the simulation tests. Not a test file itself.
import { HERO_IDS, HeroId, MapId, PerkId, TowerId } from '../src/data/balance';
import { build, upgrade } from '../src/sim/actions';
import { spawnAtGate } from '../src/sim/combat';
import { tileCenter } from '../src/sim/hex';
import { FEATURE } from '../src/sim/mapgen';
import { Enemy, GameEventType, RunState, createRun } from '../src/sim/state';
import { clearEvents, stepRun } from '../src/sim/step';
import { EnemyId } from '../src/data/balance';

export interface MkOpts { map?: MapId; mapSeed?: number; seed?: number; heroes?: HeroId[]; perks?: PerkId[]; gold?: number }

/** A fresh run with plenty of gold and every hero in the loadout, unless told otherwise. */
export function mk(o: MkOpts = {}): RunState {
  const s = createRun({
    seed: o.seed ?? 1, map: o.map ?? 'meadow', mapSeed: o.mapSeed ?? 3, heroes: o.heroes ?? [...HERO_IDS], perks: o.perks ?? [],
  });
  s.gold = o.gold ?? 5000;
  return s;
}

export const idx = (s: RunState, x: number, y: number): number => y * s.terrain.cols + x;

/** All free, buildable tiles matching a predicate on height. */
export function freeTiles(s: RunState, pred: (h: number) => boolean): [number, number][] {
  const { cols, rows, height, feature, goal, spawns } = s.terrain;
  const out: [number, number][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (s.occ[i] || feature[i] !== FEATURE.none || !pred(height[i])) continue;
      if ((goal[0] === x && goal[1] === y) || spawns.some(([sx, sy]) => sx === x && sy === y)) continue;
      out.push([x, y]);
    }
  }
  return out;
}

export const highTiles = (s: RunState, minH = 2): [number, number][] => freeTiles(s, (h) => h >= minH);
export const roadTiles = (s: RunState): [number, number][] => freeTiles(s, (h) => h === 0);

export function tilesWithFeature(s: RunState, f: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.terrain.feature.length; i++) if (s.terrain.feature[i] === f) out.push([i % s.terrain.cols, Math.floor(i / s.terrain.cols)]);
  return out;
}

/** Builds a tower and applies a list of upgrades (paths are 'tier', 'a' or 'b'). */
export function buildUp(s: RunState, type: TowerId, x: number, y: number, ups: ('tier' | 'a' | 'b')[] = []) {
  const t = build(s, type, x, y);
  if (!t) throw new Error(`could not build ${type} at ${x},${y}`);
  for (const p of ups) if (!upgrade(s, t.uid, p === 'tier' ? undefined : p)) throw new Error(`could not upgrade ${type} ${p}`);
  return t;
}

/** Puts a frozen enemy at a world position. Stunned enemies stay put but still count as targets. */
export function frozenEnemy(s: RunState, kind: EnemyId, x: number, y: number, wave = 1, gate = 0): Enemy {
  const e = spawnAtGate(s, kind, gate, wave);
  if (!e) throw new Error('enemy pool full');
  e.x = e.px = x; e.y = e.py = y;
  e.stunT = 1e9;
  return e;
}

/** A frozen enemy `dx` pixels to the right of a tile centre. */
export function frozenNear(s: RunState, kind: EnemyId, x: number, y: number, dx = 30, wave = 1): Enemy {
  const c = tileCenter(x, y);
  return frozenEnemy(s, kind, c.x + dx, c.y, wave);
}

export function stepSecs(s: RunState, secs: number): void {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) { stepRun(s); clearEvents(s); }
}

/** Steps until `done` is true or `maxSecs` pass; events are kept for the step that satisfied it. Returns whether it finished. */
export function stepUntil(s: RunState, done: () => boolean, maxSecs: number): boolean {
  for (let i = 0; i < maxSecs * 60; i++) {
    clearEvents(s);
    stepRun(s);
    if (done()) return true;
  }
  return false;
}

export function eventsOf(s: RunState, type: GameEventType) {
  return s.events.slice(0, s.eventCount).filter((e) => e.type === type);
}

export const liveEnemies = (s: RunState): Enemy[] => s.enemies.items.slice(0, s.enemies.count).filter((e) => !e.dead);
