import {
  DynamicDrawUsage, InstancedMesh, MeshStandardMaterial, Object3D, Vector3,
  EqualStencilFunc, GreaterDepth, InstancedBufferAttribute, KeepStencilOp,
  MeshBasicMaterial, OrthographicCamera, Ray, Raycaster, ZeroStencilOp,
} from 'three';
import { HEROES } from '../data/balance';
import type { Tower } from '../sim/state';
import type { DensityFixture } from './fixture';
import { disposeTerrain, tilePosition } from './terrain';
import { blocksView, fadeToward } from './visibility';
import { Painter, type Voxel } from './voxel-model';
import { paintArcherBowman } from './archer-tower';
import { paintHeroModel, paintTowerModel } from './tower-models';
import type { ArtCharacter } from './art-character';
import type { TerrainLook } from './terrain-look';
import { buildVoxelEnvironment, partBounds, writeOccluderMask, type VoxelEnvironment } from './environment';

const DARK_WOOD = '#60472e';
export interface VisibilityResult { settling: boolean; fadedProps: number; hiddenMobs: number }
export interface ArtSampleOptions { character: ArtCharacter | null; towerUid: number; route: number[] }
export interface VoxelStudy extends VoxelEnvironment {
  update(time: number): void;
  prepareView(camera: OrthographicCamera, dt: number, time: number, enabled: boolean): VisibilityResult;
  dispose(): void;
  enemyCount: number;
}

/** Use the same source geometry as the live prefabs, including real fork fields and no archer roof. */
export function paintStudyTower(p: Painter, t: Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier' | 'heroLevel' | 'skills'>, position: Vector3): void {
  if (t.type in HEROES) paintHeroModel(p, t, position);
  else {
    paintTowerModel(p, t, position);
    if (t.type === 'archer') paintArcherBowman(p, position);
  }
}

function creature(kind: number): Voxel[] {
  const p = new Painter();
  const skin = ['#79a545', '#55734c', '#899477'][kind];
  p.box(0, 0.25, 0, 0.2, 0.24, 0.15, kind === 1 ? '#745844' : '#675b42');
  p.box(0, 0.48, 0.015, 0.27, 0.25, 0.24, skin);
  p.box(-0.17, 0.49, 0.02, 0.1, 0.12, 0.1, skin);
  p.box(0.17, 0.49, 0.02, 0.1, 0.12, 0.1, skin);
  for (const x of [-0.07, 0.07]) {
    p.box(x, 0.5, 0.142, 0.045, 0.045, 0.025, '#20271d');
    p.box(x, 0.1, 0, 0.085, 0.2, 0.1, DARK_WOOD, x < 0 ? -1 : 1);
  }
  p.box(-0.16, 0.29, 0.02, 0.1, 0.2, 0.1, skin);
  p.box(0.17, 0.29, 0.05, 0.1, 0.2, 0.1, skin);
  p.box(0.23, 0.43, 0.08, 0.06, 0.28, 0.06, '#c8cfbd');
  return p.parts;
}

export function buildVoxelStudy(fixture: DensityFixture, treeFadeLead = 0.35, artSample?: ArtSampleOptions, terrainLook: TerrainLook = 'artwork'): VoxelStudy {
  const terrain = fixture.run.terrain;
  const environment = buildVoxelEnvironment(terrain, terrainLook);
  const { root, tiles, landmarks, highlight, features, structureBounds } = environment;
  const positions = Array.from(terrain.height.keys(), (i) => tilePosition(terrain, i));
  const towerModels = new Painter();
  fixture.run.towers.forEach((t) => {
    environment.decorations.removeAt(t.ty * terrain.cols + t.tx);
    const model = new Painter();
    paintStudyTower(model, t, positions[t.ty * terrain.cols + t.tx]);
    structureBounds.push(partBounds(model.parts));
    towerModels.parts.push(...model.parts);
  });
  if (towerModels.parts.length) {
    const towerMesh = towerModels.mesh();
    writeOccluderMask(towerMesh.material as MeshStandardMaterial, true);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    root.add(towerMesh);
    environment.bounds.setFromObject(root);
  }

  const templates = [creature(0), creature(1), creature(2)];
  const enemyCount = artSample ? artSample.character ? 1 : 0 : fixture.towerCount ? 48 : 0;
  if (artSample?.character) root.add(artSample.character.root);
  const creatures = new Painter();
  const actors = Array.from({ length: enemyCount }, (_, i) => {
    const parts = artSample ? [] : templates[i % 3];
    const start = creatures.parts.length;
    creatures.parts.push(...parts);
    const samples = [new Vector3(), new Vector3()];
    const scale = [0.85, 1.1, 1.45][i % 3];
    return {
      parts, start, route: artSample?.route ?? fixture.routes[i % fixture.routes.length],
      offset: artSample ? 0.5 : i / enemyCount, scale, samples,
      bodyHeight: artSample?.character ? artSample.character.height * 0.35 : 0.3 * scale,
      headHeight: artSample?.character ? artSample.character.height * 0.63 : 0.52 * scale,
      treeSamples: [...samples, new Vector3(), new Vector3()],
    };
  });
  const enemies = creatures.mesh(true);
  writeOccluderMask(enemies.material as MeshStandardMaterial, false);
  root.add(enemies);
  const opacity = new InstancedBufferAttribute(new Float32Array(enemies.count), 1);
  opacity.setUsage(DynamicDrawUsage);
  const silhouetteGeometry = enemies.geometry.clone();
  silhouetteGeometry.setAttribute('instanceVisibility', opacity);
  const silhouetteMaterial = new MeshBasicMaterial({
    color: '#eadfba', opacity: 0.22, transparent: true, alphaTest: 0.001,
    depthTest: true, depthWrite: false, depthFunc: GreaterDepth, toneMapped: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: EqualStencilFunc,
    stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ZeroStencilOp,
  });
  // Consume each tower-mask pixel after one silhouette fragment, avoiding bright stacked voxel faces.
  silhouetteMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float instanceVisibility;\nvarying float vVisibility;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVisibility = instanceVisibility;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVisibility;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vVisibility;');
  };
  silhouetteMaterial.customProgramCacheKey = () => 'hidden-voxel-silhouette-v1';
  const silhouettes = new InstancedMesh(silhouetteGeometry, silhouetteMaterial, enemies.count);
  silhouettes.name = 'Hidden mob silhouettes';
  silhouettes.instanceMatrix = enemies.instanceMatrix;
  silhouettes.frustumCulled = false;
  silhouettes.renderOrder = 20;
  root.add(silhouettes);
  const transform = new Object3D();
  const actorPosition = new Vector3();
  const update = (time: number): void => {
    actors.forEach((actor, i) => {
      const route = actor.route;
      if (route.length < 2) return;
      const progress = (actor.offset * (route.length - 1) + time * 0.8) % (route.length - 1);
      const index = Math.floor(progress);
      const a = positions[route[index]];
      const b = positions[route[index + 1]];
      const mix = progress - index;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      actorPosition.lerpVectors(a, b, mix);
      artSample?.character?.update(time, actorPosition, yaw);
      actor.samples[0].copy(actorPosition);
      actor.samples[0].y += actor.bodyHeight;
      actor.samples[1].copy(actor.samples[0]);
      actor.samples[1].y = a.y + actor.headHeight;
      // Trees begin fading before the mob reaches their projected silhouette. Never predict a respawn.
      const future = Math.min(route.length - 1, progress + 0.8 * Math.max(0, treeFadeLead));
      const futureIndex = Math.min(route.length - 2, Math.floor(future));
      const futureMix = future - futureIndex;
      const futureA = positions[route[futureIndex]], futureB = positions[route[futureIndex + 1]];
      actor.treeSamples[2].lerpVectors(futureA, futureB, futureMix);
      actor.treeSamples[2].y += actor.bodyHeight;
      actor.treeSamples[3].copy(actor.treeSamples[2]);
      actor.treeSamples[3].y += actor.headHeight - actor.bodyHeight;
      actor.parts.forEach((part, j) => {
        const walk = part.leg ? Math.sin(time * 9 + i) * 0.07 * part.leg : 0;
        const px = part.x * actor.scale;
        const pz = (part.z + walk) * actor.scale;
        transform.position.set(a.x + (b.x - a.x) * mix + px * cos + pz * sin, a.y + part.y * actor.scale, a.z + (b.z - a.z) * mix - px * sin + pz * cos);
        transform.rotation.set(0, yaw, 0);
        transform.scale.set(part.w * actor.scale, part.h * actor.scale, part.d * actor.scale);
        transform.updateMatrix();
        enemies.setMatrixAt(actor.start + j, transform.matrix);
      });
    });
    enemies.instanceMatrix.needsUpdate = true;
  };
  interface ViewFades { props: Float32Array; mobs: Float32Array; propHold: Float64Array; mobHold: Float64Array }
  const viewFades = new WeakMap<OrthographicCamera, ViewFades>();
  const towardCamera = new Vector3();
  const ray = new Ray();
  const hit = new Vector3();
  const raycaster = new Raycaster();
  const propTargets = new Uint8Array(features.length);
  const mobTargets = new Uint8Array(actors.length);
  const prepareView = (camera: OrthographicCamera, dt: number, time: number, enabled: boolean): VisibilityResult => {
    let fades = viewFades.get(camera);
    if (!fades) {
      fades = { props: new Float32Array(features.length).fill(1), mobs: new Float32Array(actors.length), propHold: new Float64Array(features.length), mobHold: new Float64Array(actors.length) };
      viewFades.set(camera, fades);
    }
    silhouettes.visible = enabled;
    propTargets.fill(0);
    mobTargets.fill(0);
    if (enabled) {
      camera.getWorldDirection(towardCamera).negate();
      actors.forEach((actor, i) => {
        mobTargets[i] = structureBounds.some((bounds) => actor.samples.some((sample) => blocksView(bounds, sample, towardCamera, ray, hit))) ? 1 : 0;
        features.forEach((feature, index) => {
          if (propTargets[index]) return;
          for (const sample of feature.tree ? actor.treeSamples : actor.samples) {
            if (!blocksView(feature.bounds, sample, towardCamera, ray, hit)) continue;
            raycaster.ray.set(sample, towardCamera);
            if (raycaster.intersectObject(feature.mesh, false).length) { propTargets[index] = 1; break; }
          }
        });
      });
    } else {
      fades.props.fill(1); fades.mobs.fill(0);
      fades.propHold.fill(0); fades.mobHold.fill(0);
    }
    let settling = false;
    let fadedProps = 0;
    let hiddenMobs = 0;
    features.forEach((feature, i) => {
      if (propTargets[i]) fades.propHold[i] = time + 0.12;
      const held = enabled && time < fades.propHold[i];
      const target = held ? 0.22 : 1;
      fades.props[i] = fadeToward(fades.props[i], target, dt || 1 / 60, held ? 0.14 : 0.28);
      feature.material.opacity = fades.props[i];
      feature.material.depthWrite = fades.props[i] >= 0.995;
      feature.material.stencilWrite = fades.props[i] >= 0.995;
      if (fades.props[i] < 0.99) fadedProps++;
      settling ||= Math.abs(fades.props[i] - target) > 0.003 || (held && !propTargets[i]);
    });
    actors.forEach((actor, i) => {
      if (mobTargets[i]) fades.mobHold[i] = time + 0.1;
      const held = enabled && time < fades.mobHold[i];
      const target = held ? 1 : 0;
      fades.mobs[i] = fadeToward(fades.mobs[i], target, dt || 1 / 60, held ? 0.15 : 0.25);
      for (let j = 0; j < actor.parts.length; j++) opacity.setX(actor.start + j, fades.mobs[i]);
      artSample?.character?.setHidden(fades.mobs[i], enabled);
      if (fades.mobs[i] > 0.05) hiddenMobs++;
      settling ||= fades.mobs[i] !== target || (held && !mobTargets[i]);
    });
    opacity.needsUpdate = true;
    return { settling, fadedProps, hiddenMobs };
  };
  update(0);
  return {
    root, tiles, bounds: environment.bounds, landmarks, highlight, features, structureBounds, structures: environment.structures, decorations: environment.decorations,
    update, prepareView, enemyCount,
    dispose() { artSample?.character?.stop(); disposeTerrain(root); },
  };
}
