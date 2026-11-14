import { WORLD } from '../data/balance';
import { pixelToTile, tileCenter } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';

/** Visual spacing between logical terrain levels. Simulation height values stay integer 0..4. */
export const TERRAIN_RISE = 0.42;
export const SURFACE_CELL = 0.14;
/** Highest absolute offset from the nominal `logicalHeight * TERRAIN_RISE` surface. */
export const SURFACE_MAX_OFFSET = 0.026;

function hash(seed: number, x: number, z: number): number {
  let value = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function levelOffset(terrain: Terrain, index: number): number {
  const level = terrain.height[index];
  if (level === 0) return 0; // Keep the enemy road visually smooth and level.
  return ((hash(terrain.seed, index, level) % 5) - 2) * 0.006;
}

/** Stable, gently varied center height for a tile; the logical map remains unchanged. */
export function visualTileHeight(terrain: Terrain, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= terrain.height.length) return 0;
  return terrain.height[index] * TERRAIN_RISE + levelOffset(terrain, index);
}

function smoothstep(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Shared visual surface sampler for terrain rasterization and moving actors. It returns the height
 * of the world-aligned voxel cell containing (sceneX, sceneZ). Cell groups form low, coherent
 * ledges on raised land; the variation fades to zero close to tile centers and has much lower
 * amplitude on roads. Its total offset remains within SURFACE_MAX_OFFSET of the logical level.
 */
export function groundHeightAt(terrain: Terrain, sceneX: number, sceneZ: number): number {
  if (!Number.isFinite(sceneX) || !Number.isFinite(sceneZ)) return 0;
  const ix = Math.floor(sceneX / SURFACE_CELL), iz = Math.floor(sceneZ / SURFACE_CELL);
  const cellX = (ix + 0.5) * SURFACE_CELL, cellZ = (iz + 0.5) * SURFACE_CELL;
  const tile = pixelToTile(cellX * WORLD.hex, cellZ * WORLD.hex, terrain.cols, terrain.rows);
  if (!tile) return 0;
  const index = tile.row * terrain.cols + tile.col;
  const top = visualTileHeight(terrain, index);
  const level = terrain.height[index];
  const center = tileCenter(tile.col, tile.row);
  const centerX = center.x / WORLD.hex, centerZ = center.y / WORLD.hex;
  const distance = Math.hypot(cellX - centerX, cellZ - centerZ);
  const fade = smoothstep(0.1, 0.38, distance);
  if (fade === 0) return top;
  const groupX = Math.floor(ix / 2), groupZ = Math.floor(iz / 2);
  const step = (hash(terrain.seed ^ 0x51ed270b, groupX, groupZ) % 5) - 2;
  const amplitude = level === 0 ? 0.0015 : 0.007;
  return top + fade * step * amplitude;
}
