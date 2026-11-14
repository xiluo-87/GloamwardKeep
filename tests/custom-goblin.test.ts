import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Matrix4, Mesh, OrthographicCamera, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ArtCharacter } from '../src/camera-preview/art-character';
import { groundHeightAt } from '../src/camera-preview/surface';
import { WORLD } from '../src/data/balance';
import { CUSTOM_CHARACTER_CATALOG } from '../src/render3d/custom-catalog';
import { BakedModel } from '../src/render3d/baked-model';
import { RuntimeModelRegistry, type ModelLoader } from '../src/render3d/model-registry';
import { EnemyPresentation } from '../src/render3d/model-scale';
import { LiveActors } from '../src/render3d/actors';
import { createRun } from '../src/sim/state';
import { spawnAtGate } from '../src/sim/combat';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DONOR_PATH = 'assets-src/studies/goblin-shaman/editor-preview.glb';
const CUSTOM_PATH = 'assets-src/rework/custom/goblin/goblin.glb';
const REPORTED_VERTICES = 2784;
const REPORTED_TRIANGLES = 1276;
const NATIVE_BAKE_SAMPLES = [
  { name: 'Idle', samples: 8, offset: 0, loop: true },
  { name: 'Walk', samples: 16, offset: 8, loop: true },
  { name: 'Attack1', samples: 12, offset: 40, loop: false },
  { name: 'Death', samples: 12, offset: 56, loop: false },
] as const;

function loadGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(ROOT, path));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((resolveGltf, reject) => new GLTFLoader().parse(data, '', resolveGltf, reject));
}

function skinnedMeshes(gltf: GLTF): SkinnedMesh[] {
  const result: SkinnedMesh[] = [];
  gltf.scene.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) result.push(object as SkinnedMesh); });
  return result;
}

function allMeshes(gltf: GLTF): Mesh[] {
  const result: Mesh[] = [];
  gltf.scene.traverse(object => { if ((object as Mesh).isMesh) result.push(object as Mesh); });
  return result;
}

function triangleCount(mesh: Mesh): number {
  const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
  return Math.floor(count / 3);
}

function disposeCharacter(character: ArtCharacter): void {
  character.stop();
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<import('three').Material>();
  character.root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function checkGeometry(gltf: GLTF, label: string): { vertices: number; triangles: number } {
  const meshes = allMeshes(gltf);
  expect(meshes.length, `${label} has mesh geometry`).toBeGreaterThan(0);
  let vertices = 0, triangles = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const color = mesh.geometry.getAttribute('color');
    expect(position, `${label} ${mesh.name} positions`).toBeDefined();
    expect(normal, `${label} ${mesh.name} normals`).toBeDefined();
    expect(color, `${label} ${mesh.name} vertex colors`).toBeDefined();
    vertices += position.count;
    triangles += triangleCount(mesh);
    let invalidPositions = 0, invalidNormals = 0, invalidColors = 0, invalidIndices = 0, nonUnitNormals = 0;
    for (let i = 0; i < position.count; i++) {
      if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) invalidPositions++;
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      if (![nx, ny, nz].every(Number.isFinite)) invalidNormals++;
      if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 0.01) nonUnitNormals++;
      if (![color.getX(i), color.getY(i), color.getZ(i)].every(Number.isFinite)) invalidColors++;
    }
    const index = mesh.geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) {
      const value = index.getX(i);
      if (!Number.isInteger(value) || value < 0 || value >= position.count) invalidIndices++;
    }
    expect({ invalidPositions, invalidNormals, invalidColors, invalidIndices, nonUnitNormals }, `${label} ${mesh.name} geometry quality`)
      .toEqual({ invalidPositions: 0, invalidNormals: 0, invalidColors: 0, invalidIndices: 0, nonUnitNormals: 0 });
  }
  return { vertices, triangles };
}

function compareSkeletonAndAnimations(source: GLTF, custom: GLTF): void {
  const sourceMesh = skinnedMeshes(source)[0], customMesh = skinnedMeshes(custom)[0];
  expect(skinnedMeshes(source)).toHaveLength(1);
  expect(skinnedMeshes(custom)).toHaveLength(1);
  const sourceBones = sourceMesh.skeleton.bones, customBones = customMesh.skeleton.bones;
  expect(customBones.map(bone => bone.name)).toEqual(sourceBones.map(bone => bone.name));
  for (let i = 0; i < sourceBones.length; i++) {
    const a = sourceBones[i], b = customBones[i];
    expect(b.parent?.name, `bone ${a.name} parent`).toBe(a.parent?.name);
    for (const property of ['position', 'quaternion', 'scale'] as const) {
      const av = a[property].toArray(), bv = b[property].toArray();
      expect(bv.length).toBe(av.length);
      let maxDelta = 0;
      for (let j = 0; j < av.length; j++) maxDelta = Math.max(maxDelta, Math.abs(av[j] - bv[j]));
      expect(maxDelta, `bone ${a.name} ${property} maximum component delta`).toBeLessThan(1e-6);
    }
    const sourceInverse = sourceMesh.skeleton.boneInverses[i].elements;
    const customInverse = customMesh.skeleton.boneInverses[i].elements;
    let maxInverseDelta = 0;
    for (let j = 0; j < sourceInverse.length; j++) maxInverseDelta = Math.max(maxInverseDelta, Math.abs(sourceInverse[j] - customInverse[j]));
    expect(maxInverseDelta, `bone ${a.name} inverse bind maximum delta`).toBeLessThan(1e-6);
  }

  const sourceClips = new Map(source.animations.map(clip => [clip.name, clip]));
  const customClips = new Map(custom.animations.map(clip => [clip.name, clip]));
  expect([...customClips.keys()].sort()).toEqual([...sourceClips.keys()].sort());
  expect(customClips.size).toBe(10);
  let trackComparisons = 0;
  for (const [name, sourceClip] of sourceClips) {
    const customClip = customClips.get(name)!;
    expect(customClip.duration, `${name} clip duration`).toBe(sourceClip.duration);
    expect([...customClip.tracks.map(track => track.name)].sort(), `${name} track names`)
      .toEqual([...sourceClip.tracks.map(track => track.name)].sort());
    const sourceTracks = new Map(sourceClip.tracks.map(track => [track.name, track]));
    const customTracks = new Map(customClip.tracks.map(track => [track.name, track]));
    for (const [trackName, sourceTrack] of sourceTracks) {
      const customTrack = customTracks.get(trackName)!;
      expect(customTrack.ValueTypeName, `${name} ${trackName} value type`).toBe(sourceTrack.ValueTypeName);
      expect([...customTrack.times], `${name} ${trackName} times`).toEqual([...sourceTrack.times]);
      expect([...customTrack.values], `${name} ${trackName} values`).toEqual([...sourceTrack.values]);
      trackComparisons++;
    }
  }
  expect(trackComparisons).toBeGreaterThan(0);
}

function maxNativeBakedDelta(native: ArtCharacter, batch: BakedModel, clipName: string, time: number): number {
  native.update(time, new Vector3(), 0);
  const mesh = (() => {
    let found: SkinnedMesh | null = null;
    native.root.traverse(object => {
      if ((object as SkinnedMesh).isSkinnedMesh && object.name !== 'Hidden imported mob silhouette') found = object as SkinnedMesh;
    });
    const result = found as SkinnedMesh | null;
    if (!result) throw new Error('Native custom Goblin has no skinned body mesh.');
    return result;
  })();
  native.root.updateMatrixWorld(true);
  batch.beginFrame();
  const slot = batch.append(new Vector3(), 0, new Vector3(1, 1, 1), time, clipName);
  if (slot < 0) throw new Error('Crowd batch could not append a pose.');
  const pose = batch.body.geometry.getAttribute('instancePose');
  const frame0 = pose.getX(slot), frame1 = pose.getY(slot), blend = pose.getZ(slot);
  const texture = batch.positionTexture.image.data as Float32Array;
  const vertexCount = batch.stats.vertices;
  const localMatrix = new Matrix4(), worldMatrix = new Matrix4();
  batch.body.getMatrixAt(slot, localMatrix);
  batch.body.updateMatrixWorld(true);
  worldMatrix.multiplyMatrices(batch.body.matrixWorld, localMatrix);
  const position = mesh.geometry.getAttribute('position');
  if (position.count !== vertexCount) throw new Error(`Native/baked vertex count differs: ${position.count}/${vertexCount}`);
  const nativePoint = new Vector3(), bakedPoint = new Vector3();
  let maximum = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    mesh.getVertexPosition(vertex, nativePoint).applyMatrix4(mesh.matrixWorld);
    const first = (frame0 * vertexCount + vertex) * 4, second = (frame1 * vertexCount + vertex) * 4;
    bakedPoint.set(
      texture[first] + (texture[second] - texture[first]) * blend,
      texture[first + 1] + (texture[second + 1] - texture[first + 1]) * blend,
      texture[first + 2] + (texture[second + 2] - texture[first + 2]) * blend,
    ).applyMatrix4(worldMatrix);
    maximum = Math.max(maximum, nativePoint.distanceTo(bakedPoint));
  }
  return maximum;
}

function nativePose(native: ArtCharacter): Float32Array {
  let mesh: SkinnedMesh | null = null;
  native.root.traverse(object => {
    if ((object as SkinnedMesh).isSkinnedMesh && object.name !== 'Hidden imported mob silhouette') mesh = object as SkinnedMesh;
  });
  const body = mesh as SkinnedMesh | null;
  if (!body) throw new Error('Native custom Goblin has no skinned body mesh.');
  native.root.updateMatrixWorld(true);
  const position = body.geometry.getAttribute('position');
  const points = new Float32Array(position.count * 3);
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    body.getVertexPosition(i, point).applyMatrix4(body.matrixWorld);
    points.set(point.toArray(), i * 3);
  }
  return points;
}

function poseDelta(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Native pose vertex counts differ: ${a.length}/${b.length}`);
  let maximum = 0;
  for (let i = 0; i < a.length; i += 3) {
    maximum = Math.max(maximum, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
  }
  return maximum;
}

function minimumBakedPoseY(batch: BakedModel, clipOffset: number, vertexCount: number,
  frame0: number, frame1: number, blend: number): number {
  const texture = batch.positionTexture.image.data as Float32Array;
  let minY = Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const first = (clipOffset + frame0) * vertexCount * 4 + vertex * 4 + 1;
    const second = (clipOffset + frame1) * vertexCount * 4 + vertex * 4 + 1;
    minY = Math.min(minY, texture[first] + (texture[second] - texture[first]) * blend);
  }
  return minY;
}

describe('custom original-geometry Goblin', () => {
  it('preserves the donor rig and all animation tracks while baking the new mesh and seating its walk on road', async () => {
    const loader: ModelLoader = {
      loadAsync: async url => {
        const path = url === CUSTOM_CHARACTER_CATALOG.goblin.adapted.url ? CUSTOM_PATH : DONOR_PATH;
        return loadGlb(path);
      },
    };
    const registry = new RuntimeModelRegistry({ loader, characterCatalog: CUSTOM_CHARACTER_CATALOG });
    let native: ArtCharacter | null = null;
    let batch: BakedModel | null = null;
    let actors: LiveActors | null = null;
    try {
      const [source, custom] = await Promise.all([
        registry.loadCharacter('goblin', 'source'),
        registry.loadCharacter('goblin', 'adapted'),
      ]);
      compareSkeletonAndAnimations(source, custom);
      const customCounts = checkGeometry(custom, 'custom Goblin');
      expect(customCounts.vertices).toBe(REPORTED_VERTICES);
      expect(customCounts.triangles).toBe(REPORTED_TRIANGLES);
      const donorMesh = skinnedMeshes(source)[0], customMesh = skinnedMeshes(custom)[0];
      expect(customMesh.geometry.getAttribute('position').count).not.toBe(donorMesh.geometry.getAttribute('position').count);
      expect(customMesh.userData.ancestry).toBeUndefined();
      expect(customMesh.userData.gloamwardRework?.ancestry).toBeUndefined();

      native = await registry.createNativeCharacter('goblin', 'adapted');
      batch = await registry.createCrowdBatch('goblin', 1, 'adapted');
      const sampleReports: { clip: string; samples: number; maxDelta: number }[] = [];
      const poseFailures: string[] = [];
      const scene = new Group(); scene.add(native.root, batch.root);
      for (const spec of NATIVE_BAKE_SAMPLES) {
        native.setClip(spec.name);
        let maxDelta = 0;
        const sampleDeltas: number[] = [];
        for (let sample = 0; sample < spec.samples; sample++) {
          const fraction = spec.loop ? sample / spec.samples : sample / (spec.samples - 1);
          const time = custom.animations.find(clip => clip.name === spec.name)!.duration * fraction;
          const delta = maxNativeBakedDelta(native, batch, spec.name, time);
          sampleDeltas.push(delta);
          maxDelta = Math.max(maxDelta, delta);
        }
        sampleReports.push({ clip: spec.name, samples: spec.samples, maxDelta });
        if (maxDelta >= 1e-4) poseFailures.push(`${spec.name}: ${sampleDeltas.join(', ')}`);
      }

      const presentation = new EnemyPresentation();
      const actorRoot = new Group();
      actors = new LiveActors(actorRoot, undefined, presentation);
      actors.setTemplate(custom, 'goblin');
      const run = createRun({ seed: 44, map: 'meadow', mapSeed: 17, heroes: [], perks: [] });
      const enemy = spawnAtGate(run, 'goblin', 0, 1)!;
      enemy.uid = 37;
      enemy.vx = 1; enemy.vy = 0; // The presentation uses the walking loop, without advancing simulation state.
      const actorBody = actorRoot.getObjectByName('Baked animated enemy crowd') as import('three').InstancedMesh;
      const actorPose = actorBody.geometry.getAttribute('instancePose');
      const actorTexture = (actorBody.material as import('three').Material).userData.bakedPositionTexture as BakedModel['positionTexture'];
      expect(actorTexture).toBeDefined();
      const roadGround = groundHeightAt(run.terrain, enemy.x / WORLD.hex, enemy.y / WORLD.hex);
      const phase = (enemy.uid % 113) * 0.071;
      const walkClip = custom.animations.find(clip => clip.name === 'Walk')!;
      let lowest = Infinity, highest = -Infinity;
      for (let frame = 0; frame < 16; frame++) {
        run.t = walkClip.duration * frame / 16 - phase;
        actors.update(run, 1, new OrthographicCamera());
        const matrix = new Matrix4(); actorBody.getMatrixAt(0, matrix);
        const frame0 = actorPose.getX(0) - NATIVE_BAKE_SAMPLES[0].samples;
        const frame1 = actorPose.getY(0) - NATIVE_BAKE_SAMPLES[0].samples;
        const minY = minimumBakedPoseY(batch, 8, batch.stats.vertices, frame0, frame1, actorPose.getZ(0));
        const verticalScale = Math.hypot(matrix.elements[4], matrix.elements[5], matrix.elements[6]);
        const footY = matrix.elements[13] + minY * verticalScale;
        lowest = Math.min(lowest, footY - roadGround);
        highest = Math.max(highest, footY - roadGround);
      }
      expect(lowest, 'walking Goblin feet stay on the sampled height-zero road').toBeGreaterThanOrEqual(-1e-5);
      expect(highest, 'walking Goblin floor lift stays within a small contact tolerance').toBeLessThanOrEqual(0.08);
      expect(batch.locomotionFloor).toBeLessThanOrEqual(0);
      expect(sampleReports).toHaveLength(4);
      expect(poseFailures, 'native/baked vertex pose comparisons').toEqual([]);

      const deathDuration = custom.animations.find(clip => clip.name === 'Death')!.duration;
      native.setClip('Idle');
      native.update(0, new Vector3(), 0);
      native.setClip('Death');
      native.update(0, new Vector3(), 0);
      const openingDeath = nativePose(native);
      native.update(deathDuration, new Vector3(), 0);
      const terminalDeath = nativePose(native);
      native.update(0, new Vector3(), 0);
      const restartedDeath = nativePose(native);
      expect(poseDelta(restartedDeath, openingDeath), 'restarted Death returns to its opening pose')
        .toBeLessThan(1e-4);
      native.update(deathDuration * 0.25, new Vector3(), 0);
      const advancingDeath = nativePose(native);
      expect(poseDelta(advancingDeath, restartedDeath), 'restarted Death plays forward').toBeGreaterThan(0.01);
      expect(poseDelta(terminalDeath, restartedDeath), 'Death terminal pose differs from its opening pose').toBeGreaterThan(0.01);
    } finally {
      if (actors) actors.dispose();
      if (native) disposeCharacter(native);
      if (batch) batch.dispose();
      registry.dispose();
    }
  });
});
