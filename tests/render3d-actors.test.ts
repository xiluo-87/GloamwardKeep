import { readFileSync } from 'node:fs';
import { Group, InstancedMesh, Matrix4, Mesh, OrthographicCamera } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { ENEMIES, RUN, WORLD } from '../src/data/balance';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { groundHeightAt } from '../src/camera-preview/surface';
import { spawnAtGate } from '../src/sim/combat';
import { createRun } from '../src/sim/state';
import { LiveActors } from '../src/render3d/actors';
import { ROOMIER_SCENE } from '../src/render3d/scene-proportions';
import { enemyGroundingOffset, enemyHeight, EnemyPresentation } from '../src/render3d/model-scale';
import { enemyBodyCenterHeight } from '../src/render3d/mapping';
import { BakedModel } from '../src/render3d/baked-model';
import { LiveEffects } from '../src/render3d/effects';

const newRun = () => createRun({ seed: 10, map: 'meadow', mapSeed: 7, heroes: [], perks: [] });
const camera = new OrthographicCamera();

describe('LiveActors', () => {
  it('batches bodies and bars, follows UID reuse, and anchors interpolation to the visual surface', () => {
    const state = newRun();
    const goblin = spawnAtGate(state, 'goblin', 0, 1)!;
    const orc = spawnAtGate(state, 'orc', 0, 1)!;
    goblin.uid = 41; orc.uid = 42;
    goblin.px = 28; goblin.py = 56; goblin.x = 56; goblin.y = 84;
    goblin.ox = 2; goblin.oy = -1; goblin.vx = 20; goblin.vy = 10;
    orc.shield = orc.maxHp * 0.4;
    const before = JSON.stringify(state.enemies.items.slice(0, 2));
    const root = new Group(); const actors = new LiveActors(root);
    actors.update(state, 0.5, camera);
    const visual = actors.mobs[0];
    expect(actors.mobs.map(mob => mob.uid)).toEqual([41, 42]);
    expect(visual.root.position.x).toBeCloseTo(44 / WORLD.hex);
    expect(visual.root.position.z).toBeCloseTo(69 / WORLD.hex);
    expect(visual.root.position.y).toBeCloseTo(groundHeightAt(state.terrain, 44 / WORLD.hex, 69 / WORLD.hex) + 0.002);
    expect(visual.root.rotation.y).toBeCloseTo(Math.atan2(20, 10));
    expect(visual.treeSamples[2].x).toBeCloseTo((56 + 20 * 0.35 + 2) / WORLD.hex);
    const bars = root.getObjectByName('Mob health fills') as InstancedMesh;
    const shields = root.getObjectByName('Mob shield fills') as InstancedMesh;
    expect(bars.count).toBe(2); expect(shields.count).toBe(1);
    const matrix = new Matrix4(); shields.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBeCloseTo(0.6 * 0.4);
    visual.setHidden(0.5); expect(visual.hiddenOpacity).toBe(0.5);
    expect(JSON.stringify(state.enemies.items.slice(0, 2))).toBe(before);
    state.enemies.removeAt(0);
    const reused = state.enemies.add()!;
    reused.uid = 77; reused.def = ENEMIES.bat; reused.dead = false;
    reused.x = reused.px = 140; reused.y = reused.py = 70;
    actors.update(state, 1, camera);
    expect(actors.mobs.map(mob => mob.uid)).toEqual([42, 77]);
    const flying = actors.mobs[1].root.position;
    expect(flying.y).toBeCloseTo(groundHeightAt(state.terrain, flying.x, flying.z) + 0.8);
    actors.dispose(); expect(root.children).toHaveLength(0);
  });

  it('normalizes mob scale per tile and seats roomier actors, status cues, and target anchors on the same sampled floor', async () => {
    const asset = new URL('../assets-src/rework/refined/characters/goblin.glb', import.meta.url);
    const template = await new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(asset)).buffer, '');
    const referenceBake = new BakedModel(template);
    const state = newRun();
    const enemy = spawnAtGate(state, 'goblin', 0, 1)!;
    enemy.uid = 301; enemy.burnT = 1;
    const root = new Group();
    const presentation = new EnemyPresentation();
    const actors = new LiveActors(root, ROOMIER_SCENE, presentation);
    actors.setTemplate(template);
    actors.update(state, 1, camera);
    const mob = actors.mobs[0];
    const ground = groundHeightAt(state.terrain, mob.root.position.x, mob.root.position.z) / ROOMIER_SCENE.tile;
    const height = enemyHeight(enemy.def.id, enemy.uid, ROOMIER_SCENE);
    const floorOffset = enemyGroundingOffset(enemy.def.id, enemy.uid, ROOMIER_SCENE);
    expect(height).toBeCloseTo(enemyHeight(enemy.def.id, enemy.uid) / ROOMIER_SCENE.tile);
    expect(mob.root.position.y).toBeCloseTo(ground + floorOffset);
    expect(mob.samples[0].y).toBeCloseTo(enemyBodyCenterHeight(enemy, state.terrain, undefined, undefined, ROOMIER_SCENE, presentation));
    expect(mob.treeSamples[2].y).toBeCloseTo(groundHeightAt(state.terrain, mob.treeSamples[2].x, mob.treeSamples[2].z) / ROOMIER_SCENE.tile + floorOffset + height * 0.48);

    const body = root.getObjectByName('Baked animated enemy crowd') as InstancedMesh;
    const bodyMatrix = new Matrix4(); body.getMatrixAt(0, bodyMatrix);
    const modelScale = Math.hypot(bodyMatrix.elements[4], bodyMatrix.elements[5], bodyMatrix.elements[6]);
    expect(modelScale).toBeCloseTo(height / 1.02);
    const lowestY = bodyMatrix.elements[13] + referenceBake.locomotionFloor * modelScale;
    expect(lowestY).toBeCloseTo(ground + 0.002 / ROOMIER_SCENE.tile, 5);

    const effects = new LiveEffects(ROOMIER_SCENE, presentation);
    effects.update(state, 1, 1 / 60);
    const burnMesh = effects.root.getObjectByName('burn') as InstancedMesh;
    const burnMatrix = new Matrix4(); burnMesh.getMatrixAt(0, burnMatrix);
    expect(burnMatrix.elements[13]).toBeCloseTo(ground + floorOffset + height * 0.92);
    effects.dispose();
    actors.dispose(); referenceBake.dispose();
    template.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  });

  it('keeps locomotion floor data owned by each renderer presentation', () => {
    const first = new EnemyPresentation();
    const second = new EnemyPresentation();
    first.setLocomotionFloor('goblin', -0.08);
    expect(enemyGroundingOffset('goblin', 17, ROOMIER_SCENE, first))
      .toBeGreaterThan(enemyGroundingOffset('goblin', 17, ROOMIER_SCENE, second));
    second.setLocomotionFloor('goblin', -0.02);
    expect(enemyGroundingOffset('goblin', 17, ROOMIER_SCENE, first))
      .toBeGreaterThan(enemyGroundingOffset('goblin', 17, ROOMIER_SCENE, second));
    expect(enemyGroundingOffset('goblin', 17, ROOMIER_SCENE)).toBeCloseTo(0.002 / ROOMIER_SCENE.tile);
  });

  it('keeps GPU draws bounded at the cap and releases an owned bake without disposing its source', async () => {
    const asset = new URL('../assets-src/models/goblin/goblin.glb', import.meta.url);
    const template = await new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(asset)).buffer, '');
    const sourceMesh = template.scene.getObjectByProperty('isSkinnedMesh', true) as import('three').SkinnedMesh;
    const sourceDisposed = vi.fn(); sourceMesh.geometry.addEventListener('dispose', sourceDisposed);
    const root = new Group(); const actors = new LiveActors(root); actors.setTemplate(template);
    const state = newRun();
    for (let i = 0; i < RUN.enemyCap; i++) spawnAtGate(state, 'goblin', 0, 1);
    actors.update(state, 1, camera);
    expect(actors.mobs).toHaveLength(RUN.enemyCap);
    expect(root.children).toHaveLength(5); // One batch (two meshes), three bar batches and shadows.
    expect(root.getObjectByName('Baked animated enemy crowd')).toHaveProperty('count', RUN.enemyCap);
    expect(actors.getStats().species).toBe(1);
    for (let i = 0; i < RUN.enemyCap; i++) state.enemies.items[i].uid += RUN.enemyCap;
    actors.update(state, 1, camera); expect(root.children).toHaveLength(5);
    actors.dispose(); expect(sourceDisposed).not.toHaveBeenCalled();
    disposeTerrain(template.scene); expect(sourceDisposed).toHaveBeenCalledOnce();
  });
});
