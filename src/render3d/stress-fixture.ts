/** Deterministic display-only load fixture for renderer profiling. */
import { ENEMIES, KEEP, type EnemyId, type MapId } from '../data/balance';
import { createDensityFixture, openRoutes } from '../camera-preview/fixture';
import { tileCenter } from '../sim/hex';
import { rebuildFlow } from '../sim/path';
import type { RunState } from '../sim/state';

export interface StressCounts { enemies: number; projectiles: number; pets: number; pools: number; towers: number }
export interface StressFixture { run: RunState; routes: number[][]; counts: StressCounts; enemyKind: 'mixed' | 'goblin' }

export const STRESS_CAPS: StressCounts = { enemies: 600, projectiles: 400, pets: 160, pools: 80, towers: 80 };
const MIXED: EnemyId[] = ['goblin', 'hexer', 'orc', 'stalker', 'bat', 'troll', 'wagon', 'shaman', 'ogreking', 'lich'];

function bounded(value: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.floor(Number.isFinite(value) ? value : 0)));
}

/** Build a real RunState populated to requested renderer stress counts without stepping combat. */
export function createStressFixture(options: {
  map?: MapId; seed?: number; counts?: Partial<StressCounts>; enemyKind?: 'mixed' | 'goblin'; archersOnly?: boolean;
} = {}): StressFixture {
  const map = options.map ?? 'meadow';
  const seed = Math.floor(options.seed ?? 0);
  const requested = { ...STRESS_CAPS, ...options.counts };
  const counts = {
    enemies: bounded(requested.enemies, STRESS_CAPS.enemies),
    projectiles: bounded(requested.projectiles, STRESS_CAPS.projectiles),
    pets: bounded(requested.pets, STRESS_CAPS.pets),
    pools: bounded(requested.pools, STRESS_CAPS.pools),
    towers: bounded(requested.towers, STRESS_CAPS.towers),
  };
  const density = createDensityFixture(map, seed, counts.towers, options.archersOnly);
  const run = density.run;
  run.gold = 1e9;
  run.keep = KEEP.max;
  // The readability fixture adds defensive palisades after its requested raised tower count.
  // Keep the benchmark's cap exact by releasing those extras from the rendering/game board.
  if (run.towers.length > counts.towers) {
    for (const tower of run.towers.splice(counts.towers)) run.occ[tower.ty * run.terrain.cols + tower.tx] = 0;
    rebuildFlow(run);
  }
  const routes = openRoutes(run).filter(route => route.length > 1);
  if (!routes.length) throw new Error(`No open display route on ${map} seed ${seed}.`);

  const positionAt = (index: number) => {
    const route = routes[index % routes.length];
    const tile = route[(index * 7) % route.length];
    const point = tileCenter(tile % run.terrain.cols, Math.floor(tile / run.terrain.cols));
    return { route, tile, point };
  };

  for (let i = 0; i < counts.enemies; i++) {
    const enemy = run.enemies.items[i];
    const { route, point } = positionAt(i);
    const routeStep = Math.floor((i * 7) % route.length);
    const def = ENEMIES[options.enemyKind === 'goblin' ? 'goblin' : MIXED[i % MIXED.length]];
    enemy.uid = 100_000 + i;
    enemy.def = def; enemy.wave = 30;
    enemy.x = enemy.px = point.x; enemy.y = enemy.py = point.y;
    enemy.vx = Math.cos(i * 1.7) * 15; enemy.vy = Math.sin(i * 1.3) * 15;
    enemy.ox = Math.sin(i * 0.19) * 5; enemy.oy = Math.cos(i * 0.23) * 3;
    enemy.next = route[Math.min(routeStep + 1, route.length - 1)]; enemy.flowVersion = run.flowVersion;
    enemy.dist = route.length - routeStep; enemy.hp = enemy.maxHp = def.hp * 10; enemy.shield = 0;
    enemy.speed = def.speed; enemy.slow = enemy.slowT = enemy.stunT = enemy.burnDps = enemy.burnT = enemy.shred = 0;
    enemy.flash = 0; enemy.dead = enemy.revealed = false; enemy.smashing = 0;
    enemy.cdA = enemy.cdB = 0; enemy.nextShed = 1;
  }
  run.enemies.count = counts.enemies;
  run.nextUid = 100_000 + counts.enemies;

  const owner = run.towers[0] ?? null;
  const validEnemies = run.enemies.items.slice(0, counts.enemies);
  for (let i = 0; i < counts.projectiles; i++) {
    const p = run.projectiles.items[i];
    const { point } = positionAt(i * 3);
    const targetEnemy = validEnemies[i % Math.max(1, validEnemies.length)] ?? null;
    p.kind = i % 4 === 0 ? 'lob' : 'bolt';
    p.x = p.px = point.x; p.y = p.py = point.y + 8;
    p.sx = point.x - 8; p.sy = point.y - 8; p.tx = point.x + 15; p.ty = point.y + 4;
    p.t = 0.1; p.life = 1; p.target = targetEnemy; p.targetUid = targetEnemy?.uid ?? 0;
    p.owner = owner; p.damage = 1;
  }
  run.projectiles.count = counts.projectiles;

  for (let i = 0; i < counts.pets; i++) {
    const pet = run.pets.items[i];
    const { point } = positionAt(i * 5);
    const targetEnemy = validEnemies[i % Math.max(1, validEnemies.length)] ?? null;
    pet.owner = run.towers[i % Math.max(1, run.towers.length)] ?? null;
    pet.x = pet.px = point.x + 5; pet.y = pet.py = point.y + 10;
    pet.target = targetEnemy; pet.targetUid = targetEnemy?.uid ?? 0;
    pet.cd = 0; pet.phase = i * 0.13; pet.life = 999; pet.temp = false;
  }
  run.pets.count = counts.pets;

  for (let i = 0; i < counts.pools; i++) {
    const pool = run.pools.items[i];
    const { point } = positionAt(i * 11);
    pool.x = point.x; pool.y = point.y; pool.r = 8 + i % 6;
    pool.t = 0; pool.life = 1000; pool.dps = 0; pool.owner = owner;
  }
  run.pools.count = counts.pools;
  // Counts are harness-only; events/UIDs and gameplay RNG are not advanced by stepping combat.
  run.eventCount = 0;
  return { run, routes, counts, enemyKind: options.enemyKind ?? 'mixed' };
}

/** Move only fixture entity coordinates along precomputed open routes for visual animation. */
export function moveStressFixture(fixture: StressFixture, elapsed: number): void {
  const s = fixture.run;
  // This is a visual clock only; no simulation step, random roll, combat event, or save is run.
  s.t = elapsed;
  for (let i = 0; i < s.enemies.count; i++) {
    const enemy = s.enemies.items[i];
    const route = fixture.routes[i % fixture.routes.length];
    const phase = elapsed * 0.7 + i / Math.max(1, s.enemies.count) * (route.length - 1);
    // Respawn at the start after reaching the keep; never slide across the whole map.
    const at = Math.floor(phase) % (route.length - 1);
    const next = at + 1;
    const blend = phase - Math.floor(phase);
    const a = tileCenter(route[at] % s.terrain.cols, Math.floor(route[at] / s.terrain.cols));
    const b = tileCenter(route[next] % s.terrain.cols, Math.floor(route[next] / s.terrain.cols));
    enemy.px = enemy.x; enemy.py = enemy.y;
    enemy.x = a.x + (b.x - a.x) * blend; enemy.y = a.y + (b.y - a.y) * blend;
    enemy.vx = (b.x - a.x) * 0.7; enemy.vy = (b.y - a.y) * 0.7;
  }
}
