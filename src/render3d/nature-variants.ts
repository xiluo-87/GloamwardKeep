import { hexNeighbours } from '../sim/hex';
import { hashCell } from '../sim/rng';
import type { Terrain } from '../sim/mapgen';

export type NatureFamily = 'forest' | 'rocks' | 'bush' | 'stones';

export const NATURE_VARIANTS: Readonly<Record<NatureFamily, readonly string[]>> = {
  forest: ['pine-broad', 'pine-slender', 'pine-tiered', 'twin-pines', 'twin-saplings'],
  rocks: ['boulders', 'low-slab', 'stepped-pile', 'split-boulder', 'scattered-rocks'],
  bush: ['low-clump', 'round-clump', 'wide-clump', 'tall-clump'],
  stones: ['pebbles', 'flat-stones', 'twin-stones'],
};

export interface NatureSelection {
  baseId: string;
  snowId: string;
  snow: boolean;
  rotation: number;
  size: number;
  width: number;
  height: number;
  offsetX: number;
  offsetZ: number;
}

const SALT: Record<NatureFamily, number> = {
  forest: 0x13a5e71,
  rocks: 0x2be9c43,
  bush: 0x31c7a5d,
  stones: 0x4a2f681,
};

function snowAdjacent(terrain: Pick<Terrain, 'cols' | 'rows' | 'height'>, index: number): boolean {
  const col = index % terrain.cols;
  const row = Math.floor(index / terrain.cols);
  if (terrain.height[index] === 4) return true;
  return hexNeighbours(row).some(([dx, dy]) => {
    const x = col + dx, y = row + dy;
    return x >= 0 && y >= 0 && x < terrain.cols && y < terrain.rows && terrain.height[y * terrain.cols + x] === 4;
  });
}

/** Seed- and tile-stable selection shared by large features and small decoration props. */
export function selectNatureVariant(terrain: Pick<Terrain, 'cols' | 'rows' | 'seed' | 'height'>,
  index: number, family: NatureFamily): NatureSelection {
  const col = index % terrain.cols;
  const row = Math.floor(index / terrain.cols);
  const salt = SALT[family];
  const variants = NATURE_VARIANTS[family];
  const variant = variants[Math.floor(hashCell(terrain.seed ^ salt, col, row) * variants.length)];
  const baseId = `nature/${family}/${variant}`;
  const snow = snowAdjacent(terrain, index);
  return {
    baseId,
    snowId: `${baseId}-snow`,
    snow,
    rotation: Math.floor(hashCell(terrain.seed ^ (salt + 0x23f71), row, col) * 4) * Math.PI / 2,
    size: 0.92 + hashCell(terrain.seed ^ (salt + 0x4d29b), col, row) * 0.13,
    width: 0.96 + hashCell(terrain.seed ^ (salt + 0x79a51), row, col) * 0.08,
    height: 0.94 + hashCell(terrain.seed ^ (salt + 0xb438d), col, row) * 0.12,
    offsetX: (hashCell(terrain.seed ^ (salt + 0xe5317), col, row) - 0.5) * 0.06,
    offsetZ: (hashCell(terrain.seed ^ (salt + 0x10fca9), row, col) - 0.5) * 0.06,
  };
}
