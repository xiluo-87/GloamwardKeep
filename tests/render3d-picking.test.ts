import {
  BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  OrthographicCamera, Raycaster, Vector2, Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { tilePosition } from '../src/camera-preview/terrain';
import { pickWorldTile } from '../src/render3d/picking';
import type { Terrain } from '../src/sim/mapgen';

function flatTerrain(cols = 7, rows = 7): Terrain {
  return {
    cols, rows, height: new Uint8Array(cols * rows), feature: new Uint8Array(cols * rows), decoration: new Uint8Array(cols * rows),
    spawns: [], goal: [cols - 1, rows - 1], gaps: [], seed: 1,
  };
}

function tileMesh(terrain: Terrain): InstancedMesh {
  const mesh = new InstancedMesh(new CylinderGeometry(0.985, 0.985, 1, 6), new MeshBasicMaterial(), terrain.height.length);
  const matrix = new Matrix4();
  for (let index = 0; index < terrain.height.length; index++) {
    const p = tilePosition(terrain, index);
    const h = p.y + 0.14;
    matrix.makeScale(1, h, 1).setPosition(p.x, p.y - h / 2, p.z);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = false;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function emptyStructures(): InstancedMesh {
  return new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 0);
}

function cameraAt(target: Vector3, position: Vector3): OrthographicCamera {
  const camera = new OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

function screen(camera: OrthographicCamera, world: Vector3, width = 800, height = 600): { x: number; y: number } {
  const p = world.clone().project(camera);
  return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
}

function dispose(mesh: InstancedMesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  for (const m of Array.isArray(material) ? material : [material]) m.dispose();
}

describe('live 3D tile picking', () => {
  it('uses tower-root tile metadata when a tall archer overlays another ground tile', () => {
    const terrain = flatTerrain();
    const tiles = tileMesh(terrain), structures = emptyStructures();
    const col = 3, row = 5;
    const base = tilePosition(terrain, row * terrain.cols + col);
    const root = new Group();
    root.userData.tile = { col, row };
    root.position.copy(base);
    const archer = new Mesh(new BoxGeometry(0.8, 3.2, 0.8), new MeshBasicMaterial());
    archer.position.y = 1.6;
    root.add(archer);
    root.updateMatrixWorld(true);
    const camera = cameraAt(base.clone().add(new Vector3(0, 1, 0)), base.clone().add(new Vector3(0, 8, 10)));
    const point = screen(camera, base.clone().add(new Vector3(0, 2.1, 0)));
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(point.x / 800 * 2 - 1, 1 - point.y / 600 * 2), camera);
    const groundHit = ray.intersectObject(tiles, false)[0];
    expect(groundHit?.instanceId).toBeDefined();
    expect(groundHit!.instanceId).not.toBe(row * terrain.cols + col);
    expect(pickWorldTile(camera, 800, 600, point.x, point.y, terrain, tiles, structures, [root])).toEqual({ col, row });
    dispose(tiles); dispose(structures); archer.geometry.dispose(); (archer.material as MeshBasicMaterial).dispose();
  });

  it('lets a nearer raised terrain tile occlude a low tower behind it', () => {
    const terrain = flatTerrain();
    const towerCol = 3, towerRow = 1, raisedCol = 3, raisedRow = 3;
    terrain.height[raisedRow * terrain.cols + raisedCol] = 4;
    const tiles = tileMesh(terrain), structures = emptyStructures();
    const base = tilePosition(terrain, towerRow * terrain.cols + towerCol);
    const root = new Group();
    root.userData.tile = { col: towerCol, row: towerRow };
    root.position.copy(base);
    const tower = new Mesh(new BoxGeometry(0.7, 0.35, 0.7), new MeshBasicMaterial());
    tower.position.y = 0.175;
    root.add(tower);
    root.updateMatrixWorld(true);
    const camera = cameraAt(base.clone().add(new Vector3(0, 0, 1)), base.clone().add(new Vector3(0, 3, 12)));
    const point = screen(camera, base.clone().add(new Vector3(0, 0.25, 0)));
    const picked = pickWorldTile(camera, 800, 600, point.x, point.y, terrain, tiles, structures, [root]);
    expect(picked).toEqual({ col: raisedCol, row: raisedRow });
    dispose(tiles); dispose(structures); tower.geometry.dispose(); (tower.material as MeshBasicMaterial).dispose();
  });

  it('returns original hidden tile instance IDs and null for off-board points', () => {
    const terrain = flatTerrain();
    const tiles = tileMesh(terrain), structures = emptyStructures();
    const camera = cameraAt(new Vector3(4, 0, 5), new Vector3(4, 12, 5));
    const index = 2 * terrain.cols + 4;
    const p = tilePosition(terrain, index);
    const point = screen(camera, p);
    expect(pickWorldTile(camera, 800, 600, point.x, point.y, terrain, tiles, structures, [])).toEqual({ col: 4, row: 2 });
    expect(pickWorldTile(camera, 800, 600, -1000, -1000, terrain, tiles, structures, [])).toBeNull();
    dispose(tiles); dispose(structures);
  });

  it('maps a visible static keep/gate instance hit to its containing tile', () => {
    const terrain = flatTerrain();
    const tiles = tileMesh(terrain);
    const structures = new InstancedMesh(new BoxGeometry(0.8, 1.4, 0.8), new MeshBasicMaterial(), 1);
    const targetCol = 4, targetRow = 2;
    const base = tilePosition(terrain, targetRow * terrain.cols + targetCol);
    structures.setMatrixAt(0, new Matrix4().makeTranslation(base.x, 0.7, base.z));
    structures.instanceMatrix.needsUpdate = true;
    structures.updateMatrixWorld(true);
    const camera = cameraAt(base.clone().add(new Vector3(0, 0.5, 0)), base.clone().add(new Vector3(0, 8, 10)));
    const point = screen(camera, base.clone().add(new Vector3(0, 1.3, 0)));
    expect(pickWorldTile(camera, 800, 600, point.x, point.y, terrain, tiles, structures, [])).toEqual({ col: targetCol, row: targetRow });
    dispose(tiles); dispose(structures);
  });
});
