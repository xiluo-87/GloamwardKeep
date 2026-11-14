import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/data/balance';
import { currentProjectileTarget, enemyBodyCenterHeight, groundPoint, muzzleHeight, projectilePoint } from '../src/render3d/mapping';
import { enemyGroundingOffset, enemyHeight } from '../src/render3d/model-scale';
import { ROOMIER_SCENE } from '../src/render3d/scene-proportions';
import { groundHeightAt } from '../src/camera-preview/surface';
import { createRun } from '../src/sim/state';
import { spawnAtGate } from '../src/sim/combat';
import type { Projectile, Tower } from '../src/sim/state';

const owner = (type: string, height = 2): Tower => ({
  type, height, hero: false, y: 112, angle: 0,
} as Tower);

describe('render coordinate mapping', () => {
  it('maps simulation XY to scene XZ at WORLD.hex scale and reuses an output vector', () => {
    const out = new Vector3();
    expect(groundPoint(WORLD.hex * 2, WORLD.hex * -3, 0.75, out)).toBe(out);
    expect(out.toArray()).toEqual([2, 0.75, -3]);
  });

  it('keeps tower elevation and legacy -14/-16 launch corrections out of simulation state', () => {
    const archer = owner('archer', 3);
    const catapult = owner('catapult', 1);
    expect(muzzleHeight(archer)).toBeCloseTo(3 * 0.28 + 1.68);
    expect(muzzleHeight(catapult)).toBeCloseTo(0.28 + 1.05);
    const p: Projectile = {
      kind: 'bolt', x: 70, y: 108.5, px: 56, py: 98, sx: 56, sy: 98,
      tx: 112, ty: 140, t: 0.1, life: 3, target: null, targetUid: 0, owner: archer, damage: 4,
    };
    const before = { ...p };
    const point = projectilePoint(p, 0.25);
    const x = p.px + (p.x - p.px) * 0.25;
    const y = p.py + (p.y - p.py) * 0.25;
    const total = Math.hypot(p.tx - p.sx, p.ty - p.sy);
    const progress = 1 - Math.hypot(p.tx - x, p.ty - y) / total;
    expect(point.y).toBeCloseTo(muzzleHeight(archer) * (1 - progress) + 0.55 * progress);
    expect(point.x).toBeCloseTo(x / WORLD.hex + (0.3 * Math.cos(Math.PI / 2) + 0.56 * Math.sin(Math.PI / 2)) * (1 - progress));
    expect(point.z).toBeCloseTo((y + 14 * (1 - progress)) / WORLD.hex
      + (0.56 * Math.cos(Math.PI / 2) - 0.3 * Math.sin(Math.PI / 2)) * (1 - progress));
    expect(p).toEqual(before);

    const lob = { ...p, kind: 'lob' as const, sy: 96, py: 96, owner: catapult, t: 0.3, life: 0.6 };
    const lobAtLaunch = projectilePoint({ ...lob, t: 0 }, 1);
    expect(lobAtLaunch.y).toBeCloseTo(muzzleHeight(catapult));
    const lobAtPeak = projectilePoint({ ...lob, t: 0.3 }, 1);
    expect(lobAtPeak.y).toBeGreaterThan(muzzleHeight(catapult));
  });

  it('uses a target only while the pooled object still has the recorded uid', () => {
    const s = createRun({ seed: 3, map: 'meadow', mapSeed: 9, heroes: [], perks: [] });
    const enemy = spawnAtGate(s, 'bat', 0, 1)!;
    const p: Projectile = {
      kind: 'bolt', x: 1, y: 1, px: 0, py: 0, sx: 0, sy: -14,
      tx: 84, ty: 42, t: 3, life: 4, target: enemy, targetUid: enemy.uid, owner: null, damage: 1,
    };
    expect(currentProjectileTarget(p)).toBe(enemy);
    const progress = 1 - Math.hypot(p.tx - p.x, p.ty - p.y) / Math.hypot(p.tx - p.sx, p.ty - p.sy);
    const targetHeight = enemyBodyCenterHeight(enemy, s.terrain);
    expect(projectilePoint(p, 1, new Vector3(), s.terrain).y).toBeCloseTo(0.7 * (1 - progress) + targetHeight * progress);
    enemy.uid++;
    expect(currentProjectileTarget(p)).toBeNull();
    expect(projectilePoint(p, 1).y).toBeCloseTo(0.7 * (1 - progress) + 0.55 * progress);
  });

  it('keeps roomier projectile attachments aligned with tile-normalized target models and tower muzzles', () => {
    const state = createRun({ seed: 3, map: 'meadow', mapSeed: 9, heroes: [], perks: [] });
    const enemy = spawnAtGate(state, 'bat', 0, 1)!;
    enemy.uid = 703;
    const targetHeight = enemyBodyCenterHeight(enemy, state.terrain, undefined, undefined, ROOMIER_SCENE);
    const ground = groundHeightAt(state.terrain, (enemy.x + enemy.ox) / WORLD.hex, (enemy.y + enemy.oy) / WORLD.hex);
    expect(targetHeight).toBeCloseTo(ground / ROOMIER_SCENE.tile + 0.8 / ROOMIER_SCENE.tile
      + enemyGroundingOffset(enemy.def.id, enemy.uid, ROOMIER_SCENE)
      + enemyHeight(enemy.def.id, enemy.uid, ROOMIER_SCENE) * 0.48);
    expect(enemyHeight(enemy.def.id, enemy.uid, ROOMIER_SCENE))
      .toBeCloseTo(enemyHeight(enemy.def.id, enemy.uid) / ROOMIER_SCENE.tile);

    const archer = owner('archer', 3);
    expect(muzzleHeight(archer, undefined, ROOMIER_SCENE))
      .toBeCloseTo((3 * 0.28 + 1.68 * ROOMIER_SCENE.buildings) / ROOMIER_SCENE.tile);
    const p: Projectile = {
      kind: 'bolt', x: enemy.x + enemy.ox, y: enemy.y + enemy.oy,
      px: enemy.x + enemy.ox, py: enemy.y + enemy.oy,
      sx: enemy.x, sy: enemy.y - 14, tx: enemy.x + enemy.ox, ty: enemy.y + enemy.oy,
      t: 1, life: 1, target: enemy, targetUid: enemy.uid, owner: archer, damage: 1,
    };
    expect(projectilePoint(p, 1, new Vector3(), state.terrain, ROOMIER_SCENE).y).toBeCloseTo(targetHeight);
  });
});
