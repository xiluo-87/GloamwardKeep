import { FEATURE } from '../sim/mapgen';
import type { Painter } from './voxel-model';
import type { Vector3 } from 'three';

const NEEDLES = ['#355727', '#486b27', '#62822d', '#7d9635', '#8fa43c'];
const BARK = '#725034';
const STONE = ['#626d74', '#7d888b', '#929da0', '#a7b0b1'];

/** Small integer mixer: stable for a map seed and tile index without touching sim RNG state. */
function randomSource(seed: number, index: number): () => number {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

const choose = <T,>(values: readonly T[], random: () => number): T => values[Math.floor(random() * values.length)];

function pine(p: Painter, x: number, y: number, z: number, scale: number, random: () => number): void {
  const trunkHeight = 0.48 * scale;
  p.box(x, y + trunkHeight / 2, z, 0.12 * scale, trunkHeight, 0.12 * scale, BARK);
  const cells = [
    Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2] as const)
      .filter(([dx, dz]) => !(Math.abs(dx) === 2 && Math.abs(dz) === 2)),
    [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
    [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
    [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
    [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]],
    [[0, 0]],
  ];
  const shades = [
    [NEEDLES[0], NEEDLES[1]], [NEEDLES[1], NEEDLES[2]],
    [NEEDLES[2], NEEDLES[3]], [NEEDLES[2], NEEDLES[3]],
    [NEEDLES[3], NEEDLES[4]], [NEEDLES[3], NEEDLES[4]],
  ];
  for (let layer = 0; layer < cells.length; layer++) {
    const centerY = (0.41 + layer * 0.145) * scale;
    const size = 0.15 * scale;
    for (const [dx, dz] of cells[layer]) {
      p.box(x + dx * 0.13 * scale, y + centerY, z + dz * 0.13 * scale,
        size, size, size, choose(shades[layer], random));
    }
  }
}

function bush(p: Painter, x: number, y: number, z: number, random: () => number): void {
  const size = 0.14 + random() * 0.02;
  const top = 0.25 + random() * 0.14;
  const color = choose(NEEDLES, random);
  p.box(x, y + size / 2, z, size, size, size, color);
  p.box(x - size * 0.72, y + size / 2, z + size * 0.18, size, size, size, choose(NEEDLES, random));
  p.box(x + size * 0.65, y + size / 2, z - size * 0.16, size, size, size, color);
  p.box(x, y + size + (top - size) / 2, z, size * 0.8, top - size, size * 0.8, choose(NEEDLES, random));
}

/** Paints deterministic decorative voxels for one forest or rock feature tile. */
export function paintNature(p: Painter, kind: number, origin: Vector3, index: number, seed: number): void {
  if (kind !== FEATURE.forest && kind !== FEATURE.rocks) return;
  const random = randomSource(seed, index);
  const { x, y, z } = origin;
  if (kind === FEATURE.forest) {
    const scale = 0.88 + random() * 0.23;
    pine(p, x + (random() - 0.5) * 0.12, y, z + (random() - 0.5) * 0.12, scale, random);
    const count = random() < 0.55 ? 1 : 2;
    for (let n = 0; n < count; n++) {
      const side = n === 0 ? -1 : 1;
      bush(p, x + side * (0.37 + random() * 0.04), y, z + (random() - 0.5) * 0.17, random);
    }
    return;
  }

  const count = 5 + Math.floor(random() * 5);
  const stackCount = 1 + Math.floor(random() * 2);
  for (let n = 0; n < count; n++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 0.35;
    const w = 0.19 + random() * 0.14;
    const d = 0.18 + random() * 0.14;
    const selectedBase = n === 0;
    const sizeBase = Math.min(w, d);
    const ratio = selectedBase ? 0.8 + random() * 0.2 : 0.75 + random() * 0.55;
    const h = sizeBase * ratio;
    const bx = x + Math.cos(angle) * radius;
    const bz = z + Math.sin(angle) * radius;
    p.box(bx, y + h / 2, bz, w, h, d, choose(STONE, random));
    if (selectedBase) {
      let top = y + h;
      for (let layer = 0; layer < stackCount; layer++) {
        const size = 0.15 + random() * 0.02;
        p.box(bx, top + size / 2, bz, size, size, size, choose(STONE, random));
        top += size;
      }
    }
  }
}
