import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildVoxelEnvironment } from '../src/camera-preview/environment';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { visualTileHeight } from '../src/camera-preview/surface';
import { ContentAssetLibrary } from '../src/render3d/asset-library';
import { ROOMIER_SCENE } from '../src/render3d/scene-proportions';
import { NATURE_VARIANTS, selectNatureVariant } from '../src/render3d/nature-variants';
import { DECORATION } from '../src/sim/decorations';
import { FEATURE, type Terrain } from '../src/sim/mapgen';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATURE_GLB = 'assets-src/rework/custom/nature/nature.glb';

function expectedIds(): string[] {
  return Object.entries(NATURE_VARIANTS).flatMap(([family, variants]) => variants.flatMap(variant => {
    const id = `nature/${family}/${variant}`;
    return [id, `${id}-snow`];
  })).sort();
}

function terrainForAssetReview(): Terrain {
  const cols = 20, rows = 10;
  const terrain: Terrain = {
    cols, rows, seed: 5813,
    height: new Uint8Array(cols * rows).fill(1),
    feature: new Uint8Array(cols * rows), decoration: new Uint8Array(cols * rows),
    spawns: [[0, 1]], goal: [cols - 1, 8], gaps: [],
  };
  const forest = 2 * cols + 4;
  const rocks = 5 * cols + 13;
  terrain.feature[forest] = FEATURE.forest;
  terrain.feature[rocks] = FEATURE.rocks;
  terrain.height[forest + 1] = 4; // Forest has a high hex neighbour, so it should select snow.
  terrain.height[rocks] = 4; // Rock tile itself is high, so it should select snow.
  terrain.decoration.fill(DECORATION.bush);
  terrain.decoration[forest] = DECORATION.none;
  terrain.decoration[rocks] = DECORATION.none;
  return terrain;
}

function selectedAssetId(terrain: Terrain, index: number, family: 'bush' | 'stones'): string {
  const selection = selectNatureVariant(terrain, index, family);
  return selection.snow ? selection.snowId : selection.baseId;
}

describe('authored nature GLB integration', () => {
  it('loads all 34 source prefabs, seats them in the roomier environment, and removes a borrowed-geometry prop safely', async () => {
    const bytes = readFileSync(resolve(ROOT, NATURE_GLB));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const sourceMeshes: Mesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof Mesh) sourceMeshes.push(object); });
    expect(sourceMeshes).toHaveLength(34);
    const sourceDispose = new Map<Mesh['geometry'], number>();
    for (const mesh of sourceMeshes) {
      sourceDispose.set(mesh.geometry, 0);
      mesh.geometry.addEventListener('dispose', () => sourceDispose.set(mesh.geometry, (sourceDispose.get(mesh.geometry) ?? 0) + 1));
    }
    const library = new ContentAssetLibrary(gltf.scene);
    expect([...library.ids].sort()).toEqual(expectedIds());
    for (const id of expectedIds()) {
      expect(library.has(id), `${id} exists`).toBe(true);
      const prefab = library.instantiate(id)!;
      expect(prefab.userData.assetId).toBe(id);
      const [, family, variantSnow] = id.split('/');
      const snow = variantSnow.endsWith('-snow');
      const variant = snow ? variantSnow.slice(0, -5) : variantSnow;
      const extras = (prefab.userData.gltfExtras ?? prefab.userData) as Record<string, unknown>;
      expect(extras.family, `${id} family metadata`).toBe(family);
      expect(extras.base_variant, `${id} base variant metadata`).toBe(variant);
      expect(extras.snow, `${id} snow metadata`).toBe(snow);
      if (family === 'forest') {
        expect(extras.tree_count, `${id} tree count`).toBe(variant === 'twin-pines' || variant === 'twin-saplings' ? 2 : 1);
      }
      const meshes: Mesh[] = [];
      prefab.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
      expect(meshes).toHaveLength(1);
      const mesh = meshes[0];
      expect(mesh.geometry.getAttribute('color'), `${id} vertex colors`).toBeDefined();
      prefab.updateMatrixWorld(true);
      const box = new Box3().setFromObject(prefab);
      expect(box.min.y, `${id} mesh ground origin`).toBeCloseTo(0, 4);
      if (family === 'forest' && snow) {
        const positions = mesh.geometry.getAttribute('position');
        const colors = mesh.geometry.getAttribute('color');
        const paired = Number(extras.tree_count) === 2;
        const snowBounds = Array.from({ length: paired ? 2 : 1 }, () => new Box3());
        const point = new Vector3();
        for (let vertex = 0; vertex < positions.count; vertex++) {
          if (Math.min(colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)) < 0.75) continue;
          point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld);
          snowBounds[paired && point.x > 0 ? 1 : 0].expandByPoint(point);
        }
        for (const [tree, bounds] of snowBounds.entries()) {
          // A tip-only cap spans one voxel. Each tree also needs visible snow lower down.
          expect(bounds.max.y - bounds.min.y, `${id} tree ${tree + 1} has a snow ring below its tip`).toBeGreaterThan(0.15);
        }
      }
      expect(mesh.geometry.groups.length, `${id} one material primitive`).toBeLessThanOrEqual(1);
      disposeTerrain(prefab);
    }

    const terrain = terrainForAssetReview();
    const forestIndex = 2 * terrain.cols + 4;
    const rocksIndex = 5 * terrain.cols + 13;
    expect(selectNatureVariant(terrain, forestIndex, 'forest').snow).toBe(true);
    expect(selectNatureVariant(terrain, rocksIndex, 'rocks').snow).toBe(true);
    const environment = buildVoxelEnvironment(terrain, 'artwork', library, 1, ROOMIER_SCENE);
    const forestFeature = environment.features.find(feature => feature.tree)!;
    const rockFeature = environment.features.find(feature => !feature.tree)!;
    expect(forestFeature.mesh.parent?.userData.assetId)
      .toBe(selectNatureVariant(terrain, forestIndex, 'forest').snowId);
    expect(rockFeature.mesh.parent?.userData.assetId)
      .toBe(selectNatureVariant(terrain, rocksIndex, 'rocks').snowId);
    expect(forestFeature.bounds.min.y).toBeCloseTo(visualTileHeight(terrain, forestIndex) / ROOMIER_SCENE.tile, 4);
    expect(rockFeature.bounds.min.y).toBeCloseTo(visualTileHeight(terrain, rocksIndex) / ROOMIER_SCENE.tile, 4);
    expect(forestFeature.material.userData.sharedAsset).toBe(false);
    expect(rockFeature.material.userData.sharedAsset).toBe(false);

    let removeIndex = -1, peerIndex = -1, smallId = '';
    const firstById = new Map<string, number>();
    for (let index = 0; index < terrain.decoration.length; index++) {
      if (terrain.decoration[index] !== DECORATION.bush) continue;
      const id = selectedAssetId(terrain, index, 'bush');
      const first = firstById.get(id);
      if (first !== undefined) { removeIndex = first; peerIndex = index; smallId = id; break; }
      firstById.set(id, index);
    }
    expect(peerIndex).toBeGreaterThan(removeIndex);
    const batch = environment.decorations.root.getObjectByName(`Small map decoration ${smallId}`) as InstancedMesh;
    expect(batch).toBeInstanceOf(InstancedMesh);
    expect(batch.geometry.userData.sharedAsset).toBe(true);
    const materials = Array.isArray(batch.material) ? batch.material : [batch.material];
    for (const material of materials) {
      expect(material).toBeInstanceOf(MeshStandardMaterial);
      expect(material.userData.sharedAsset).toBe(false);
    }
    const slotFor = (tile: number): number => {
      let slot = -1;
      for (let index = 0; index <= tile; index++) {
        if (terrain.decoration[index] === DECORATION.bush && selectedAssetId(terrain, index, 'bush') === smallId) slot++;
      }
      return slot;
    };
    const removeSlot = slotFor(removeIndex), peerSlot = slotFor(peerIndex);
    const peerBefore = new Matrix4(); batch.getMatrixAt(peerSlot, peerBefore);
    environment.decorations.removeAt(removeIndex);
    environment.decorations.removeAt(removeIndex);
    const removed = new Matrix4(); batch.getMatrixAt(removeSlot, removed);
    expect([removed.elements[0], removed.elements[5], removed.elements[10]]).toEqual([0, 0, 0]);
    const peerAfter = new Matrix4(); batch.getMatrixAt(peerSlot, peerAfter);
    expect(peerAfter.elements).toEqual(peerBefore.elements);

    disposeTerrain(environment.root);
    expect([...sourceDispose.values()].every(count => count === 0)).toBe(true);
    library.dispose();
    expect([...sourceDispose.values()].every(count => count === 1)).toBe(true);
  });
});
