import { Group, InstancedMesh, Object3D, OrthographicCamera, Raycaster, Vector2 } from 'three';
import { WORLD } from '../data/balance';
import { pixelToTile } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';

function towerTile(object: Object3D): { col: number; row: number } | null {
  for (let at: Object3D | null = object; at; at = at.parent) {
    const tile = at.userData.tile as { col?: unknown; row?: unknown } | undefined;
    if (tile && Number.isInteger(tile.col) && Number.isInteger(tile.row)) {
      return { col: tile.col as number, row: tile.row as number };
    }
  }
  return null;
}

/** Pick the nearest live tower, terrain tile or static keep/gate from CSS canvas coordinates. */
export function pickWorldTile(
  camera: OrthographicCamera,
  width: number,
  height: number,
  x: number,
  y: number,
  terrain: Terrain,
  tiles: InstancedMesh,
  structures: InstancedMesh,
  towerRoots: readonly Group[],
): { col: number; row: number } | null {
  if (width <= 0 || height <= 0) return null;
  const ndc = new Vector2(x / width * 2 - 1, 1 - y / height * 2);
  camera.updateMatrixWorld(true);
  tiles.updateWorldMatrix(true, false);
  structures.updateWorldMatrix(true, false);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([tiles, structures, ...towerRoots], true);
  for (const hit of hits) {
    const tower = towerTile(hit.object);
    if (tower) return tower;
    if (hit.object === tiles && hit.instanceId !== undefined) {
      const index = hit.instanceId;
      if (index >= 0 && index < terrain.cols * terrain.rows) {
        return { col: index % terrain.cols, row: Math.floor(index / terrain.cols) };
      }
    }
    if (hit.object === structures) {
      const tile = pixelToTile(hit.point.x * WORLD.hex, hit.point.z * WORLD.hex, terrain.cols, terrain.rows);
      if (tile) return tile;
    }
  }
  return null;
}
