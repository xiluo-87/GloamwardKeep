import { describe, expect, it } from 'vitest';
import { MAP_BALANCE, MapId } from '../src/data/balance';
import { hexDistance, hexNeighbours, pixelToTile, tileCenter } from '../src/sim/hex';
import { FEATURE, generateMap, routeReach, walkDistance } from '../src/sim/mapgen';

const PRESETS = Object.keys(MAP_BALANCE) as MapId[];
const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe('hex geometry', () => {
  it('neighbours are all at distance 1', () => {
    for (const row of [4, 5]) for (const [dc, dr] of hexNeighbours(row)) expect(hexDistance(6, row, 6 + dc, row + dr)).toBe(1);
  });
  it('pixelToTile inverts tileCenter', () => {
    for (let r = 0; r < 14; r++) for (let c = 0; c < 24; c++) {
      const p = tileCenter(c, r);
      expect(pixelToTile(p.x, p.y, 24, 14)).toEqual({ col: c, row: r });
    }
  });
});

describe('map generator', () => {
  for (const preset of PRESETS) {
    const gen = MAP_BALANCE[preset].gen;
    it(`${preset}: same seed gives the same map`, () => {
      const a = generateMap(preset, 42);
      const b = generateMap(preset, 42);
      expect(Array.from(a.height)).toEqual(Array.from(b.height));
      expect(Array.from(a.feature)).toEqual(Array.from(b.feature));
    });

    it(`${preset}: follows the generator rules on many seeds`, () => {
      for (const seed of SEEDS) {
        const t = generateMap(preset, seed);
        const dist = walkDistance(t.height, t.cols, t.rows, t.goal);
        // Heights in range; forest and rocks never on level 0.
        for (let i = 0; i < t.height.length; i++) {
          expect(t.height[i]).toBeLessThanOrEqual(4);
          if (t.height[i] === 0) expect(t.feature[i]).toBe(FEATURE.none);
          // Every level-0 tile is connected to the keep.
          if (t.height[i] === 0) expect(Number.isFinite(dist[i])).toBe(true);
        }
        // Neighbouring heights differ by at most maxStep.
        for (let y = 0; y < t.rows; y++) for (let x = 0; x < t.cols; x++) {
          for (const [dx, dy] of hexNeighbours(y)) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx < 0 || ty < 0 || tx >= t.cols || ty >= t.rows) continue;
            expect(Math.abs(t.height[y * t.cols + x] - t.height[ty * t.cols + tx])).toBeLessThanOrEqual(gen.maxStep);
          }
        }
        // Gates and keep on the edges, on level 0, with a long enough walk.
        expect(t.spawns).toHaveLength(gen.spawns);
        for (const [x, y] of t.spawns) {
          expect(x).toBe(0);
          expect(dist[y * t.cols + x]).toBeGreaterThanOrEqual(gen.minPathTiles);
        }
        expect(t.goal[0]).toBe(t.cols - 1);
        // The route passes within reach of at least minReach of the board.
        expect(routeReach(dist, t.cols, t.rows, t.spawns, gen.reachRadius)).toBeGreaterThanOrEqual(gen.minReach);
      }
    });
  }
});
