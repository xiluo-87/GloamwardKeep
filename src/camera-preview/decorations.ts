import { AlwaysStencilFunc, Group, Matrix4, MeshStandardMaterial, ReplaceStencilOp } from 'three';
import { WORLD } from '../data/balance';
import { tileCenter } from '../sim/hex';
import { DECORATION } from '../sim/decorations';
import type { Terrain } from '../sim/mapgen';
import { hashCell } from '../sim/rng';
import { visualTileHeight } from './surface';
import { Painter } from './voxel-model';
import { BASE_SCENE, type SceneProportions } from '../render3d/scene-proportions';

export interface DecorationLayer {
  root: Group;
  /** Hide only the decoration instances belonging to a row-major terrain tile. */
  removeAt(index: number): void;
}

const GREENS = ['#355727', '#486b27', '#62822d', '#7d9635', '#8fa43c'];
const STONES = ['#626d74', '#7d888b', '#929da0', '#a7b0b1'];
interface Range { start: number; count: number }

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

const choose = (palette: readonly string[], random: () => number): string => palette[Math.floor(random() * palette.length)];

function paintBush(p: Painter, x: number, y: number, z: number, random: () => number): void {
  const size = 0.14 + random() * 0.025;
  const height = 0.23 + random() * 0.1;
  const color = choose(GREENS, random);
  // The three base cubes touch/overlap to read as one low leafy clump.
  p.box(x, y + size / 2, z, size, size, size, color);
  p.box(x - size * 0.78, y + size / 2, z + size * 0.12, size, size, size, choose(GREENS, random));
  p.box(x + size * 0.72, y + size / 2, z - size * 0.1, size, size, size, choose(GREENS, random));
  p.box(x, y + size + (height - size) / 2, z, size * 0.8, height - size, size * 0.8, choose(GREENS, random));
}

function paintStones(p: Painter, x: number, y: number, z: number, random: () => number): void {
  const count = 2 + Math.floor(random() * 2);
  const firstW = 0.19 + random() * 0.04;
  const firstD = 0.18 + random() * 0.05;
  const firstH = 0.12 + random() * 0.04;
  p.box(x, y + firstH / 2, z, firstW, firstH, firstD, choose(STONES, random));
  const side = random() < 0.5 ? -1 : 1;
  const secondW = 0.15 + random() * 0.045;
  const secondD = 0.14 + random() * 0.04;
  const secondH = 0.13 + random() * 0.05;
  p.box(x + side * (firstW + secondW) * 0.39, y + secondH / 2, z + 0.04, secondW, secondH, secondD, choose(STONES, random));
  if (count === 3) {
    const top = 0.12 + random() * 0.04;
    p.box(x - side * 0.015, y + firstH + top / 2, z - 0.015, top, top, top, choose(STONES, random));
  }
}

/** Build sparse, non-gameplay map dressing as one removable instanced layer. */
export function buildDecorations(terrain: Terrain, proportions: SceneProportions = BASE_SCENE): DecorationLayer {
  const painter = new Painter();
  const ranges: (Range | undefined)[] = new Array(terrain.cols * terrain.rows);
  const zeroMatrix = new Matrix4().makeScale(0, 0, 0);
  for (let index = 0; index < ranges.length; index++) {
    const kind = terrain.decoration[index];
    if (kind !== DECORATION.bush && kind !== DECORATION.stones) continue;
    const col = index % terrain.cols;
    const row = Math.floor(index / terrain.cols);
    const center = tileCenter(col, row);
    const originX = center.x / WORLD.hex;
    const originZ = center.y / WORLD.hex;
    const baseY = visualTileHeight(terrain, index) / proportions.tile;
    const cellSeed = Math.floor(hashCell(terrain.seed, col, row) * 0xffffffff);
    const random = randomSource(cellSeed, index);
    const start = painter.parts.length;
    if (kind === DECORATION.bush) {
      const offsetX = (random() - 0.5) * 0.12;
      const offsetZ = (random() - 0.5) * 0.12;
      paintBush(painter, originX + offsetX, baseY, originZ + offsetZ, random);
    } else {
      const offsetX = (random() - 0.5) * 0.13;
      const offsetZ = (random() - 0.5) * 0.13;
      paintStones(painter, originX + offsetX, baseY, originZ + offsetZ, random);
    }
    const scale = proportions.vegetation / proportions.tile;
    for (let partIndex = start; partIndex < painter.parts.length; partIndex++) {
      const part = painter.parts[partIndex];
      part.x = originX + (part.x - originX) * scale;
      part.y = baseY + (part.y - baseY) * scale;
      part.z = originZ + (part.z - originZ) * scale;
      part.w *= scale;
      part.h *= scale;
      part.d *= scale;
    }
    ranges[index] = { start, count: painter.parts.length - start };
  }

  const root = new Group();
  root.name = 'Small map decorations';
  if (!painter.parts.length) return { root, removeAt() {} };
  const mesh = painter.mesh();
  mesh.name = 'Small map decoration instances';
  const material = mesh.material as MeshStandardMaterial;
  material.stencilWrite = true;
  material.stencilRef = 0;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilZPass = ReplaceStencilOp;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return {
    root,
    removeAt(index) {
      const range = ranges[index];
      if (!range || range.count === 0) return;
      for (let instance = range.start; instance < range.start + range.count; instance++) {
        mesh.setMatrixAt(instance, zeroMatrix);
      }
      ranges[index] = undefined;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
