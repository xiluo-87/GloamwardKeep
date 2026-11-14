import type { Terrain } from './mapgen';
import { MAP_DETAIL } from '../data/balance';
import { tilesWithinHexRadius } from './hex';

export const DECORATION = { none: 0, bush: 1, stones: 2 } as const;
export type DecorationId = typeof DECORATION[keyof typeof DECORATION];

const DECORATION_SALT = 0x4f1bbcdc;
const KIND_SALT = 0x8f6c5a21;

/** Stable per-tile hash stream, kept separate from the gameplay map generator's RNG. */
function sample(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

/** Seeded clusters on bare raised tiles, with coverage of otherwise empty plateau interiors. */
export function generateDecorations(terrain: Pick<Terrain, 'cols' | 'rows' | 'seed' | 'height' | 'feature' | 'spawns' | 'goal'>): Uint8Array {
  const decorations = new Uint8Array(terrain.cols * terrain.rows);
  const protectedTiles = new Uint8Array(decorations.length);
  protectedTiles[terrain.goal[1] * terrain.cols + terrain.goal[0]] = 1;
  for (const [col, row] of terrain.spawns) protectedTiles[row * terrain.cols + col] = 1;

  const eligible: number[] = [];
  for (let i = 0; i < decorations.length; i++) {
    if (terrain.height[i] > 0 && terrain.feature[i] === 0 && !protectedTiles[i]) eligible.push(i);
  }
  eligible.sort((a, b) => sample(terrain.seed, a, DECORATION_SALT) - sample(terrain.seed, b, DECORATION_SALT));
  const budget = Math.floor(eligible.length * MAP_DETAIL.maxDecorationShare);
  let count = 0;
  const plantCluster = (center: number): void => {
    if (decorations[center] || count >= budget) return;
    const height = terrain.height[center];
    const stoneChance = 0.32 + Math.min(height, 4) * 0.12;
    const kind = sample(terrain.seed, center, KIND_SALT) < stoneChance ? DECORATION.stones : DECORATION.bush;
    const want = MAP_DETAIL.decorationClusterSize[0] + Math.floor(sample(terrain.seed, center, KIND_SALT ^ DECORATION_SALT)
      * (MAP_DETAIL.decorationClusterSize[1] - MAP_DETAIL.decorationClusterSize[0] + 1));
    const frontier = [center];
    for (let placed = 0; placed < want && frontier.length && count < budget; placed++) {
      frontier.sort((a, b) => sample(terrain.seed ^ center, a, KIND_SALT) - sample(terrain.seed ^ center, b, KIND_SALT));
      const tile = frontier.shift()!;
      decorations[tile] = kind; count++;
      for (const next of tilesWithinHexRadius(tile % terrain.cols, Math.floor(tile / terrain.cols), 1, terrain.cols, terrain.rows)) {
        if (terrain.height[next] === height && !terrain.feature[next] && !protectedTiles[next]
          && !decorations[next] && !frontier.includes(next)) frontier.push(next);
      }
    }
  };
  for (const center of eligible) {
    if (sample(terrain.seed, center, DECORATION_SALT) < MAP_DETAIL.decorationSeedChance) plantCluster(center);
  }
  // Adding dressing only removes empty disks, so one stable pass suffices.
  const radius = MAP_DETAIL.plateauRadius;
  const fullDisk = 1 + 3 * radius * (radius + 1);
  for (const center of eligible) {
    const disk = tilesWithinHexRadius(center % terrain.cols, Math.floor(center / terrain.cols), radius, terrain.cols, terrain.rows);
    if (disk.length === fullDisk && disk.every(tile => terrain.height[tile] === terrain.height[center]
      && !terrain.feature[tile] && !decorations[tile])) plantCluster(center);
  }
  return decorations;
}
