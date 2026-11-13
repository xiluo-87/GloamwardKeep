import { describe, expect, it } from 'vitest';
import { build, canBuild, destroyTower, sell } from '../src/sim/actions';
import { buildCost } from '../src/sim/stats';
import { FEATURE } from '../src/sim/mapgen';
import { tileCenter } from '../src/sim/hex';
import { frozenEnemy, highTiles, mk, roadTiles, tilesWithFeature } from './helpers';

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
