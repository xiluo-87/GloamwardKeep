import type { Terrain } from './mapgen';

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

/** Sparse decorative dressing for otherwise bare raised tiles. This has no simulation effects. */
export function generateDecorations(terrain: Pick<Terrain, 'cols' | 'rows' | 'seed' | 'height' | 'feature' | 'spawns' | 'goal'>): Uint8Array {
  const decorations = new Uint8Array(terrain.cols * terrain.rows);
  const protectedTiles = new Uint8Array(decorations.length);
  protectedTiles[terrain.goal[1] * terrain.cols + terrain.goal[0]] = 1;
  for (const [col, row] of terrain.spawns) protectedTiles[row * terrain.cols + col] = 1;

  for (let index = 0; index < decorations.length; index++) {
    const height = terrain.height[index];
    if (!height || terrain.feature[index] !== 0 || protectedTiles[index]) continue;

    const coverage = 0.065 + Math.min(height, 4) * 0.01;
    if (sample(terrain.seed, index, DECORATION_SALT) >= coverage) continue;
    const stoneChance = 0.32 + Math.min(height, 4) * 0.12;
    decorations[index] = sample(terrain.seed, index, KIND_SALT) < stoneChance ? DECORATION.stones : DECORATION.bush;
  }
  return decorations;
}
