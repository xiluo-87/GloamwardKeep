import {
  AlwaysStencilFunc, BufferGeometry, Group, InstancedMesh, Material, Matrix4, Mesh, MeshStandardMaterial,
  Quaternion, ReplaceStencilOp, Vector3,
} from 'three';
import { WORLD } from '../data/balance';
import { tileCenter } from '../sim/hex';
import { DECORATION } from '../sim/decorations';
import type { Terrain } from '../sim/mapgen';
import { hashCell } from '../sim/rng';
import { visualTileHeight } from './surface';
import { Painter } from './voxel-model';
import { BASE_SCENE, type SceneProportions } from '../render3d/scene-proportions';
import { ContentAssetLibrary } from '../render3d/asset-library';
import { selectNatureVariant } from '../render3d/nature-variants';
import { disposeTerrain } from './terrain';

export interface DecorationLayer {
  root: Group;
  /** Hide only the decoration instances belonging to a row-major terrain tile. */
  removeAt(index: number): void;
}

const GREENS = ['#355727', '#486b27', '#62822d', '#7d9635', '#8fa43c'];
const STONES = ['#626d74', '#7d888b', '#929da0', '#a7b0b1'];
interface Range { start: number; count: number }
interface CustomBatch {
  geometry: BufferGeometry;
  material: Material | Material[];
  localMatrix: Matrix4;
  matrices: Matrix4[];
  mesh?: InstancedMesh;
}
interface InstanceRef { batch: CustomBatch; slot: number }

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
export function buildDecorations(terrain: Terrain, proportions: SceneProportions = BASE_SCENE,
  library: ContentAssetLibrary | null = null): DecorationLayer {
  const painter = new Painter();
  const fallbackRanges: (Range | undefined)[] = new Array(terrain.cols * terrain.rows);
  const customRanges: (InstanceRef | undefined)[] = new Array(terrain.cols * terrain.rows);
  const customBatches = new Map<string, CustomBatch>();
  const zeroMatrix = new Matrix4().makeScale(0, 0, 0);

  const createCustomBatch = (id: string): CustomBatch | null => {
    const prefab = library?.instantiate(id);
    if (!prefab) return null;
    prefab.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    prefab.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
    if (meshes.length !== 1) { disposeTerrain(prefab); return null; }
    const sourceMesh = meshes[0];
    const cloneMaterial = (material: Material): Material => {
      const copy = material.clone();
      copy.userData.sharedAsset = false;
      if ('stencilWrite' in copy) {
        const stencilMaterial = copy as MeshStandardMaterial;
        stencilMaterial.stencilWrite = true;
        stencilMaterial.stencilRef = 0;
        stencilMaterial.stencilFunc = AlwaysStencilFunc;
        stencilMaterial.stencilZPass = ReplaceStencilOp;
      }
      return copy;
    };
    const material = Array.isArray(sourceMesh.material)
      ? sourceMesh.material.map(cloneMaterial)
      : cloneMaterial(sourceMesh.material);
    const inverseRoot = prefab.matrixWorld.clone().invert();
    const localMatrix = inverseRoot.multiply(sourceMesh.matrixWorld.clone());
    const batch: CustomBatch = { geometry: sourceMesh.geometry, material, localMatrix, matrices: [] };
    disposeTerrain(prefab);
    return batch;
  };

  for (let index = 0; index < customRanges.length; index++) {
    const kind = terrain.decoration[index];
    if (kind !== DECORATION.bush && kind !== DECORATION.stones) continue;
    const col = index % terrain.cols;
    const row = Math.floor(index / terrain.cols);
    const center = tileCenter(col, row);
    const originX = center.x / WORLD.hex;
    const originZ = center.y / WORLD.hex;
    const baseY = visualTileHeight(terrain, index) / proportions.tile;
    const family = kind === DECORATION.bush ? 'bush' : 'stones';
    const selection = selectNatureVariant(terrain, index, family);
    const customId = selection.snow && library?.has(selection.snowId) ? selection.snowId
      : library?.has(selection.baseId) ? selection.baseId : null;
    if (customId) {
      let batch = customBatches.get(customId);
      if (!batch) {
        batch = createCustomBatch(customId) ?? undefined;
        if (batch) customBatches.set(customId, batch);
      }
      if (batch) {
        const scale = proportions.vegetation / proportions.tile;
        const position = new Vector3(originX + selection.offsetX * scale, baseY,
          originZ + selection.offsetZ * scale);
        const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), selection.rotation);
        const instanceScale = new Vector3(scale * selection.size * selection.width,
          scale * selection.size * selection.height, scale * selection.size);
        const matrix = new Matrix4().compose(position, rotation, instanceScale).multiply(batch.localMatrix);
        const slot = batch.matrices.length;
        batch.matrices.push(matrix);
        customRanges[index] = { batch, slot };
        continue;
      }
    }

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
    fallbackRanges[index] = { start, count: painter.parts.length - start };
  }

  const root = new Group();
  root.name = 'Small map decorations';
  const fallbackMesh = painter.parts.length ? painter.mesh() : null;
  if (fallbackMesh) {
    fallbackMesh.name = 'Small map decoration instances';
    const material = fallbackMesh.material as MeshStandardMaterial;
    material.stencilWrite = true;
    material.stencilRef = 0;
    material.stencilFunc = AlwaysStencilFunc;
    material.stencilZPass = ReplaceStencilOp;
    fallbackMesh.castShadow = true;
    fallbackMesh.receiveShadow = true;
    root.add(fallbackMesh);
  }
  for (const [id, batch] of customBatches) {
    const mesh = new InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    mesh.name = `Small map decoration ${id}`;
    mesh.count = batch.matrices.length;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    batch.mesh = mesh;
    root.add(mesh);
  }
  return {
    root,
    removeAt(index) {
      const fallbackRange = fallbackRanges[index];
      if (fallbackMesh && fallbackRange) {
        for (let instance = fallbackRange.start; instance < fallbackRange.start + fallbackRange.count; instance++) {
          fallbackMesh.setMatrixAt(instance, zeroMatrix);
        }
        fallbackRanges[index] = undefined;
        fallbackMesh.instanceMatrix.needsUpdate = true;
      }
      const custom = customRanges[index];
      if (custom?.batch.mesh) {
        custom.batch.mesh.setMatrixAt(custom.slot, zeroMatrix);
        custom.batch.mesh.instanceMatrix.needsUpdate = true;
        customRanges[index] = undefined;
      }
    },
  };
}
