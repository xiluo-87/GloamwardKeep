import { BASE_SCENE, type SceneProportions } from './scene-proportions';

/** Working scene-space heights, independent of gameplay collision radii. */
const HEIGHT: Record<string, number> = {
  goblin: 1.02, hexer: 1.15, orc: 1.45, stalker: 1.02, bat: 0.55,
  troll: 1.8, wagon: 1.1, shaman: 1.3, ogreking: 2.8, lich: 2.5,
};

/** Stable, restrained instance variation without consuming simulation random numbers. */
export function enemyHeight(kind: string, uid: number, proportions: SceneProportions = BASE_SCENE): number {
  return (HEIGHT[kind] ?? 1.02) * (0.97 + ((Math.imul(uid, 0x45d9f3b) >>> 0) % 61) / 1000)
    / Math.max(1e-6, proportions.tile);
}

/** Per-renderer floor data shared by its actors, effects, and attachment mapping. */
export class EnemyPresentation {
  private readonly locomotionFloors = new Map<string, number>();

  setLocomotionFloor(kind: string, normalizedFloor: number): void {
    if (Number.isFinite(normalizedFloor)) this.locomotionFloors.set(kind, normalizedFloor);
  }

  locomotionFloor(kind: string): number { return this.locomotionFloors.get(kind) ?? 0; }
}

/** Small shared floor correction in scene units, including a consistent contact margin. */
export function enemyGroundingOffset(kind: string, uid: number, proportions: SceneProportions = BASE_SCENE,
  presentation?: EnemyPresentation): number {
  const floor = presentation?.locomotionFloor(kind) ?? 0;
  return Math.max(0, -floor) * (enemyHeight(kind, uid, proportions) / 1.02) + 0.002 / Math.max(1e-6, proportions.tile);
}
