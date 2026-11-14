import { describe, expect, it } from 'vitest';
import { MAP_BALANCE, type MapId } from '../src/data/balance';
import { hexDistance, hexNeighbours } from '../src/sim/hex';
import { DECORATION } from '../src/sim/decorations';
import { FEATURE, generateMap } from '../src/sim/mapgen';

const PRESETS = Object.keys(MAP_BALANCE) as MapId[];
const SEEDS = Array.from({ length: 13 }, (_, seed) => seed);

function hasBlankSameHeightRadiusOne(terrain: ReturnType<typeof generateMap>): boolean {
  for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++) {
    const disk: number[] = [];
    for (let otherRow = Math.max(0, row - 2); otherRow <= Math.min(terrain.rows - 1, row + 2); otherRow++) {
      for (let otherCol = Math.max(0, col - 2); otherCol <= Math.min(terrain.cols - 1, col + 2); otherCol++) {
        if (hexDistance(col, row, otherCol, otherRow) <= 1) disk.push(otherRow * terrain.cols + otherCol);
      }
    }
    if (disk.length !== 7) continue; // Only consider fully in-bounds hex disks.
    const height = terrain.height[row * terrain.cols + col];
    if (height === 0) continue;
    if (disk.every(index => terrain.height[index] === height
      && terrain.feature[index] === FEATURE.none
      && terrain.decoration[index] === DECORATION.none)) return true;
  }
  return false;
}

function assertMapRules(preset: MapId, seed: number): void {
  const terrain = generateMap(preset, seed);
  const repeat = generateMap(preset, seed);
  const generation = MAP_BALANCE[preset].gen;
  expect(Array.from(repeat.height)).toEqual(Array.from(terrain.height));
  expect(Array.from(repeat.feature)).toEqual(Array.from(terrain.feature));
  expect(Array.from(repeat.decoration)).toEqual(Array.from(terrain.decoration));

  let raised = 0;
  let buildable = 0;
  let eligibleForest = 0;
  let forestCount = 0;
  for (let index = 0; index < terrain.height.length; index++) {
    const height = terrain.height[index];
    const feature = terrain.feature[index];
    expect(height).toBeLessThanOrEqual(4);
    if (height > 0) {
      raised++;
      if (feature === FEATURE.none) buildable++;
    } else {
      expect(feature).toBe(FEATURE.none);
      expect(terrain.decoration[index]).toBe(DECORATION.none);
    }

    if (height >= Math.max(1, generation.forest.heights[0])
      && height <= generation.forest.heights[1]) eligibleForest++;
    if (feature === FEATURE.forest) {
      forestCount++;
      expect(height).toBeGreaterThanOrEqual(Math.max(1, generation.forest.heights[0]));
      expect(height).toBeLessThanOrEqual(generation.forest.heights[1]);
    } else if (feature === FEATURE.rocks) {
      expect(height).toBeGreaterThanOrEqual(generation.rocks.heights[0]);
      expect(height).toBeLessThanOrEqual(generation.rocks.heights[1]);
    }

    const col = index % terrain.cols;
    const row = Math.floor(index / terrain.cols);
    for (const [dx, dy] of hexNeighbours(row)) {
      const nextCol = col + dx, nextRow = row + dy;
      if (nextCol < 0 || nextRow < 0 || nextCol >= terrain.cols || nextRow >= terrain.rows) continue;
      const next = terrain.height[nextRow * terrain.cols + nextCol];
      expect(Math.abs(height - next)).toBeLessThanOrEqual(generation.maxStep);
    }
  }

  expect(forestCount).toBe(Math.round(eligibleForest * generation.forest.share));
  // Denser forest still leaves ample free high ground, in addition to buildable road tiles.
  expect(buildable, `${preset} seed ${seed} free raised tiles`).toBeGreaterThanOrEqual(Math.ceil(raised * 0.4));
  expect(hasBlankSameHeightRadiusOne(terrain), `${preset} seed ${seed}`).toBe(false);
}

describe('map terrain variety', () => {
  it('breaks large blank raised plateaus while retaining gameplay terrain rules', () => {
    assertMapRules('highlands', 5);
    for (const preset of PRESETS) for (const seed of SEEDS) assertMapRules(preset, seed);
  });
});
