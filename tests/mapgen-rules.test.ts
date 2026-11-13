import { describe, expect, it } from 'vitest';
import { MAP_BALANCE, MapId, WORLD } from '../src/data/balance';
import { hexNeighbours } from '../src/sim/hex';
import { FEATURE, generateMap, terrainToString, walkDistance } from '../src/sim/mapgen';

const PRESETS = Object.keys(MAP_BALANCE) as MapId[];
const SEEDS = Array.from({ length: 15 }, (_, i) => i + 100);

describe('map generator extra rules', () => {
  it('uses the 24 x 14 board', () => {
    const t = generateMap('meadow', 1);
    expect(t.cols).toBe(WORLD.cols);
    expect(t.rows).toBe(WORLD.rows);
    expect(t.height).toHaveLength(24 * 14);
  });

  it('the keep sits on the right edge away from the corners; gates on the left', () => {
    for (const p of PRESETS) for (const seed of SEEDS) {
      const t = generateMap(p, seed);
      expect(t.goal[0]).toBe(t.cols - 1);
      expect(t.goal[1]).toBeGreaterThanOrEqual(2);
      expect(t.goal[1]).toBeLessThanOrEqual(t.rows - 3);
      for (const [x, y] of t.spawns) { expect(x).toBe(0); expect(t.height[y * t.cols + x]).toBe(0); }
      expect(t.height[t.goal[1] * t.cols + t.goal[0]]).toBe(0);
    }
  });

  it('canyon gates are in different halves of the board', () => {
    for (const seed of SEEDS) {
      const t = generateMap('canyon', seed);
      expect(t.spawns).toHaveLength(2);
      const [a, b] = t.spawns;
      expect(a[1]).toBeLessThan(t.rows / 2);
      expect(b[1]).toBeGreaterThan(t.rows / 2 - 1);
      expect(a[1]).toBeLessThan(b[1]);
    }
  });

  it('forest and rocks stay inside their height bands', () => {
    for (const p of PRESETS) {
      const g = MAP_BALANCE[p].gen;
      for (const seed of SEEDS) {
        const t = generateMap(p, seed);
        for (let i = 0; i < t.height.length; i++) {
          const h = t.height[i];
          if (t.feature[i] === FEATURE.forest) { expect(h).toBeGreaterThanOrEqual(Math.max(1, g.forest.heights[0])); expect(h).toBeLessThanOrEqual(g.forest.heights[1]); }
          if (t.feature[i] === FEATURE.rocks) { expect(h).toBeGreaterThanOrEqual(g.rocks.heights[0]); expect(h).toBeLessThanOrEqual(g.rocks.heights[1]); }
        }
      }
    }
  });

  it('every height from 1 to 4 appears on the highlands and canyon', () => {
    for (const p of ['highlands', 'canyon'] as const) {
      const seen = new Set<number>();
      for (const seed of SEEDS) for (const h of generateMap(p, seed).height) seen.add(h);
      for (const h of [0, 1, 2, 3, 4]) expect(seen.has(h), `${p} height ${h}`).toBe(true);
    }
  });

  it('the road has some room to build mazes: level-0 tiles with 3+ level-0 neighbours', () => {
    for (const seed of SEEDS) {
      const t = generateMap('meadow', seed);
      let roomy = 0;
      for (let y = 0; y < t.rows; y++) for (let x = 0; x < t.cols; x++) {
        if (t.height[y * t.cols + x] !== 0) continue;
        let n = 0;
        for (const [dx, dy] of hexNeighbours(y)) {
          const tx = x + dx; const ty = y + dy;
          if (tx >= 0 && ty >= 0 && tx < t.cols && ty < t.rows && t.height[ty * t.cols + tx] === 0) n++;
        }
        if (n >= 3) roomy++;
      }
      expect(roomy, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('the keep is reachable from every gate and the text picture marks them', () => {
    const t = generateMap('canyon', 7);
    const d = walkDistance(t.height, t.cols, t.rows, t.goal);
    for (const [x, y] of t.spawns) expect(Number.isFinite(d[y * t.cols + x])).toBe(true);
    const pic = terrainToString(t);
    expect(pic.split('\n')).toHaveLength(t.rows);
    expect(pic.match(/S/g)).toHaveLength(2);
    expect(pic.match(/K/g)).toHaveLength(1);
  });
});
