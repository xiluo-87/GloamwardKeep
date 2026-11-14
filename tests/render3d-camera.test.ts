import { Box3, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/data/balance';
import { GameCamera3D } from '../src/render3d/camera';
import { buildVoxelEnvironment } from '../src/camera-preview/environment';
import { disposeTerrain, tilePosition } from '../src/camera-preview/terrain';
import { DIRECTIONS, TILTS } from '../src/camera-preview/camera';
import { generateMap, type Terrain } from '../src/sim/mapgen';

function board(terrain: Terrain): { tiles: InstancedMesh; bounds: Box3 } {
  const tiles = new InstancedMesh(new CylinderGeometry(0.985, 0.985, 1, 6), new MeshStandardMaterial(), terrain.height.length);
  const matrix = new Matrix4();
  const bounds = new Box3();
  for (let index = 0; index < terrain.height.length; index++) {
    const position = tilePosition(terrain, index);
    const h = position.y + 0.14;
    matrix.makeScale(1, h, 1).setPosition(position.x, position.y - h / 2, position.z);
    tiles.setMatrixAt(index, matrix);
    bounds.expandByPoint(new Vector3(position.x - 1, -0.14, position.z - 1));
    bounds.expandByPoint(new Vector3(position.x + 1, position.y, position.z + 1));
  }
  tiles.instanceMatrix.needsUpdate = true;
  tiles.updateMatrixWorld(true);
  return { tiles, bounds };
}

describe('GameCamera3D', () => {
  it.each(['meadow', 'highlands', 'canyon'] as const)('%s fits and picks raised tiles by original instance ID', (map) => {
    const terrain = generateMap(map, 5);
    const { tiles, bounds } = board(terrain);
    const camera = new GameCamera3D();
    camera.layout(1000, 700, { top: 80, bottom: 60, left: 40, right: 210 });
    camera.setTerrain(terrain, bounds);
    let raisedHit = false;
    terrain.height.forEach((height, index) => {
      if (!height || raisedHit) return;
      const screen = camera.tileToScreen(index % terrain.cols, Math.floor(index / terrain.cols));
      const tile = camera.screenToTile(screen.x, screen.y, tiles);
      if (tile) {
        const ndc = new Vector2(screen.x / 1000 * 2 - 1, 1 - screen.y / 700 * 2);
        const raycaster = new Raycaster();
        raycaster.setFromCamera(ndc, camera.camera);
        const instanceId = raycaster.intersectObject(tiles, false)[0]?.instanceId;
        expect(instanceId).toBeDefined();
        expect(tile).toEqual({ col: instanceId! % terrain.cols, row: Math.floor(instanceId! / terrain.cols) });
        const at = tile.row * terrain.cols + tile.col;
        if (terrain.height[at] === 0) return;
        expect(at).toBeLessThan(terrain.height.length);
        expect(camera.tileToScreen(tile.col, tile.row).r).toBeGreaterThan(0);
        raisedHit = true;
      }
    });
    expect(raisedHit).toBe(true);
    tiles.geometry.dispose();
    (tiles.material as MeshStandardMaterial).dispose();
  });

  it('fits landscape and portrait board corners inside the inset free area', () => {
    const terrain = generateMap('highlands', 5);
    const { tiles, bounds } = board(terrain);
    const camera = new GameCamera3D();
    camera.setTerrain(terrain, bounds);
    for (const [width, height, insets] of [
      [1280, 720, { top: 60, bottom: 90, left: 240, right: 60 }],
      [390, 844, { top: 110, bottom: 100, left: 8, right: 8 }],
    ] as const) {
      camera.layout(width, height, insets);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new Vector3(x, y, z).project(camera.camera);
        const sx = (projected.x + 1) * width / 2;
        const sy = (1 - projected.y) * height / 2;
        expect(sx).toBeGreaterThanOrEqual(insets.left - 1);
        expect(sx).toBeLessThanOrEqual(width - insets.right + 1);
        expect(sy).toBeGreaterThanOrEqual(insets.top - 1);
        expect(sy).toBeLessThanOrEqual(height - insets.bottom + 1);
      }
    }
    tiles.geometry.dispose();
    (tiles.material as MeshStandardMaterial).dispose();
  });

  it('keeps a raised tile anchor at the same CSS point while zooming without camera rotation', () => {
    const terrain = generateMap('canyon', 5);
    const { tiles, bounds } = board(terrain);
    const camera = new GameCamera3D();
    camera.layout(900, 600, { top: 50, bottom: 70, left: 30, right: 180 });
    camera.setTerrain(terrain, bounds);
    const index = terrain.height.findIndex((height) => height > 0);
    const screen = camera.tileToScreen(index % terrain.cols, Math.floor(index / terrain.cols));
    const ndc = new Vector2(screen.x / 900 * 2 - 1, 1 - screen.y / 600 * 2);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera.camera);
    const anchor = raycaster.intersectObject(tiles, false)[0]?.point;
    expect(anchor).toBeDefined();
    const direction = camera.camera.getWorldDirection(new Vector3());
    const before = anchor!.clone().project(camera.camera);
    camera.zoomAt(screen.x, screen.y, 2, tiles);
    const after = anchor!.clone().project(camera.camera);
    expect(camera.zoom).toBe(2);
    expect((after.x - before.x) * 450).toBeCloseTo(0, 4);
    expect((after.y - before.y) * 300).toBeCloseTo(0, 4);
    expect(camera.camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-8);
    tiles.geometry.dispose();
    (tiles.material as MeshStandardMaterial).dispose();
  });

  it('maps a raised surface hit back to simulation world pixels', () => {
    const terrain = generateMap('meadow', 5);
    const { tiles, bounds } = board(terrain);
    const camera = new GameCamera3D();
    camera.layout(900, 600);
    camera.setTerrain(terrain, bounds);
    const index = terrain.height.findIndex((height) => height > 0);
    const col = index % terrain.cols, row = Math.floor(index / terrain.cols);
    const screen = camera.tileToScreen(col, row);
    const world = camera.screenToWorld(screen.x, screen.y, tiles);
    const position = tilePosition(terrain, index);
    expect(world.x).toBeCloseTo(position.x * WORLD.hex, 4);
    expect(world.y).toBeCloseTo(position.z * WORLD.hex, 4);
    tiles.geometry.dispose();
    (tiles.material as MeshStandardMaterial).dispose();
  });

  it.each(['meadow', 'highlands', 'canyon'] as const)('frames all 16 camera presets and keeps raised-tile picking after zoom on %s', (map) => {
    const terrain = generateMap(map, 19);
    const environment = buildVoxelEnvironment(terrain);
    const bounds = environment.bounds.clone(); // Includes the keep and gates as well as terrain props.
    bounds.max.y += 2.2; // Reserve room for the tallest mob plus flyer elevation.
    const camera = new GameCamera3D();
    const width = 1280, height = 720;
    const insets = { top: 36, bottom: 92, left: 160, right: 64 };
    camera.layout(width, height, insets);
    camera.setTerrain(terrain, bounds);

    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      for (let tilt = 0; tilt < TILTS.length; tilt++) {
        camera.configure(direction, tilt);
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera.camera);
          const sx = (projected.x + 1) * width / 2, sy = (1 - projected.y) * height / 2;
          expect(sx).toBeGreaterThanOrEqual(insets.left - 1);
          expect(sx).toBeLessThanOrEqual(width - insets.right + 1);
          expect(sy).toBeGreaterThanOrEqual(insets.top - 1);
          expect(sy).toBeLessThanOrEqual(height - insets.bottom + 1);
        }

        let picked: { col: number; row: number } | null = null;
        for (let index = 0; index < terrain.height.length && !picked; index++) {
          if (terrain.height[index] === 0) continue;
          const col = index % terrain.cols, row = Math.floor(index / terrain.cols);
          const screen = camera.tileToScreen(col, row);
          const hit = camera.screenToTile(screen.x, screen.y, environment.tiles);
          if (hit?.col === col && hit.row === row) picked = hit;
        }
        expect(picked).not.toBeNull();
        const screen = camera.tileToScreen(picked!.col, picked!.row);
        camera.zoomAt(screen.x, screen.y, 2, environment.tiles);
        const zoomed = camera.tileToScreen(picked!.col, picked!.row);
        expect(camera.screenToTile(zoomed.x, zoomed.y, environment.tiles)).toEqual(picked);
      }
    }
    disposeTerrain(environment.root);
  });
});
