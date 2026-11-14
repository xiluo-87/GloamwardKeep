import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/data/balance';
import { hexNeighbours, tileCenter, pixelToTile } from '../src/sim/hex';
import { generateMap, type Terrain } from '../src/sim/mapgen';
import { groundHeightAt, SURFACE_MAX_OFFSET, visualTileHeight } from '../src/camera-preview/surface';
import { TERRAIN_RISE } from '../src/camera-preview/terrain';

function neighborsWithin(terrain: Terrain, col: number, row: number, radius: number): number[] {
  const center = tileCenter(col, row);
  const out: number[] = [];
  for (let z = Math.max(0, row - 3); z <= Math.min(terrain.rows - 1, row + 3); z++) {
    for (let x = Math.max(0, col - 3); x <= Math.min(terrain.cols - 1, col + 3); x++) {
      const p = tileCenter(x, z);
      if (Math.hypot(p.x - center.x, p.y - center.y) <= radius * WORLD.hex) out.push(z * terrain.cols + x);
    }
  }
  return out;
}

describe('visual terrain surface sampling', () => {
  for (const map of ['meadow', 'highlands', 'canyon'] as const) {
    it(`${map}: stays deterministic, bounded, and separate from logical map data`, () => {
      const terrain = generateMap(map, 5);
      const duplicate = generateMap(map, 5);
      const logical = {
        height: Array.from(terrain.height), feature: Array.from(terrain.feature), decoration: Array.from(terrain.decoration),
        spawns: JSON.stringify(terrain.spawns), goal: JSON.stringify(terrain.goal), gaps: JSON.stringify(terrain.gaps), seed: terrain.seed,
      };
      const samples = Array.from(terrain.height, (_, index) => visualTileHeight(terrain, index));
      expect(samples).toEqual(Array.from(duplicate.height, (_, index) => visualTileHeight(duplicate, index)));
      for (let index = 0; index < samples.length; index++) {
        const level = terrain.height[index];
        expect(Number.isFinite(samples[index])).toBe(true);
        expect(Math.abs(samples[index] - level * TERRAIN_RISE)).toBeLessThanOrEqual(SURFACE_MAX_OFFSET);
        const center = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
        expect(groundHeightAt(terrain, center.x / WORLD.hex, center.y / WORLD.hex)).toBeCloseTo(samples[index], 6);
      }
      expect(Array.from(terrain.height)).toEqual(logical.height);
      expect(Array.from(terrain.feature)).toEqual(logical.feature);
      expect(Array.from(terrain.decoration)).toEqual(logical.decoration);
      expect(JSON.stringify(terrain.spawns)).toBe(logical.spawns);
      expect(JSON.stringify(terrain.goal)).toBe(logical.goal);
      expect(JSON.stringify(terrain.gaps)).toBe(logical.gaps);
      expect(terrain.seed).toBe(logical.seed);
    });
  }

  it('adds coherent intermediate ledges on raised tiles while keeping the road nearly flat', () => {
    const terrain = generateMap('highlands', 3219769271);
    let raisedVariation = false;
    for (let index = 0; index < terrain.height.length && !raisedVariation; index++) {
      if (!terrain.height[index]) continue;
      const col = index % terrain.cols, row = Math.floor(index / terrain.cols);
      const center = tileCenter(col, row);
      const values = new Set<number>();
      for (let dz = -0.56; dz <= 0.56; dz += 0.14) for (let dx = -0.56; dx <= 0.56; dx += 0.14) {
        const x = center.x / WORLD.hex + dx, z = center.y / WORLD.hex + dz;
        const tile = pixelToTile(x * WORLD.hex, z * WORLD.hex, terrain.cols, terrain.rows);
        if (!tile || tile.col !== col || tile.row !== row) continue;
        values.add(Math.round(groundHeightAt(terrain, x, z) * 10000));
      }
      raisedVariation = values.size >= 2;
    }
    expect(raisedVariation).toBe(true);

    const road = terrain.height.findIndex(level => level === 0);
    expect(road).toBeGreaterThanOrEqual(0);
    const roadCol = road % terrain.cols, roadRow = Math.floor(road / terrain.cols);
    const adjacentRoad = hexNeighbours(roadRow).map(([dx, dz]) => [roadCol + dx, roadRow + dz] as const)
      .find(([col, row]) => col >= 0 && row >= 0 && col < terrain.cols && row < terrain.rows
        && terrain.height[row * terrain.cols + col] === 0);
    expect(adjacentRoad).toBeDefined();
    const from = tileCenter(roadCol, roadRow), to = tileCenter(adjacentRoad![0], adjacentRoad![1]);
    for (let step = 0; step <= 10; step++) {
      const mix = step / 10;
      expect(Math.abs(groundHeightAt(terrain, (from.x + (to.x - from.x) * mix) / WORLD.hex,
        (from.y + (to.y - from.y) * mix) / WORLD.hex))).toBeLessThanOrEqual(0.003);
    }
    for (const index of neighborsWithin(terrain, road % terrain.cols, Math.floor(road / terrain.cols), 2)) {
      if (terrain.height[index] !== 0) continue;
      expect(visualTileHeight(terrain, index)).toBe(0);
    }
  });
});
