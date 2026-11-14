import {
  BoxGeometry, BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { buildVoxelEnvironment } from '../src/camera-preview/environment';
import { buildDecorations } from '../src/camera-preview/decorations';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { visualTileHeight } from '../src/camera-preview/surface';
import { ContentAssetLibrary } from '../src/render3d/asset-library';
import { BASE_SCENE, ROOMIER_SCENE } from '../src/render3d/scene-proportions';
import { NATURE_VARIANTS, selectNatureVariant } from '../src/render3d/nature-variants';
import { WORLD } from '../src/data/balance';
import { FEATURE, type Terrain } from '../src/sim/mapgen';
import { DECORATION } from '../src/sim/decorations';
import { tileCenter } from '../src/sim/hex';
import { hashCell } from '../src/sim/rng';

function makeTerrain(cols = 8, rows = 4, seed = 19): Terrain {
  const length = cols * rows;
  return {
    cols, rows, seed,
    height: Uint8Array.from({ length }, (_, i) => i % 5),
    feature: new Uint8Array(length), decoration: new Uint8Array(length),
    spawns: [[0, 0]], goal: [cols - 1, 0], gaps: [],
  };
}

function allAssetIds(): string[] {
  return Object.entries(NATURE_VARIANTS).flatMap(([family, variants]) => variants.flatMap(variant => {
    const id = `nature/${family}/${variant}`;
    return [id, `${id}-snow`];
  }));
}

function makeLibrary(ids: readonly string[]): { library: ContentAssetLibrary; source: Group; geometryDisposals: number[] } {
  const source = new Group();
  const geometryDisposals: number[] = [];
  for (const id of ids) {
    const [nature, family, namedVariant] = id.split('/');
    const snow = namedVariant.endsWith('-snow');
    const variant = snow ? namedVariant.slice(0, -5) : namedVariant;
    const root = new Group();
    root.userData.asset_id = id;
    root.userData.family = family;
    root.userData.base_variant = variant;
    root.userData.snow = snow;
    root.userData.tree_count = family === 'forest' && (variant === 'twin-pines' || variant === 'twin-saplings') ? 2 : family === 'forest' ? 1 : 0;
    const geometry = new BoxGeometry(0.3, 0.2, 0.24);
    const color = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let vertex = 0; vertex < color.length / 3; vertex++) {
      color[vertex * 3] = snow ? 0.85 : 0.35;
      color[vertex * 3 + 1] = snow ? 0.9 : 0.55;
      color[vertex * 3 + 2] = snow ? 0.95 : 0.3;
    }
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    geometry.addEventListener('dispose', () => { geometryDisposals.push(1); });
    const material = new MeshStandardMaterial({ vertexColors: true });
    const mesh = new Mesh(geometry, material);
    // A nonzero child transform checks that instancing preserves the authored local matrix.
    mesh.position.set(0.03, 0.1, -0.02);
    root.add(mesh);
    source.add(root);
    void nature;
  }
  return { library: new ContentAssetLibrary(source), source, geometryDisposals };
}

function customId(terrain: Terrain, index: number, library: ContentAssetLibrary, family: 'bush' | 'stones'): string | null {
  const selection = selectNatureVariant(terrain, index, family);
  if (selection.snow && library.has(selection.snowId)) return selection.snowId;
  return library.has(selection.baseId) ? selection.baseId : null;
}

describe('seeded authored nature variants', () => {
  it('covers exactly 17 authored silhouettes and selects stable quarter-turns, scales, and snow adjacency', () => {
    expect(Object.values(NATURE_VARIANTS).flat()).toHaveLength(17);
    const coverage = new Set<string>();
    for (let seed = 1; seed <= 64; seed++) {
      const terrain = makeTerrain(10, 6, seed);
      for (let index = 0; index < terrain.height.length; index++) {
        for (const family of Object.keys(NATURE_VARIANTS) as Array<keyof typeof NATURE_VARIANTS>) {
          coverage.add(selectNatureVariant(terrain, index, family).baseId);
        }
      }
    }
    expect(coverage).toEqual(new Set(allAssetIds().filter(id => !id.endsWith('-snow'))));

    const terrain = makeTerrain(3, 3, 1234);
    terrain.height.fill(1);
    const plain = selectNatureVariant(terrain, 4, 'forest');
    expect(selectNatureVariant(terrain, 4, 'forest')).toEqual(plain);
    expect(plain.snow).toBe(false);
    terrain.height[5] = 4; // Odd-row right neighbour of center tile 4.
    expect(selectNatureVariant(terrain, 4, 'forest').snow).toBe(true);
    terrain.height[4] = 4; // The tile itself also selects snow.
    expect(selectNatureVariant(terrain, 4, 'forest').snow).toBe(true);
    expect([0, Math.PI / 2, Math.PI, Math.PI * 1.5]).toContain(plain.rotation);
    expect(plain.size).toBeGreaterThanOrEqual(0.92);
    expect(plain.size).toBeLessThan(1.05);
    expect(plain.width).toBeGreaterThanOrEqual(0.96);
    expect(plain.width).toBeLessThan(1.04);
    expect(plain.height).toBeGreaterThanOrEqual(0.94);
    expect(plain.height).toBeLessThan(1.06);
  });

  it('uses a nearby snow prefab for features and keeps legacy sample prefabs as fallback', () => {
    const terrain = makeTerrain(6, 3, 42);
    terrain.height.fill(1);
    const forestIndex = 1 * terrain.cols + 2;
    const rocksIndex = 1 * terrain.cols + 4;
    terrain.feature[forestIndex] = FEATURE.forest;
    terrain.feature[rocksIndex] = FEATURE.rocks;
    terrain.height[forestIndex + 1] = 4;
    const assets = makeLibrary(allAssetIds());
    const forest = selectNatureVariant(terrain, forestIndex, 'forest');
    expect(forest.snow).toBe(true);
    const environment = buildVoxelEnvironment(terrain, 'artwork', assets.library, 1, BASE_SCENE);
    const forestFeature = environment.features.find(feature => feature.tree)!;
    expect(forestFeature.mesh.parent?.userData.assetId).toBe(forest.snowId);
    expect(forestFeature.mesh.parent?.userData.gltfExtras?.family ?? forestFeature.mesh.parent?.userData.family).toBe('forest');
    expect(forestFeature.material.stencilRef).toBe(0);
    expect(forestFeature.mesh.castShadow).toBe(true);
    disposeTerrain(environment.root);
    assets.library.dispose();

    const fallbackTerrain = makeTerrain(5, 2, 77);
    fallbackTerrain.feature[2] = FEATURE.forest;
    const col = 2, row = 0;
    const sample = 1 + Math.floor(hashCell(fallbackTerrain.seed, col, row) * 3);
    const legacyId = `nature/forest/sample-${sample}`;
    const legacy = makeLibrary([legacyId]);
    const fallbackEnvironment = buildVoxelEnvironment(fallbackTerrain, 'artwork', legacy.library);
    const feature = fallbackEnvironment.features.find(entry => entry.tree)!;
    expect(feature.mesh.parent?.userData.assetId).toBe(legacyId);
    disposeTerrain(fallbackEnvironment.root); legacy.library.dispose();
  });

  it('uses the non-snow custom variant when a snow mate is unavailable', () => {
    const terrain = makeTerrain(4, 3, 813);
    terrain.height.fill(1);
    const index = terrain.cols + 1;
    terrain.height[index + 1] = 4;
    terrain.decoration[index] = DECORATION.bush;
    const selection = selectNatureVariant(terrain, index, 'bush');
    expect(selection.snow).toBe(true);
    const assets = makeLibrary([selection.baseId]);
    const layer = buildDecorations(terrain, BASE_SCENE, assets.library);
    expect(layer.root.getObjectByName(`Small map decoration ${selection.baseId}`)).toBeInstanceOf(InstancedMesh);
    expect(layer.root.getObjectByName(`Small map decoration ${selection.snowId}`)).toBeUndefined();
    disposeTerrain(layer.root); assets.library.dispose();
  });

  it('batches custom small props by variant, preserves prefab transforms, removes one tile, and respects asset ownership', () => {
    const terrain = makeTerrain(10, 5, 905);
    terrain.height.fill(2);
    for (let index = 0; index < terrain.decoration.length; index++) {
      terrain.decoration[index] = index % 3 === 0 ? DECORATION.stones : DECORATION.bush;
    }
    const before = [...terrain.decoration];
    const assets = makeLibrary(allAssetIds());
    const layer = buildDecorations(terrain, ROOMIER_SCENE, assets.library);
    const meshes = layer.root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
    expect(meshes.length).toBeLessThan(terrain.decoration.length);
    expect(meshes.length).toBeGreaterThan(1);
    for (const mesh of meshes) {
      expect(mesh.count).toBeGreaterThan(0);
      expect(mesh.geometry.userData.sharedAsset).toBe(true);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) expect(material.userData.sharedAsset).toBe(false);
    }

    let removeIndex = -1, sameVariantPeer = -1, selectedId = '';
    for (let index = 0; index < terrain.decoration.length && sameVariantPeer < 0; index++) {
      const family = terrain.decoration[index] === DECORATION.bush ? 'bush' : 'stones';
      const id = customId(terrain, index, assets.library, family);
      if (!id) continue;
      for (let peer = index + 1; peer < terrain.decoration.length; peer++) {
        const peerFamily = terrain.decoration[peer] === DECORATION.bush ? 'bush' : 'stones';
        if (peerFamily === family && customId(terrain, peer, assets.library, family) === id) {
          removeIndex = index; sameVariantPeer = peer; selectedId = id; break;
        }
      }
    }
    expect(sameVariantPeer).toBeGreaterThan(removeIndex);
    const targetBatch = meshes.find(mesh => mesh.name === `Small map decoration ${selectedId}`)!;
    const family = terrain.decoration[removeIndex] === DECORATION.bush ? 'bush' : 'stones';
    const tileSlot = (index: number): number => terrain.decoration.slice(0, index + 1).reduce((count, kind, at) => {
      if (kind === DECORATION.none) return count;
      const tileFamily = kind === DECORATION.bush ? 'bush' : 'stones';
      return count + (tileFamily === family && customId(terrain, at, assets.library, tileFamily) === selectedId ? 1 : 0);
    }, 0) - 1;
    const removedSlot = tileSlot(removeIndex), peerSlot = tileSlot(sameVariantPeer);
    const beforePeer = new Matrix4(); targetBatch.getMatrixAt(peerSlot, beforePeer);
    const sourceGeoDisposals = assets.geometryDisposals.length;
    layer.removeAt(removeIndex); layer.removeAt(removeIndex);
    const hidden = new Matrix4(); targetBatch.getMatrixAt(removedSlot, hidden);
    expect([hidden.elements[0], hidden.elements[5], hidden.elements[10]]).toEqual([0, 0, 0]);
    const afterPeer = new Matrix4(); targetBatch.getMatrixAt(peerSlot, afterPeer);
    expect(afterPeer.elements).toEqual(beforePeer.elements);
    expect([...terrain.decoration]).toEqual(before);

    const firstInstance = new Matrix4(); targetBatch.getMatrixAt(peerSlot, firstInstance);
    const decompositionPosition = new Vector3(), decompositionRotation = new Quaternion(), decompositionScale = new Vector3();
    firstInstance.decompose(decompositionPosition, decompositionRotation, decompositionScale);
    const peerTile = tileCenter(sameVariantPeer % terrain.cols, Math.floor(sameVariantPeer / terrain.cols));
    const peerGround = visualTileHeight(terrain, sameVariantPeer) / ROOMIER_SCENE.tile;
    expect(decompositionPosition.y).toBeGreaterThan(peerGround);
    expect(decompositionScale.y).toBeGreaterThan(0);
    expect(Math.hypot(decompositionPosition.x - peerTile.x / WORLD.hex,
      decompositionPosition.z - peerTile.y / WORLD.hex)).toBeLessThan(0.2);
    const selection = selectNatureVariant(terrain, sameVariantPeer, family);
    const placementScale = ROOMIER_SCENE.vegetation / ROOMIER_SCENE.tile;
    const expected = new Matrix4().compose(
      new Vector3(peerTile.x / WORLD.hex + selection.offsetX * placementScale, peerGround,
        peerTile.y / WORLD.hex + selection.offsetZ * placementScale),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), selection.rotation),
      new Vector3(placementScale * selection.size * selection.width,
        placementScale * selection.size * selection.height, placementScale * selection.size),
    ).multiply(new Matrix4().makeTranslation(0.03, 0.1, -0.02));
    firstInstance.elements.forEach((value, element) => expect(value).toBeCloseTo(expected.elements[element], 5));
    expect(decompositionPosition.y - decompositionScale.y * 0.1).toBeCloseTo(peerGround, 5);

    disposeTerrain(layer.root);
    expect(assets.geometryDisposals.length).toBe(sourceGeoDisposals);
    assets.library.dispose();
    expect(assets.geometryDisposals.length).toBeGreaterThan(sourceGeoDisposals);
  });
});
