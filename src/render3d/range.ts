import { Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { visualTileHeight, SURFACE_MAX_OFFSET } from '../camera-preview/surface';
import { tileCenter } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';
import type { RunState, Tower } from '../sim/state';
import { computeStats, upgradeOptions } from '../sim/stats';
import { WORLD } from '../data/balance';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

export type UpgradePath = 'tier' | 'a' | 'b';

/** Preview the same progression fields gameplay upgrades use, without spending gold or changing t. */
export function upgradeRange(s: RunState, t: Tower, path: UpgradePath): number | null {
  if (t.hero) return null;
  const option = upgradeOptions(t, s.mods).find(option => option.path === path);
  if (!option) return null;
  const candidate = { ...t };
  if (option.path === 'tier') candidate.tier = option.level;
  else { candidate.fork = option.path; candidate.forkTier = option.level; }
  return computeStats(candidate, s.mods).range;
}

/** 1 = blue current coverage; 2 = green additional upgrade coverage. Tile-centre semantics. */
export function rangeTileKinds(terrain: Terrain, x: number, y: number, current: number, extended: number | null, out = new Uint8Array(terrain.height.length)): Uint8Array {
  const currentSq = current * current;
  const extendedSq = Math.max(current, extended ?? current) ** 2;
  for (let index = 0; index < terrain.height.length; index++) {
    const center = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
    const distanceSq = (center.x - x) ** 2 + (center.y - y) ** 2;
    out[index] = distanceSq <= currentSq ? 1 : extended !== null && distanceSq <= extendedSq ? 2 : 0;
  }
  return out;
}

const BLUE = new Color('#459fe5');
const GREEN = new Color('#66cf82');

export class RangeTiles {
  readonly root = new Group();
  private mesh: InstancedMesh | null = null;
  private terrain: Terrain | null = null;
  private signature = '';
  private kinds = new Uint8Array(0);
  private matrix = new Matrix4();

  constructor(private proportions: SceneProportions = BASE_SCENE) { this.root.name = 'Tile range highlights'; this.root.visible = false; }

  show(terrain: Terrain, x: number, y: number, current: number, extended: number | null): void {
    this.root.visible = true;
    const signature = `${x}/${y}/${current}/${extended}`;
    if (this.terrain === terrain && this.signature === signature) return;
    this.signature = signature;
    this.terrain = terrain;
    if (!this.mesh || this.kinds.length !== terrain.height.length) {
      if (this.mesh) { this.root.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as MeshBasicMaterial).dispose(); this.mesh.dispose(); }
      this.kinds = new Uint8Array(terrain.height.length);
      this.mesh = new InstancedMesh(new CylinderGeometry(0.94, 0.94, 0.014, 6), new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, depthWrite: false }), terrain.height.length);
      this.mesh.name = 'Blue current range and green upgrade extension';
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 3;
      this.root.add(this.mesh);
    }
    rangeTileKinds(terrain, x, y, current, extended, this.kinds);
    let count = 0;
    for (let index = 0; index < this.kinds.length; index++) {
      if (!this.kinds[index]) continue;
      const position = tileCenter(index % terrain.cols, Math.floor(index / terrain.cols));
      this.matrix.makeTranslation(position.x / WORLD.hex,
        (visualTileHeight(terrain, index) + SURFACE_MAX_OFFSET + 0.02) / this.proportions.tile, position.y / WORLD.hex);
      this.mesh.setMatrixAt(count, this.matrix);
      this.mesh.setColorAt(count++, this.kinds[index] === 1 ? BLUE : GREEN);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.root.userData.currentTiles = this.kinds.reduce((n, kind) => n + Number(kind === 1), 0);
    this.root.userData.upgradeTiles = this.kinds.reduce((n, kind) => n + Number(kind === 2), 0);
  }

  hide(): void { this.root.visible = false; }
}
