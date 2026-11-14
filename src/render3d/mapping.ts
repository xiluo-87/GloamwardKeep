import { Vector3 } from 'three';
import { TERRAIN_RISE } from '../camera-preview/terrain';
import { groundHeightAt, visualTileHeight } from '../camera-preview/surface';
import type { Terrain } from '../sim/mapgen';
import { WORLD } from '../data/balance';
import type { Enemy, Projectile, Tower } from '../sim/state';
import { enemyGroundingOffset, enemyHeight, EnemyPresentation } from './model-scale';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

/** Sim X/Y map to scene X/Z, at one scene unit per WORLD.hex pixels; Y is visual elevation. */
export function groundPoint(x: number, y: number, elevation = 0, out = new Vector3()): Vector3 {
  return out.set(x / WORLD.hex, elevation, y / WORLD.hex);
}

export function muzzleHeight(t: Tower | null, terrain?: Terrain, proportions: SceneProportions = BASE_SCENE): number {
  const buildingScale = proportions.buildings / Math.max(1e-6, proportions.tile);
  const terrainScale = 1 / Math.max(1e-6, proportions.tile);
  return t ? (terrain ? visualTileHeight(terrain, t.ty * terrain.cols + t.tx) : t.height * TERRAIN_RISE) * terrainScale
    + (t.type === 'archer' ? 1.68 : t.hero ? 0.65 : 1.05) * buildingScale : 0.7 * buildingScale;
}

/** A recycled enemy pool object is not still this projectile's target. */
export function currentProjectileTarget(p: Projectile): Enemy | null {
  const target = p.target;
  return target && target.uid === p.targetUid && !target.dead ? target : null;
}

/** Render-space center of a pooled enemy's body, sampled on the same ground as its actor. */
export function enemyBodyCenterHeight(enemy: Enemy, terrain: Terrain, x = enemy.x + enemy.ox,
  y = enemy.y + enemy.oy, proportions: SceneProportions = BASE_SCENE,
  presentation?: EnemyPresentation): number {
  const sceneX = x / WORLD.hex, sceneZ = y / WORLD.hex;
  return groundHeightAt(terrain, sceneX, sceneZ) / Math.max(1e-6, proportions.tile)
    + (enemy.def.flying ? 0.8 / Math.max(1e-6, proportions.tile) : 0)
    + enemyGroundingOffset(enemy.def.id, enemy.uid, proportions, presentation)
    + enemyHeight(enemy.def.id, enemy.uid, proportions) * 0.48;
}

/**
 * Keep the simulation's legacy -14/-16 launch offsets and flight/hit timing untouched.
 * Fade the render-only correction from the model attachment to the real projectile target.
 */
export function projectilePoint(p: Projectile, alpha: number, out = new Vector3(), terrain?: Terrain,
  proportions: SceneProportions = BASE_SCENE, presentation?: EnemyPresentation): Vector3 {
  const x = p.px + (p.x - p.px) * alpha;
  const y = p.py + (p.y - p.py) * alpha;
  const total = Math.hypot(p.tx - p.sx, p.ty - p.sy);
  const remaining = Math.hypot(p.tx - x, p.ty - y);
  const progress = Math.max(0, Math.min(1, p.kind === 'lob' ? p.t / p.life : 1 - remaining / Math.max(1, total)));
  const owner = p.owner;
  const correction = owner ? owner.y - p.sy : 0;
  const target = currentProjectileTarget(p);
  const targetGround = terrain ? groundHeightAt(terrain,
    (target ? target.x + target.ox : p.tx) / WORLD.hex,
    (target ? target.y + target.oy : p.ty) / WORLD.hex) / Math.max(1e-6, proportions.tile) : 0;
  const endHeight = target && terrain ? enemyBodyCenterHeight(target, terrain, undefined, undefined, proportions, presentation)
    : (p.kind === 'lob' ? 0.08 : 0.55) / Math.max(1e-6, proportions.tile);
  const endpoint = target && terrain ? endHeight : targetGround + endHeight;
  const height = muzzleHeight(owner, terrain, proportions) * (1 - progress) + endpoint * progress
    + (p.kind === 'lob' ? Math.sin(progress * Math.PI) * 2.2 / Math.max(1e-6, proportions.tile) : 0);
  groundPoint(x, y + correction * (1 - progress), height, out);
  if (owner?.type === 'archer') {
    const yaw = Math.PI / 2 - owner.angle;
    out.x += (0.3 * Math.cos(yaw) + 0.56 * Math.sin(yaw)) * (1 - progress);
    out.z += (0.56 * Math.cos(yaw) - 0.3 * Math.sin(yaw)) * (1 - progress);
  }
  return out;
}
