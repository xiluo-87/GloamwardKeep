import { describe, expect, it } from 'vitest';
import { ENEMIES, PATHING, TOWERS } from '../src/data/balance';
import { build, sell, upgrade } from '../src/sim/actions';
import { spawnAtGate } from '../src/sim/combat';
import { hexNeighbours, tileCenter } from '../src/sim/hex';
import { rebuildFlow, routeOpen } from '../src/sim/path';
import { RunState } from '../src/sim/state';
import { buildUp, eventsOf, highTiles, idx, mk, roadTiles, stepSecs, stepUntil } from './helpers';

/** Level-0 neighbours of the first gate: a complete cut across every route. */
function gateNeighbours(s: RunState, gate = 0): [number, number][] {
  const [gx, gy] = s.terrain.spawns[gate];
  const out: [number, number][] = [];
  for (const [dx, dy] of hexNeighbours(gy)) {
    const x = gx + dx;
    const y = gy + dy;
    if (x < 0 || y < 0 || x >= s.terrain.cols || y >= s.terrain.rows) continue;
    if (s.terrain.height[idx(s, x, y)] === 0) out.push([x, y]);
  }
  return out;
}

/** Seals the road right after the gate and returns the walls. */
function seal(s: RunState) {
  return gateNeighbours(s).map(([x, y]) => build(s, 'palisade', x, y)!);
}

describe('flow field', () => {
  it('is 0 at the keep, finite on the road, Infinity off it', () => {
    const s = mk();
    const { goal, height, cols, spawns } = s.terrain;
    expect(s.flow[idx(s, goal[0], goal[1])]).toBe(0);
    for (const [x, y] of spawns) expect(Number.isFinite(s.flow[idx(s, x, y)])).toBe(true);
    let road = 0;
    let off = 0;
    for (let i = 0; i < height.length; i++) {
      if (height[i] === 0) { road++; expect(Number.isFinite(s.flow[i])).toBe(true); } else { off++; expect(s.flow[i]).toBe(Infinity); }
    }
    expect(road).toBeGreaterThan(20);
    expect(off).toBeGreaterThan(0);
    expect(cols).toBe(24);
  });

  it('rebuildFlow bumps the version and is repeatable', () => {
    const s = mk();
    const copy = Array.from(s.flow);
    const v = s.flowVersion;
    rebuildFlow(s);
    expect(s.flowVersion).toBe(v + 1);
    expect(Array.from(s.flow)).toEqual(copy);
  });

  it('a tower on the road that is not the only route changes routes but leaves the route open', () => {
    const s = mk();
    const [gx, gy] = s.terrain.spawns[0];
    const before = s.flow[idx(s, gx, gy)];
    // Find a road tile whose wall lengthens the walk without sealing it (a shortcut gap tile).
    let found: [number, number] | null = null;
    for (const gap of s.terrain.gaps) {
      for (const i of gap) {
        const x = i % s.terrain.cols;
        const y = Math.floor(i / s.terrain.cols);
        const t = build(s, 'palisade', x, y);
        if (!t) continue;
        if (routeOpen(s) && s.flow[idx(s, gx, gy)] > before) { found = [x, y]; break; }
        sell(s, t.uid);
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    expect(routeOpen(s)).toBe(true);
    expect(s.flow[idx(s, gx, gy)]).toBeLessThan(PATHING.towerCost);
  });

  it('sealing every route closes the route; selling reopens it', () => {
    const s = mk();
    expect(routeOpen(s)).toBe(true);
    const walls = seal(s);
    expect(walls.length).toBeGreaterThan(0);
    expect(routeOpen(s)).toBe(false);
    sell(s, walls[0].uid);
    if (walls.length === 1) expect(routeOpen(s)).toBe(true);
    for (const w of walls.slice(1)) sell(s, w.uid);
    expect(routeOpen(s)).toBe(true);
  });

  it('hill towers never change the flow field', () => {
    const s = mk();
    const copy = Array.from(s.flow);
    const [x, y] = highTiles(s)[0];
    build(s, 'archer', x, y);
    expect(Array.from(s.flow)).toEqual(copy);
  });
});

describe('smashing', () => {
  /** Seals the gate, spawns a durable goblin and steps until it starts smashing. */
  function smashSetup() {
    const s = mk();
    const walls = seal(s);
    // Walls shouldn't shoot the attacker, so the damage they take is only the smashing.
    for (const w of walls) w.cd = 1e9;
    const e = spawnAtGate(s, 'goblin', 0, 1)!;
    e.hp = e.maxHp = 1e7;
    const ok = stepUntil(s, () => e.smashing !== 0, 20);
    expect(ok).toBe(true);
    return { s, walls, e };
  }

  it('enemies walk to the blocking tower and chew through it at about attack x time', () => {
    const { s, walls, e } = smashSetup();
    const target = walls.find((w) => w.uid === e.smashing)!;
    expect(target).toBeTruthy();
    const hp0 = target.hp;
    stepSecs(s, 3);
    const lost = hp0 - target.hp;
    expect(lost).toBeGreaterThan(ENEMIES.goblin.attack * 3 * 0.9);
    expect(lost).toBeLessThan(ENEMIES.goblin.attack * 3 * 1.1 + 1);
  });

  it('a destroyed tower emits an event, frees the tile, reopens the route and the enemy walks on', () => {
    const { s, walls, e } = smashSetup();
    const target = walls.find((w) => w.uid === e.smashing)!;
    target.hp = 3;
    const v = s.flowVersion;
    let destroyedEvents = 0;
    const ok = stepUntil(s, () => { destroyedEvents += eventsOf(s, 'destroyed').length; return s.towers.indexOf(target) < 0; }, 5);
    expect(ok).toBe(true);
    expect(destroyedEvents).toBeGreaterThan(0);
    expect(s.occ[idx(s, target.tx, target.ty)]).toBe(0);
    expect(s.flowVersion).toBeGreaterThan(v);
    const remaining = walls.filter((w) => w !== target);
    if (remaining.length === 0) expect(routeOpen(s)).toBe(true);
    // The goblin now walks on instead of smashing in place.
    const x0 = e.x;
    const y0 = e.y;
    stepSecs(s, 2);
    expect(Math.hypot(e.x - x0, e.y - y0)).toBeGreaterThan(20);
  });

  it('spiked walls hurt the enemy that smashes them', () => {
    const s = mk();
    const walls = seal(s);
    // Upgrade every wall to the Spiked fork (needs both tiers first).
    for (const w of walls) {
      upgrade(s, w.uid); upgrade(s, w.uid); upgrade(s, w.uid, 'a');
      expect(w.stats.thorns).toBe(TOWERS.palisade.forks.a[0].add.thorns);
      w.cd = 1e9;
    }
    const e = spawnAtGate(s, 'goblin', 0, 1)!;
    e.hp = e.maxHp = 1e7;
    expect(stepUntil(s, () => e.smashing !== 0, 20)).toBe(true);
    const hp0 = e.hp;
    stepSecs(s, 2);
    // Thorns hit once per smashing step; physical, goblins have no armour.
    expect(hp0 - e.hp).toBeGreaterThan(TOWERS.palisade.forks.a[0].add.thorns! * 2 * 0.9);
  });

  it('stronger walls last longer', () => {
    const s = mk();
    const plain = build(s, 'palisade', ...roadTiles(s)[0])!;
    const [x, y] = roadTiles(s)[10];
    const stone = buildUp(s, 'palisade', x, y, ['tier', 'tier']);
    expect(stone.maxHp).toBeGreaterThan(plain.maxHp * 5);
  });

  it('towers repair to full when a wave is cleared', async () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    t.hp = 1;
    const e = spawnAtGate(s, 'goblin', 0, 1)!;
    const { hurt } = await import('../src/sim/combat');
    hurt(s, e, 1e6, 'physical', null);
    stepSecs(s, 0.1);
    expect(t.hp).toBe(t.maxHp);
  });

  it('flyers ignore walls and fly straight to the keep', () => {
    const s = mk();
    seal(s);
    const bat = spawnAtGate(s, 'bat', 0, 1)!;
    const g = tileCenter(s.terrain.goal[0], s.terrain.goal[1]);
    let last = Math.hypot(bat.x - g.x, bat.y - g.y);
    for (let i = 0; i < 60 * 30 && !bat.dead; i++) {
      stepSecs(s, 1 / 60);
      if (bat.dead) break;
      const d = Math.hypot(bat.x - g.x, bat.y - g.y);
      expect(d).toBeLessThan(last);
      last = d;
    }
    expect(bat.dead).toBe(true);
    expect(s.lives).toBe(s.mods.lives - ENEMIES.bat.lives);
  });
});
