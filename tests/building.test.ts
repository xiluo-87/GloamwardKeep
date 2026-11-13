import { describe, expect, it } from 'vitest';
import { CLEAR } from '../src/data/balance';
import { build, canBuild, canClear, clearCost, clearTile, destroyTower, sell } from '../src/sim/actions';
import { buildCost } from '../src/sim/stats';
import { FEATURE } from '../src/sim/mapgen';
import { tileCenter } from '../src/sim/hex';
import { eventsOf, frozenEnemy, highTiles, mk, roadTiles, tilesWithFeature } from './helpers';

describe('canBuild', () => {
  it('allows a tower on open ground', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    expect(canBuild(s, 'archer', x, y)).toBe('ok');
  });

  it('reports offBoard', () => {
    const s = mk();
    expect(canBuild(s, 'archer', -1, 0)).toBe('offBoard');
    expect(canBuild(s, 'archer', 0, 99)).toBe('offBoard');
  });

  it('forest and rocks are blocked', () => {
    const s = mk();
    const forest = tilesWithFeature(s, FEATURE.forest);
    expect(forest.length).toBeGreaterThan(0);
    expect(canBuild(s, 'archer', forest[0][0], forest[0][1])).toBe('blocked');
    const rocks = tilesWithFeature(s, FEATURE.rocks);
    if (rocks.length > 0) expect(canBuild(s, 'archer', rocks[0][0], rocks[0][1])).toBe('blocked');
  });

  it('the gate and the keep are off limits', () => {
    const s = mk();
    const { goal, spawns } = s.terrain;
    expect(canBuild(s, 'palisade', goal[0], goal[1])).toBe('gate');
    for (const [x, y] of spawns) expect(canBuild(s, 'palisade', x, y)).toBe('gate');
  });

  it('occupied tiles are refused', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    build(s, 'archer', x, y);
    expect(canBuild(s, 'archer', x, y)).toBe('occupied');
    expect(build(s, 'archer', x, y)).toBeNull();
  });

  it('needs enough gold, and building spends exactly the price', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    s.gold = buildCost('archer', s.mods) - 1;
    expect(canBuild(s, 'archer', x, y)).toBe('gold');
    s.gold = buildCost('archer', s.mods);
    expect(build(s, 'archer', x, y)).not.toBeNull();
    expect(s.gold).toBe(0);
  });

  it('an enemy standing on a road tile blocks building there, but not on hills', () => {
    const s = mk();
    const [rx, ry] = roadTiles(s)[3];
    const c = tileCenter(rx, ry);
    const e = frozenEnemy(s, 'goblin', c.x, c.y);
    expect(canBuild(s, 'palisade', rx, ry)).toBe('enemy');
    const [hx, hy] = highTiles(s)[0];
    const h = tileCenter(hx, hy);
    e.x = h.x; e.y = h.y;
    expect(canBuild(s, 'archer', hx, hy)).toBe('ok');
    e.x = c.x; e.y = c.y;
    e.dead = true;
    expect(canBuild(s, 'palisade', rx, ry)).toBe('ok');
  });

  it('nothing can be built after the run ends', () => {
    const s = mk();
    s.outcome = 'lost';
    const [x, y] = highTiles(s)[0];
    expect(canBuild(s, 'archer', x, y)).toBe('over');
  });
});

describe('heroes', () => {
  it('only heroes in the loadout can be placed', () => {
    const s = mk({ heroes: ['knight'] });
    const [x, y] = highTiles(s)[0];
    expect(canBuild(s, 'cleric', x, y)).toBe('heroNotInLoadout');
    expect(canBuild(s, 'knight', x, y)).toBe('ok');
  });

  it('one at a time; a sold hero can be placed again', () => {
    const s = mk();
    const tiles = highTiles(s);
    const k = build(s, 'knight', tiles[0][0], tiles[0][1])!;
    expect(canBuild(s, 'knight', tiles[1][0], tiles[1][1])).toBe('heroTaken');
    expect(s.heroesPlaced).toEqual(['knight']);
    sell(s, k.uid);
    expect(s.heroesPlaced).toEqual([]);
    expect(canBuild(s, 'knight', tiles[1][0], tiles[1][1])).toBe('ok');
  });

  it('a destroyed hero can be placed again', () => {
    const s = mk();
    const tiles = highTiles(s);
    const k = build(s, 'cleric', tiles[0][0], tiles[0][1])!;
    destroyTower(s, k);
    expect(s.heroesPlaced).toEqual([]);
    expect(build(s, 'cleric', tiles[0][0], tiles[0][1])).not.toBeNull();
  });

  it('a hero costs gold and has an ability on a short starting delay', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const g = s.gold;
    const k = build(s, 'knight', x, y)!;
    expect(s.gold).toBe(g - buildCost('knight', s.mods));
    expect(k.hero).toBe(true);
    expect(k.abilityCd).toBeGreaterThan(0);
    expect(k.abilityCd).toBeLessThanOrEqual(10);
  });
});

describe('clearing forest and rocks', () => {
  const first = (s: ReturnType<typeof mk>, f: number) => tilesWithFeature(s, f)[0];

  it('costs base x (1 + perHeight x height), rounded', () => {
    const s = mk();
    for (const [f, base] of [[FEATURE.forest, CLEAR.forest], [FEATURE.rocks, CLEAR.rocks]] as const) {
      const tile = first(s, f);
      if (!tile) continue;
      const h = s.terrain.height[tile[1] * s.terrain.cols + tile[0]];
      expect(clearCost(s, tile[0], tile[1])).toBe(Math.round(base * (1 + CLEAR.perHeight * h)));
    }
  });

  it('rocks cost more than forest at the same height, and cost grows with height', () => {
    expect(CLEAR.rocks).toBeGreaterThan(CLEAR.forest);
    expect(CLEAR.perHeight).toBeGreaterThan(0);
  });

  it('thrift lowers the price', () => {
    const plain = mk();
    const thrifty = mk({ perks: ['thrift'] });
    const [x, y] = first(plain, FEATURE.forest);
    expect(clearCost(thrifty, x, y)).toBeLessThan(clearCost(plain, x, y));
    expect(clearCost(thrifty, x, y)).toBe(Math.round(clearCost(plain, x, y) * 0.92 + 0) === clearCost(thrifty, x, y)
      ? clearCost(thrifty, x, y)
      : -1);
  });

  it('deducts gold, makes the tile buildable and emits an event', () => {
    const s = mk();
    const [x, y] = first(s, FEATURE.forest);
    const cost = clearCost(s, x, y);
    const g = s.gold;
    const v = s.terrainVersion;
    expect(canBuild(s, 'archer', x, y)).toBe('blocked');
    expect(clearTile(s, x, y)).toBe(true);
    expect(s.gold).toBe(g - cost);
    expect(s.terrainVersion).toBe(v + 1);
    expect(eventsOf(s, 'clear')).toHaveLength(1);
    expect(s.terrain.feature[y * s.terrain.cols + x]).toBe(FEATURE.none);
    expect(canBuild(s, 'archer', x, y)).toBe('ok');
    expect(build(s, 'archer', x, y)).not.toBeNull();
  });

  it('cannot clear twice, bare ground, or without gold', () => {
    const s = mk();
    const [x, y] = first(s, FEATURE.forest);
    s.gold = clearCost(s, x, y) - 1;
    expect(canClear(s, x, y)).toBe('gold');
    expect(clearTile(s, x, y)).toBe(false);
    expect(s.terrain.feature[y * s.terrain.cols + x]).toBe(FEATURE.forest);
    s.gold = 5000;
    expect(clearTile(s, x, y)).toBe(true);
    expect(canClear(s, x, y)).toBe('nothing');
    expect(clearTile(s, x, y)).toBe(false);
    const [bx, by] = highTiles(s)[0];
    expect(clearCost(s, bx, by)).toBe(0);
    expect(clearTile(s, bx, by)).toBe(false);
    expect(clearCost(s, -1, 0)).toBe(0);
  });

  it('is refused after the run ends', () => {
    const s = mk();
    const [x, y] = first(s, FEATURE.forest);
    s.outcome = 'lost';
    expect(canClear(s, x, y)).toBe('over');
  });
});
