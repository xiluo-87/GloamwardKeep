import { Box3, InstancedMesh, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { WORLD } from '../data/balance';
import { tilePosition } from '../camera-preview/terrain';
import { DIRECTIONS, fitCamera, TILTS, zoomCameraAt } from '../camera-preview/camera';
import type { Terrain } from '../sim/mapgen';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

export interface CameraInsets { top: number; bottom: number; left: number; right: number }

const EMPTY_INSETS: CameraInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Orthographic world camera for the initial Three.js game slice. It intentionally has no pan API. */
export class GameCamera3D {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private terrain: Terrain | null = null;
  private bounds: Box3 | null = null;
  private width = 1;
  private height = 1;
  private insets: CameraInsets = { ...EMPTY_INSETS };

  constructor(private directionIndex = 0, private tiltIndex = 1, private proportions: SceneProportions = BASE_SCENE) {}

  configure(directionIndex: number, tiltIndex: number): void {
    if (Number.isInteger(directionIndex) && directionIndex >= 0 && directionIndex < DIRECTIONS.length) this.directionIndex = directionIndex;
    if (Number.isInteger(tiltIndex) && tiltIndex >= 0 && tiltIndex < TILTS.length) this.tiltIndex = tiltIndex;
    this.fitBoard();
  }

  setTerrain(terrain: Terrain, bounds: Box3): void {
    this.terrain = terrain;
    this.bounds = bounds.clone();
    this.fitBoard();
  }

  /** Layout uses a full-canvas projection and reserves the inset rectangle for the board. */
  layout(width: number, height: number, insets: CameraInsets = EMPTY_INSETS): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = {
      top: Math.max(0, insets.top), bottom: Math.max(0, insets.bottom),
      left: Math.max(0, insets.left), right: Math.max(0, insets.right),
    };
    this.fitBoard();
  }

  fitBoard(): void {
    if (!this.bounds) return;
    const freeWidth = Math.max(1, this.width - this.insets.left - this.insets.right);
    const freeHeight = Math.max(1, this.height - this.insets.top - this.insets.bottom);
    fitCamera(this.camera, this.bounds, freeWidth / freeHeight,
      DIRECTIONS[this.directionIndex].azimuth, TILTS[this.tiltIndex]);

    const halfHeight = this.camera.top;
    const scale = freeHeight / (2 * halfHeight);
    const centerOffsetX = (this.insets.left - this.insets.right) / 2;
    const centerOffsetY = (this.insets.top - this.insets.bottom) / 2;
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.camera.left = -halfHeight * this.width / freeHeight;
    this.camera.right = halfHeight * this.width / freeHeight;
    this.camera.top = halfHeight * this.height / freeHeight;
    this.camera.bottom = -halfHeight * this.height / freeHeight;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.position.addScaledVector(right, -centerOffsetX / scale).addScaledVector(up, centerOffsetY / scale);
    this.camera.updateMatrixWorld(true);
  }

  get zoom(): number { return this.camera.zoom; }

  zoomAt(x: number, y: number, factor: number, tiles: InstancedMesh): void {
    const point = this.ndc(x, y);
    const ray = this.rayAt(point);
    tiles.updateWorldMatrix(true, false);
    const anchor = ray.intersectObject(tiles, false)[0]?.point
      ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    if (!anchor) return;
    zoomCameraAt(this.camera, point, anchor, factor);
  }

  screenToTile(x: number, y: number, tiles: InstancedMesh): { col: number; row: number } | null {
    if (!this.terrain) return null;
    tiles.updateWorldMatrix(true, false);
    const hit = this.rayAt(this.ndc(x, y)).intersectObject(tiles, false)[0];
    if (hit?.instanceId === undefined) return null;
    const index = hit.instanceId;
    return index >= 0 && index < this.terrain.cols * this.terrain.rows
      ? { col: index % this.terrain.cols, row: Math.floor(index / this.terrain.cols) }
      : null;
  }

  /** Convert a CSS canvas point to the simulation's world-pixel XY coordinates. */
  screenToWorld(x: number, y: number, tiles: InstancedMesh): { x: number; y: number } {
    const ray = this.rayAt(this.ndc(x, y));
    tiles.updateWorldMatrix(true, false);
    const surface = ray.intersectObject(tiles, false)[0]?.point;
    const point = surface ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    if (!point) return { x: 0, y: 0 };
    return { x: point.x * WORLD.hex, y: point.z * WORLD.hex };
  }

  tileToScreen(col: number, row: number): { x: number; y: number; r: number } {
    if (!this.terrain) return { x: 0, y: 0, r: 0 };
    this.camera.updateMatrixWorld(true);
    const index = row * this.terrain.cols + col;
    const tile = tilePosition(this.terrain, index);
    tile.y /= this.proportions.tile;
    const position = tile.clone().project(this.camera);
    const x = (position.x + 1) * this.width / 2;
    const y = (1 - position.y) * this.height / 2;
    const center = new Vector3(x, y, 0);
    let radius = 0;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const vertex = new Vector3(
        tile.x + Math.cos(angle), tile.y, tile.z + Math.sin(angle),
      ).project(this.camera);
      const vx = (vertex.x + 1) * this.width / 2;
      const vy = (1 - vertex.y) * this.height / 2;
      radius = Math.max(radius, Math.hypot(vx - center.x, vy - center.y));
    }
    return { x, y, r: radius };
  }

  private ndc(x: number, y: number): Vector2 {
    return new Vector2(x / this.width * 2 - 1, 1 - y / this.height * 2);
  }

  private rayAt(point: Vector2): Raycaster {
    this.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(point, this.camera);
    return raycaster;
  }
}
