// Shared world mapping and GPU cleanup for the map studies.
import { Box3, BufferGeometry, Group, InstancedMesh, Line, LineLoop, Material, Mesh, Object3D, Points, Skeleton, SkinnedMesh, Texture, Vector3 } from 'three';
import { WORLD } from '../data/balance';
import { tileCenter } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';
import { visualTileHeight } from './surface';
export { TERRAIN_RISE } from './surface';

export interface Landmark { label: string; kind: 'gate' | 'keep'; position: Vector3 }
export interface PreviewTerrain {
  root: Group;
  tiles: InstancedMesh;
  bounds: Box3;
  landmarks: Landmark[];
  highlight: LineLoop;
}

export function tilePosition(terrain: Terrain, index: number): Vector3 {
  const p = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
  return new Vector3(p.x / WORLD.hex, visualTileHeight(terrain, index), p.y / WORLD.hex);
}

export function disposeTerrain(root: Object3D, disposeShared = false): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const skeletons = new Set<Skeleton>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
      if (disposeShared || !object.geometry.userData.sharedAsset) geometries.add(object.geometry);
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!disposeShared && mat.userData.sharedAsset) continue;
        materials.add(mat);
        if (disposeShared || !mat.userData.sharedTextures) {
          for (const value of Object.values(mat)) if (value instanceof Texture) textures.add(value);
        }
      }
    }
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((mat) => mat.dispose());
  textures.forEach((texture) => texture.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}
