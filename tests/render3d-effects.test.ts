import { AlwaysStencilFunc, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, ReplaceStencilOp, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RUN, STEP } from '../src/data/balance';
import { groundHeightAt } from '../src/camera-preview/surface';
import { LiveEffects } from '../src/render3d/effects';
import { enemyBodyCenterHeight, muzzleHeight } from '../src/render3d/mapping';
import { enemyGroundingOffset, enemyHeight } from '../src/render3d/model-scale';
import { build } from '../src/sim/actions';
import { spawnAtGate } from '../src/sim/combat';
import { createRun } from '../src/sim/state';
import { freeTiles } from './helpers';

function run() {
  const state = createRun({ seed: 4, map: 'meadow', mapSeed: 7, heroes: [], perks: [] });
  state.gold = 10000;
  return state;
}

function buildArcher(state: ReturnType<typeof run>) {
  const [col, row] = freeTiles(state, () => true)[0];
  const tower = build(state, 'archer', col, row);
  if (!tower) throw new Error('Could not build test archer');
  return tower;
}

function meshNamed(root: Group, name: string): InstancedMesh {
  const mesh = root.children.find((child) => child.name === name);
  if (!(mesh instanceof InstancedMesh)) throw new Error(`Missing instanced mesh ${name}`);
  return mesh;
}

describe('LiveEffects', () => {
  it('maps every simulation event to a distinct bounded world cue without changing state/events', () => {
    const state = run();
    const tower = buildArcher(state);
    const eventTypes = [
      'shot', 'hit', 'kill', 'leak', 'splash', 'cluster', 'pulse', 'chain', 'cleave', 'bite',
      'build', 'upgrade', 'sell', 'skill', 'wave', 'waveClear', 'heroLevel', 'ability', 'shield',
      'silence', 'jinx', 'boss', 'shed', 'smash', 'destroyed', 'clear', 'keep', 'win', 'lose', 'gold',
    ] as const;
    eventTypes.forEach((type, index) => {
      const event = state.events[index];
      event.type = type;
      event.x = tower.x; event.y = tower.y;
      event.a = type === 'shot' ? 0.4 : 70;
      event.b = type === 'shot' ? tower.uid : type === 'ability' ? 2 : 0;
      event.c = 0;
    });
    state.eventCount = eventTypes.length;
    const eventsBefore = state.events.slice(0, state.eventCount).map((event) => ({ ...event }));
    const before = {
      eventCount: state.eventCount, gold: state.gold, t: state.t,
      rng: (state.rng as unknown as { a: number }).a,
    };
    const effects = new LiveEffects();
    effects.consume(state);
    effects.update(state, 0.5, STEP);

    const rings = meshNamed(effects.root, 'Batched event rings');
    const disks = meshNamed(effects.root, 'Batched event disks');
    const markers = meshNamed(effects.root, 'Batched event markers');
    const lines = effects.root.children.find((child) => child.name === 'Batched event lines');
    expect(rings.count).toBeGreaterThan(0);
    expect(disks.count).toBeGreaterThan(0);
    expect(markers.count).toBeGreaterThan(0);
    expect((lines as import('three').LineSegments).geometry.drawRange.count).toBeGreaterThan(0);
    expect(rings.count).toBeLessThanOrEqual(512);
    expect(disks.count).toBeLessThanOrEqual(512);
    expect(markers.count).toBeLessThanOrEqual(512);
    const cueMaterial = rings.material as MeshBasicMaterial;
    expect(cueMaterial.depthTest).toBe(true);
    expect(cueMaterial.depthWrite).toBe(false);
    expect(cueMaterial.stencilWrite).toBe(true);
    expect(cueMaterial.stencilRef).toBe(0);
    expect(cueMaterial.stencilFunc).toBe(AlwaysStencilFunc);
    expect(cueMaterial.stencilZPass).toBe(ReplaceStencilOp);
    expect(state.eventCount).toBe(before.eventCount);
    expect(state.gold).toBe(before.gold);
    expect(state.t).toBe(before.t);
    expect((state.rng as unknown as { a: number }).a).toBe(before.rng);
    expect(state.events.slice(0, state.eventCount).map((event) => ({ ...event }))).toEqual(eventsBefore);
    effects.reset();
    expect(rings.count + disks.count + markers.count).toBe(0);
    effects.dispose();
  });

  it('shows active burn, slow, stun, shield, shred, jinx, silence and rally cues; rejects stale target UIDs', () => {
    const state = run();
    const tower = buildArcher(state);
    const enemy = spawnAtGate(state, 'bat', 0, 1)!;
    enemy.burnT = 2; enemy.slowT = 1; enemy.stunT = 0.5; enemy.shield = 8; enemy.shred = 0.2;
    tower.jinxT = 1; tower.silenceT = 2; state.rallyT = 3;
    tower.stats.beam = 10; tower.beamUid = enemy.uid;
    const pet = state.pets.add()!;
    pet.owner = tower; pet.x = pet.px = enemy.x; pet.y = pet.py = enemy.y - 10;
    pet.target = enemy; pet.targetUid = enemy.uid; pet.temp = false; pet.phase = 0.2;
    const effects = new LiveEffects();

    effects.update(state, 0.5, STEP);
    expect(meshNamed(effects.root, 'burn').count).toBe(1);
    expect(meshNamed(effects.root, 'slow').count).toBe(1);
    expect(meshNamed(effects.root, 'stun').count).toBe(1);
    expect(meshNamed(effects.root, 'shields').count).toBe(1);
    expect(meshNamed(effects.root, 'shred').count).toBe(1);
    expect(meshNamed(effects.root, 'jinx').count).toBe(1);
    expect(meshNamed(effects.root, 'silence').count).toBe(1);
    expect(meshNamed(effects.root, 'rally').count).toBe(1);
    expect((effects.root.children.find((child) => child.name === 'Live beam lines') as import('three').LineSegments).geometry.drawRange.count).toBe(2);
    expect(meshNamed(effects.root, 'leftWings').count).toBe(1);
    expect(meshNamed(effects.root, 'rightWings').count).toBe(1);
    const petBody = meshNamed(effects.root, 'pets');
    const petMatrix = new Matrix4(); petBody.getMatrixAt(0, petMatrix);
    const petPosition = new Vector3(); petPosition.setFromMatrixPosition(petMatrix);
    expect(petPosition.y).toBeCloseTo(enemyBodyCenterHeight(enemy, state.terrain));
    const beam = effects.root.children.find((child) => child.name === 'Live beam lines') as import('three').LineSegments;
    const beamPositions = beam.geometry.getAttribute('position');
    const interpolatedX = enemy.px + (enemy.x - enemy.px) * 0.5 + enemy.ox;
    const interpolatedY = enemy.py + (enemy.y - enemy.py) * 0.5 + enemy.oy;
    expect(beamPositions.getY(1)).toBeCloseTo(enemyBodyCenterHeight(enemy, state.terrain, interpolatedX, interpolatedY));
    const batHeight = enemyHeight(enemy.def.id, enemy.uid);
    const ground = groundHeightAt(state.terrain, interpolatedX / 28, interpolatedY / 28);
    const stun = meshNamed(effects.root, 'stun');
    const stunMatrix = new Matrix4(); stun.getMatrixAt(0, stunMatrix);
    const stunPosition = new Vector3(); stunPosition.setFromMatrixPosition(stunMatrix);
    expect(stunPosition.y).toBeCloseTo(ground + 0.8 + enemyGroundingOffset(enemy.def.id, enemy.uid) + batHeight * 1.01);
    effects.reduceMotion = true;
    effects.update(state, 1, STEP);
    const reducedMatrix = new Matrix4(); stun.getMatrixAt(0, reducedMatrix);
    const reducedQuaternion = new Quaternion();
    reducedMatrix.decompose(new Vector3(), reducedQuaternion, new Vector3());
    expect(Math.abs(reducedQuaternion.y)).toBeLessThan(1e-6);

    // Recycled objects with a different uid are not used as the old target for a beam or hawk.
    enemy.uid++;
    effects.update(state, 1, STEP);
    const lineSegments = effects.root.children.find((child) => child.name === 'Live beam lines') as import('three').LineSegments;
    expect(lineSegments.geometry.drawRange.count).toBe(0);
    const body = meshNamed(effects.root, 'pets');
    const matrix = new Matrix4(); body.getMatrixAt(0, matrix);
    const position = new Vector3(); position.setFromMatrixPosition(matrix);
    expect(position.z).toBeCloseTo((pet.y + 10) / 28);
    expect(position.y).toBeCloseTo(muzzleHeight(tower, state.terrain) + 0.45);
    effects.dispose();
  });

  it('keeps projectile, hawk and burn-pool visuals within their simulation pool caps', () => {
    const state = run();
    const effects = new LiveEffects();
    state.projectiles.count = RUN.projectileCap;
    for (let i = 0; i < state.projectiles.count; i++) {
      const projectile = state.projectiles.items[i];
      projectile.kind = i % 2 ? 'bolt' : 'lob';
      projectile.x = projectile.px = i; projectile.y = projectile.py = i / 2;
      projectile.sx = projectile.x; projectile.sy = projectile.y;
      projectile.tx = projectile.x + 20; projectile.ty = projectile.y + 10;
      projectile.t = 0.1; projectile.life = 1;
    }
    state.pets.count = RUN.petCap;
    for (let i = 0; i < state.pets.count; i++) {
      const pet = state.pets.items[i];
      pet.x = pet.px = i; pet.y = pet.py = 0; pet.target = null; pet.targetUid = 0;
      pet.phase = i / RUN.petCap * Math.PI * 2; pet.owner = null;
    }
    state.pools.count = RUN.poolCap;
    for (let i = 0; i < state.pools.count; i++) {
      const pool = state.pools.items[i]; pool.x = i; pool.y = 0; pool.r = 35; pool.t = i / 10; pool.life = 4;
    }
    effects.update(state, 1, STEP);
    expect(meshNamed(effects.root, 'bolts').count + meshNamed(effects.root, 'stones').count).toBe(RUN.projectileCap);
    expect(meshNamed(effects.root, 'pets').count).toBe(RUN.petCap);
    expect(meshNamed(effects.root, 'leftWings').count).toBe(RUN.petCap);
    expect(meshNamed(effects.root, 'rightWings').count).toBe(RUN.petCap);
    expect(meshNamed(effects.root, 'pools').count).toBe(RUN.poolCap);
    expect(meshNamed(effects.root, 'poolRings').count).toBe(RUN.poolCap);
    effects.reset();
    expect(meshNamed(effects.root, 'pets').count).toBe(0);
    effects.dispose();
  });
});
