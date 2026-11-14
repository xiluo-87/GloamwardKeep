import { visualTileHeight } from '../src/camera-preview/surface';
import {
  AlwaysStencilFunc, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, ReplaceStencilOp, Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/data/balance';
import { buildDecorations } from '../src/camera-preview/decorations';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { tileCenter } from '../src/sim/hex';
import { DECORATION } from '../src/sim/decorations';
import type { Terrain } from '../src/sim/mapgen';

function sample(seed = 17): Terrain {
  const cols = 5, rows = 2;
  return {
    cols, rows,
    height: Uint8Array.from([0, 1, 2, 3, 1, 2, 1, 3, 2, 1]),
    feature: new Uint8Array(cols * rows),
    decoration: Uint8Array.from([0, 1, 2, 1, 0, 2, 0, 1, 0, 0]),
    spawns: [[0, 0]], goal: [4, 0], gaps: [], seed,
  };
}

const meshOf = (root: ReturnType<typeof buildDecorations>['root']): InstancedMesh => {
  const mesh = root.children[0];
  if (!(mesh instanceof InstancedMesh)) throw new Error('Expected one batched decoration mesh');
  return mesh;
};

function snapshot(mesh: InstancedMesh): { matrices: number[]; colors: number[] } {
  return {
    matrices: Array.from(mesh.instanceMatrix.array),
    colors: mesh.instanceColor ? Array.from(mesh.instanceColor.array) : [],
  };
}

describe('small map decorations', () => {
  it('builds deterministic varied bush/stone instances with grounded bounded shapes', () => {
    const terrain = sample();
    const first = buildDecorations(terrain);
    const same = buildDecorations(sample());
    const changed = buildDecorations(sample(18));
    const mesh = meshOf(first.root), sameMesh = meshOf(same.root), changedMesh = meshOf(changed.root);
    expect(snapshot(mesh)).toEqual(snapshot(sameMesh));
    expect(snapshot(mesh)).not.toEqual(snapshot(changedMesh));
    expect(first.root.name).toBe('Small map decorations');
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    const material = mesh.material as MeshStandardMaterial;
    expect(material.stencilWrite).toBe(true);
    expect(material.stencilRef).toBe(0);
    expect(material.stencilFunc).toBe(AlwaysStencilFunc);
    expect(material.stencilZPass).toBe(ReplaceStencilOp);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);

    const matrices: Matrix4[] = Array.from({ length: mesh.count }, (_, i) => {
      const matrix = new Matrix4();
      mesh.getMatrixAt(i, matrix);
      return matrix;
    });
    const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
    const centers = Array.from({ length: terrain.cols * terrain.rows }, (_, index) => {
      const at = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
      return { x: at.x / WORLD.hex, z: at.y / WORLD.hex };
    });
    const byTile = new Map<number, { x: number; y: number; z: number; sx: number; sy: number; sz: number }[]>();
    for (const matrix of matrices) {
      matrix.decompose(position, quaternion, scale);
      let tile = -1, distance = Infinity;
      centers.forEach((center, index) => {
        const d = Math.hypot(position.x - center.x, position.z - center.z);
        if (d < distance) { tile = index; distance = d; }
      });
      expect(distance).toBeLessThanOrEqual(0.65);
      const group = byTile.get(tile) ?? [];
      group.push({ x: position.x, y: position.y, z: position.z, sx: scale.x, sy: scale.y, sz: scale.z });
      byTile.set(tile, group);
    }
    for (const [tile, parts] of byTile) {
      const floor = visualTileHeight(terrain, tile);
      for (const part of parts) {
        expect(part.y - part.sy / 2).toBeGreaterThanOrEqual(floor - 1e-6);
        expect(part.y + part.sy / 2 - floor).toBeLessThanOrEqual(0.35 + 1e-6);
        expect(Math.hypot(Math.abs(part.x - centers[tile].x) + part.sx / 2,
          Math.abs(part.z - centers[tile].z) + part.sz / 2)).toBeLessThanOrEqual(0.65);
      }
      // Every cube touches at least one other cube in its tile clump (bushes overlap; stone cap stacks).
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        const linked = parts.some((b, j) => i !== j
          && Math.abs(a.x - b.x) <= (a.sx + b.sx) / 2 + 1e-6
          && Math.abs(a.z - b.z) <= (a.sz + b.sz) / 2 + 1e-6
          && Math.abs(a.y - b.y) <= (a.sy + b.sy) / 2 + 1e-6);
        expect(linked).toBe(true);
      }
    }
    disposeTerrain(first.root); disposeTerrain(same.root); disposeTerrain(changed.root);
  });

  it('removes only one tile idempotently and never mutates terrain or run-owned map fields', () => {
    const terrain = sample(90210);
    const before = {
      height: [...terrain.height], feature: [...terrain.feature], decoration: [...terrain.decoration],
      spawns: terrain.spawns.map(([x, y]) => [x, y]), goal: [...terrain.goal], seed: terrain.seed,
    };
    const layer = buildDecorations(terrain);
    const mesh = meshOf(layer.root);
    const matrices = new Array<Matrix4>(mesh.count);
    const pos = new Vector3(), rot = new Quaternion(), scale = new Vector3();
    const tileFor: number[] = [];
    const centers = Array.from({ length: terrain.cols * terrain.rows }, (_, index) => {
      const at = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
      return { x: at.x / WORLD.hex, z: at.y / WORLD.hex };
    });
    for (let instance = 0; instance < mesh.count; instance++) {
      const matrix = new Matrix4(); mesh.getMatrixAt(instance, matrix); matrices[instance] = matrix.clone();
      matrix.decompose(pos, rot, scale);
      let tile = -1, closest = Infinity;
      centers.forEach((center, index) => {
        const d = Math.hypot(pos.x - center.x, pos.z - center.z);
        if (d < closest) { tile = index; closest = d; }
      });
      tileFor.push(tile);
    }
    const toRemove = 1;
    expect(terrain.decoration[toRemove]).toBe(DECORATION.bush);
    const removed = tileFor.map((tile, instance) => tile === toRemove ? instance : -1).filter((instance) => instance >= 0);
    const remaining = tileFor.map((tile, instance) => tile !== toRemove ? instance : -1).filter((instance) => instance >= 0);
    expect(removed.length).toBeGreaterThan(0);
    expect(remaining.length).toBeGreaterThan(0);
    layer.removeAt(toRemove);
    layer.removeAt(toRemove);
    for (const instance of removed) {
      mesh.getMatrixAt(instance, matrices[instance]);
      expect([matrices[instance].elements[0], matrices[instance].elements[5], matrices[instance].elements[10]]).toEqual([0, 0, 0]);
    }
    for (const instance of remaining) {
      mesh.getMatrixAt(instance, matrices[instance]);
      expect([matrices[instance].elements[0], matrices[instance].elements[5], matrices[instance].elements[10]].every((size) => size > 0)).toBe(true);
    }
    expect({
      height: [...terrain.height], feature: [...terrain.feature], decoration: [...terrain.decoration],
      spawns: terrain.spawns.map(([x, y]) => [x, y]), goal: [...terrain.goal], seed: terrain.seed,
    }).toEqual(before);
    disposeTerrain(layer.root);
  });
});
