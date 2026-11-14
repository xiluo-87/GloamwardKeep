import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { ContentAssetLibrary } from '../src/render3d/asset-library';
import { buildVoxelEnvironment } from '../src/camera-preview/environment';
import { disposeTerrain, tilePosition } from '../src/camera-preview/terrain';
import { generateMap, FEATURE } from '../src/sim/mapgen';
import { visualTileHeight } from '../src/camera-preview/surface';
import { buildTowerVisual } from '../src/render3d/towers';

function prefabScene(ids: readonly string[]): { scene: Group; geometries: BoxGeometry[]; materials: MeshStandardMaterial[] } {
  const scene = new Group();
  const geometries: BoxGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  for (const id of ids) {
    const root = new Group(); root.name = id;
    const base = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ color: '#91a272' }));
    base.name = 'base';
    root.add(base);
    geometries.push(base.geometry as BoxGeometry);
    materials.push(base.material as MeshStandardMaterial);
    if (id.startsWith('tower/archer/')) {
      const aim = new Mesh(new BoxGeometry(0.1, 0.5, 0.1), new MeshStandardMaterial({ color: '#ad8149' }));
      aim.name = 'aim-bowman';
      root.add(aim);
      geometries.push(aim.geometry as BoxGeometry);
      materials.push(aim.material as MeshStandardMaterial);
    }
    scene.add(root);
  }
  return { scene, geometries, materials };
}

describe('shared static content library', () => {
  it('clones named hierarchies, shares geometry, and owns disposal', () => {
    const source = prefabScene(['tower/archer/tier-1']);
    const library = new ContentAssetLibrary(source.scene);
    const shared = library.instantiate('tower/archer/tier-1')!;
    const mutable = library.instantiate('tower/archer/tier-1', true)!;
    const sourceMeshes: Mesh[] = [];
    const sharedMeshes: Mesh[] = [];
    const mutableMeshes: Mesh[] = [];
    source.scene.traverse(object => { if (object instanceof Mesh) sourceMeshes.push(object); });
    shared.traverse(object => { if (object instanceof Mesh) sharedMeshes.push(object); });
    mutable.traverse(object => { if (object instanceof Mesh) mutableMeshes.push(object); });
    expect(sharedMeshes.map(mesh => mesh.name)).toEqual(['base', 'aim-bowman']);
    expect(sharedMeshes[0].geometry).toBe(sourceMeshes[0].geometry);
    expect(sharedMeshes[0].material).toBe(sourceMeshes[0].material);
    expect(mutableMeshes[0].geometry).toBe(sourceMeshes[0].geometry);
    expect(mutableMeshes[0].material).not.toBe(sourceMeshes[0].material);

    const geometryDisposed = vi.fn();
    const sourceMaterialDisposed = vi.fn();
    const cloneMaterialDisposed = vi.fn();
    source.geometries.forEach(geometry => geometry.addEventListener('dispose', geometryDisposed));
    source.materials.forEach(material => material.addEventListener('dispose', sourceMaterialDisposed));
    (mutableMeshes[0].material as MeshStandardMaterial).addEventListener('dispose', cloneMaterialDisposed);
    disposeTerrain(shared);
    disposeTerrain(mutable);
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(sourceMaterialDisposed).not.toHaveBeenCalled();
    expect(cloneMaterialDisposed).toHaveBeenCalledOnce();
    library.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(2);
    expect(sourceMaterialDisposed).toHaveBeenCalledTimes(2);
    expect(library.ready).toBe(false);
  });

  it('uses archer base and separate rotating bowman nodes when a prefab is available', () => {
    const source = prefabScene(['tower/archer/tier-1']);
    const library = new ContentAssetLibrary(source.scene);
    const visual = buildTowerVisual({ type: 'archer', tier: 1, fork: 0, forkTier: 0, heroLevel: 1, skills: [] }, false, library);
    expect(visual.root.userData.assetId).toBe('tower/archer/tier-1');
    expect(visual.bowman?.name).toBe('aim-bowman');
    expect(visual.root.children.some(child => child.name === 'base')).toBe(true);
    expect(visual.bowman?.children[0].name).toBe('aim-bowman-mesh');
    disposeTerrain(visual.root);
    library.dispose();
  });

  it('normalizes and instantiates every root and child in the real Blender GLB', async () => {
    const file = readFileSync(new URL('../assets-src/models/library/library.glb', import.meta.url));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const roots = gltf.scene.children.map(root => root.userData.asset_id as string).filter(Boolean);
    const library = new ContentAssetLibrary(gltf.scene);
    expect(roots).toHaveLength(110);
    expect(new Set(roots).size).toBe(110);
    expect([...library.ids].sort()).toEqual([...roots].sort());
    for (const id of roots) expect(library.instantiate(id)).not.toBeNull();

    const archer = library.instantiate('tower/archer/tier-3')!;
    expect(archer.name).toBe('tower/archer/tier-3');
    expect(archer.children.map(child => child.name).sort()).toEqual(['aim-bowman', 'base']);

    const manifest = JSON.parse(readFileSync(new URL('../assets-src/content-manifest.json', import.meta.url), 'utf8')) as {
      assets: { id: string; parts: { x: number; y: number; z: number; w: number; h: number; d: number }[]; attachments?: { id: string; parts: { x: number; y: number; z: number; w: number; h: number; d: number }[] }[] }[];
    };
    expect(manifest.assets).toHaveLength(100);
    const actual = new Box3();
    for (const entry of manifest.assets) {
      const instance = library.instantiate(entry.id)!;
      instance.updateMatrixWorld(true);
      actual.setFromObject(instance);
      const parts = [...entry.parts, ...(entry.attachments ?? []).flatMap(attachment => attachment.parts)];
      const expectedMin = new Vector3(
        Math.min(...parts.map(part => part.x - part.w / 2)),
        Math.min(...parts.map(part => part.y - part.h / 2)),
        Math.min(...parts.map(part => part.z - part.d / 2)),
      );
      const expectedMax = new Vector3(
        Math.max(...parts.map(part => part.x + part.w / 2)),
        Math.max(...parts.map(part => part.y + part.h / 2)),
        Math.max(...parts.map(part => part.z + part.d / 2)),
      );
      expect(actual.min.distanceTo(expectedMin), `${entry.id} minimum bounds`).toBeLessThan(0.015);
      expect(actual.max.distanceTo(expectedMax), `${entry.id} maximum bounds`).toBeLessThan(0.015);
      disposeTerrain(instance);
    }

    const archerAim = archer.getObjectByName('aim-bowman')!;
    const aimBounds = new Box3().setFromObject(archerAim);
    expect(aimBounds.max.y).toBeGreaterThan(0.5);
    expect(aimBounds.max.z - aimBounds.min.z).toBeGreaterThan(0.1);
    library.dispose();
  });

  it('places levelled keep, gates, and varied nature prefabs on visual tile heights', () => {
    const ids = [
      'keep/level-2', 'gate/level-2',
      ...[1, 2, 3].flatMap(index => [`nature/forest/sample-${index}`, `nature/rocks/sample-${index}`]),
    ];
    const source = prefabScene(ids);
    const library = new ContentAssetLibrary(source.scene);
    const terrain = generateMap('meadow', 0);
    const environment = buildVoxelEnvironment(terrain, 'artwork', library, 2);
    const goalIndex = terrain.goal[1] * terrain.cols + terrain.goal[0];
    const keep = environment.structures.children.find(child => child.name === 'Keep level 2')!;
    const keepAt = tilePosition(terrain, goalIndex);
    expect(keep.position.toArray()).toEqual(keepAt.toArray());
    expect(keep.userData.tile).toEqual({ col: terrain.goal[0], row: terrain.goal[1] });
    expect(environment.landmarks.find(mark => mark.kind === 'keep')!.position.y).toBeGreaterThan(keepAt.y);

    const gate = environment.structures.children.find(child => child.name.startsWith('Gate 1'))!;
    const [gateCol, gateRow] = terrain.spawns[0];
    expect(gate.position.toArray()).toEqual(tilePosition(terrain, gateRow * terrain.cols + gateCol).toArray());
    expect(gate.userData.tile).toEqual({ col: gateCol, row: gateRow });

    const expected = Array.from(terrain.feature).filter(value => value === FEATURE.forest || value === FEATURE.rocks).length;
    expect(environment.features.length).toBe(expected);
    for (const feature of environment.features) {
      const anchor = feature.mesh.parent!;
      const index = Number(anchor.name.match(/tile (\d+)$/)?.[1]);
      expect(Number.isInteger(index)).toBe(true);
      expect(anchor.position.y).toBe(visualTileHeight(terrain, index));
      expect(anchor.userData.assetId).toMatch(/^nature\//);
      expect(feature.material.transparent).toBe(true);
      expect(feature.material.userData.sharedAsset).toBe(false);
      expect(feature.bounds.isEmpty()).toBe(false);
    }
    disposeTerrain(environment.root);
    library.dispose();
  });
});
