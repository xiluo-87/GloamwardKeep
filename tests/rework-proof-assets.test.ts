import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, BufferAttribute, Mesh, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROOF = 'assets-src/rework/refined/characters';
const PACK_MANIFEST_PATH = 'blocky-pack/manifest.json';

interface ProofCase {
  id: string;
  source: string;
  /** Source package member recorded by the purchased pack manifest. */
  manifestSource: string;
  sourceSha256: string;
}

const CASES: ProofCase[] = [
  {
    id: 'goblin',
    source: 'assets-src/studies/goblin-shaman/editor-preview.glb',
    manifestSource: 'blocky-pack/dcc/tiny-characters-blocky-goblin-shaman.glb',
    sourceSha256: '48d8a90968caac7011e6378addfd78a7238db7ad2cc3ea11f69c7464d73a88cb',
  },
  {
    id: 'orc',
    source: 'blocky-pack/dcc/tiny-characters-blocky-orc.glb',
    manifestSource: 'blocky-pack/dcc/tiny-characters-blocky-orc.glb',
    sourceSha256: 'eb840a0b71589c146182d64dcb4800d88bd4827ad91ac8ea98ba34eeb138d170',
  },
  {
    id: 'troll',
    source: 'blocky-pack/dcc/tiny-characters-blocky-hill-troll.glb',
    manifestSource: 'blocky-pack/dcc/tiny-characters-blocky-hill-troll.glb',
    sourceSha256: 'b66f6374eb769b33320fcb0bb70c941bbbe94eedec7bca1c19bed68cfa1bd628',
  },
  {
    id: 'archer-crew',
    source: 'blocky-pack/dcc/tiny-characters-blocky-hood-archer.glb',
    manifestSource: 'blocky-pack/dcc/tiny-characters-blocky-hood-archer.glb',
    sourceSha256: 'cbcb5523413e76d83a888dc246793202ef58be269fec97b75c8196338c74a889',
  },
];

const CLIP_NAMES = ['Idle', 'Walk', 'Run', 'Wave', 'Attack1', 'Attack2', 'Hit', 'Death', 'Block', 'Special'];
const POSE_FRACTIONS = [0, 0.2, 0.5, 0.8];
const MAX_BOUND_DELTA_HEIGHT = 0.2;

interface PackManifest {
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((resolveGlb, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolveGlb, reject);
  });
}

function allSkinnedMeshes(gltf: GLTF): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh);
  });
  return meshes;
}

function allMeshes(gltf: GLTF): Mesh[] {
  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  return meshes;
}

function triangleCount(gltf: GLTF): number {
  let triangles = 0;
  gltf.scene.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function jointCount(gltf: GLTF): number {
  const skins = new Set(allSkinnedMeshes(gltf).map((mesh) => mesh.skeleton));
  return Math.max(0, ...[...skins].map((skin) => skin.bones.length));
}

function findReworkMetadata(gltf: GLTF): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null;
  gltf.scene.traverse((object) => {
    const metadata = object.userData.gloamwardRework;
    if (metadata && typeof metadata === 'object') result = metadata as Record<string, unknown>;
  });
  return result;
}

function validateWeights(gltf: GLTF): void {
  const meshes = allSkinnedMeshes(gltf);
  expect(meshes.length, 'proof must retain skinned source geometry').toBeGreaterThan(0);
  for (const mesh of meshes) {
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    expect(indices, `${mesh.name} skin indices`).toBeDefined();
    expect(weights, `${mesh.name} skin weights`).toBeDefined();
    expect(indices.count).toBe(weights.count);
    for (let i = 0; i < weights.count; i++) {
      const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      expect(values.every(Number.isFinite), `${mesh.name} vertex ${i} has finite weights`).toBe(true);
      expect(values.every((weight) => weight >= -1e-6), `${mesh.name} vertex ${i} has nonnegative weights`).toBe(true);
      for (const component of [0, 1, 2, 3]) {
        if (values[component] <= 1e-6) continue;
        expect(indices.getComponent(i, component), `${mesh.name} vertex ${i} joint index`).toBeLessThan(mesh.skeleton.bones.length);
      }
      const sum = values.reduce((total, weight) => total + weight, 0);
      expect(sum, `${mesh.name} vertex ${i} weight sum`).toBeGreaterThanOrEqual(0.98);
      expect(sum, `${mesh.name} vertex ${i} weight sum`).toBeLessThanOrEqual(1.02);
    }
  }
}

function validateGeometry(gltf: GLTF): void {
  const meshes = allMeshes(gltf);
  expect(meshes.length, 'GLB has renderable geometry').toBeGreaterThan(0);
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    expect(position, `${mesh.name} position attribute`).toBeDefined();
    for (let i = 0; i < position.count; i++) {
      expect([position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite),
        `${mesh.name} position ${i} is finite`).toBe(true);
    }
    const normal = mesh.geometry.getAttribute('normal');
    expect(normal, `${mesh.name} normal attribute`).toBeDefined();
    for (let i = 0; i < normal.count; i++) {
      const x = normal.getX(i), y = normal.getY(i), z = normal.getZ(i);
      expect([x, y, z].every(Number.isFinite), `${mesh.name} normal ${i} is finite`).toBe(true);
      const length = Math.hypot(x, y, z);
      expect(length, `${mesh.name} normal ${i} is unit length`).toBeGreaterThanOrEqual(0.99);
      expect(length, `${mesh.name} normal ${i} is unit length`).toBeLessThanOrEqual(1.01);
    }
    const index = mesh.geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) {
      const value = index.getX(i);
      expect(Number.isInteger(value) && value >= 0 && value < position.count,
        `${mesh.name} index ${i} is in range`).toBe(true);
    }
    const triangleIndexCount = index?.count ?? position.count;
    const triangleVertex = index ? (offset: number): number => index.getX(offset) : (offset: number): number => offset;
    const pointA = new Vector3(), pointB = new Vector3(), pointC = new Vector3();
    const edgeA = new Vector3(), edgeB = new Vector3();
    for (let i = 0; i + 2 < triangleIndexCount; i += 3) {
      pointA.fromBufferAttribute(position, triangleVertex(i));
      pointB.fromBufferAttribute(position, triangleVertex(i + 1));
      pointC.fromBufferAttribute(position, triangleVertex(i + 2));
      edgeA.subVectors(pointB, pointA);
      edgeB.subVectors(pointC, pointA);
      const area = edgeA.cross(edgeB).length() * 0.5;
      expect(Number.isFinite(area) && area > 0, `${mesh.name} triangle ${i / 3} has nonzero area (${area})`).toBe(true);
    }
  }
}

function compareSkeletons(source: GLTF, proof: GLTF, label: string): void {
  const sourceMeshes = allSkinnedMeshes(source);
  const proofMeshes = allSkinnedMeshes(proof);
  expect(proofMeshes.length, `${label} skinned mesh count`).toBe(sourceMeshes.length);
  for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex++) {
    const a = sourceMeshes[meshIndex], b = proofMeshes[meshIndex];
    expect(b.skeleton.bones.length, `${label} skeleton joint count`).toBe(a.skeleton.bones.length);
    expect(b.skeleton.bones.map((bone) => bone.name), `${label} skeleton bone order`).toEqual(a.skeleton.bones.map((bone) => bone.name));
    for (let i = 0; i < a.skeleton.bones.length; i++) {
      const sourceBone = a.skeleton.bones[i], proofBone = b.skeleton.bones[i];
      const sourceParent = sourceBone.parent instanceof SkinnedMesh ? sourceBone.parent.name : sourceBone.parent?.name;
      const proofParent = proofBone.parent instanceof SkinnedMesh ? proofBone.parent.name : proofBone.parent?.name;
      expect(proofParent, `${label} bone ${sourceBone.name} parent`).toBe(sourceParent);
      for (const field of ['position', 'quaternion', 'scale'] as const) {
        const sourceValues = sourceBone[field].toArray();
        const proofValues = proofBone[field].toArray();
        expect(proofValues.length, `${label} bone ${sourceBone.name} ${field} components`).toBe(sourceValues.length);
        proofValues.forEach((value, component) => {
          expect(value, `${label} bone ${sourceBone.name} ${field}[${component}]`)
            .toBeCloseTo(sourceValues[component], 6);
        });
      }
      const sourceInverse = a.skeleton.boneInverses[i].elements;
      const proofInverse = b.skeleton.boneInverses[i].elements;
      proofInverse.forEach((value, component) => {
        expect(value, `${label} bone ${sourceBone.name} inverseBind[${component}]`)
          .toBeCloseTo(sourceInverse[component], 6);
      });
    }
  }
}

function compareAnimationTracks(source: GLTF, proof: GLTF, label: string): void {
  const sourceClips = new Map(source.animations.map((clip) => [clip.name, clip]));
  const proofClips = new Map(proof.animations.map((clip) => [clip.name, clip]));
  expect([...sourceClips.keys()].sort(), `${label} source clips`).toEqual([...CLIP_NAMES].sort());
  expect([...proofClips.keys()].sort(), `${label} proof clips`).toEqual([...sourceClips.keys()].sort());
  for (const [name, sourceClip] of sourceClips) {
    const proofClip = proofClips.get(name)!;
    expect(proofClip.duration, `${label} ${name} duration`).toBeCloseTo(sourceClip.duration, 6);
    expect(proofClip.tracks.length, `${label} ${name} track count`).toBe(sourceClip.tracks.length);
    const sourceTracks = new Map(sourceClip.tracks.map((track) => [track.name, track]));
    const proofTracks = new Map(proofClip.tracks.map((track) => [track.name, track]));
    expect([...proofTracks.keys()].sort(), `${label} ${name} targets`).toEqual([...sourceTracks.keys()].sort());
    for (const [target, sourceTrack] of sourceTracks) {
      const proofTrack = proofTracks.get(target)!;
      expect(proofTrack.ValueTypeName, `${label} ${name} ${target} value type`).toBe(sourceTrack.ValueTypeName);
      expect(proofTrack.getValueSize(), `${label} ${name} ${target} value size`).toBe(sourceTrack.getValueSize());
      expect([...proofTrack.times], `${label} ${name} ${target} key times`).toEqual([...sourceTrack.times]);
      expect(proofTrack.values.length, `${label} ${name} ${target} value count`).toBe(sourceTrack.values.length);
      proofTrack.values.forEach((value, index) => {
        expect(value, `${label} ${name} ${target} value[${index}]`).toBeCloseTo(sourceTrack.values[index], 7);
      });
    }
  }
}

function validateFiniteColors(gltf: GLTF): string[] {
  const signatures: string[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isMesh) return;
    const color = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (!color) return;
    const values = color.array as ArrayLike<number>;
    const histogram = new Map<string, number>();
    for (let i = 0; i < values.length; i += color.itemSize) {
      const tuple = Array.from({ length: color.itemSize }, (_, component) => {
        const value = Number(values[i + component]);
        expect(Number.isFinite(value), `${mesh.name} vertex color component ${i + component}`).toBe(true);
        return value.toFixed(5);
      }).join(',');
      histogram.set(tuple, (histogram.get(tuple) ?? 0) + 1);
    }
    signatures.push(`${color.itemSize}:${color.count}:${[...histogram].sort(([a], [b]) => a.localeCompare(b))
      .map(([tuple, count]) => `${tuple}=${count}`).join(';')}`);
  });
  expect(signatures.length, 'proof must contain remapped vertex colors').toBeGreaterThan(0);
  return signatures;
}

interface PoseBounds { min: [number, number, number]; max: [number, number, number] }

function poseBounds(gltf: GLTF, clipName?: string, fraction = 0): PoseBounds {
  const clip = clipName ? gltf.animations.find((animation) => animation.name === clipName) : undefined;
  if (clipName && !clip) throw new Error(`Missing animation ${clipName}`);
  const mixer = clip ? new AnimationMixer(gltf.scene) : null;
  if (clip && mixer) {
    mixer.clipAction(clip).play();
    mixer.setTime(clip.duration * fraction);
  }
  gltf.scene.updateMatrixWorld(true);
  for (const mesh of allSkinnedMeshes(gltf)) mesh.skeleton.update();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const point = new Vector3();
  for (const mesh of allMeshes(gltf)) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      if (mesh instanceof SkinnedMesh) mesh.getVertexPosition(i, point);
      else point.fromBufferAttribute(position, i);
      point.applyMatrix4(mesh.matrixWorld);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point.getComponent(axis));
        max[axis] = Math.max(max[axis], point.getComponent(axis));
      }
    }
  }
  mixer?.stopAllAction();
  mixer?.uncacheRoot(gltf.scene);
  expect([...min, ...max].every(Number.isFinite), `${clipName ?? 'Rest'}@${fraction} bounds are finite`).toBe(true);
  return { min, max };
}

function compareAnimatedBounds(source: GLTF, proof: GLTF, label: string): void {
  const rest = poseBounds(source);
  const proofRest = poseBounds(proof);
  const sourceHeight = rest.max[1] - rest.min[1];
  expect(sourceHeight, `${label} source rest height`).toBeGreaterThan(0);
  const tolerance = sourceHeight * MAX_BOUND_DELTA_HEIGHT;
  const compare = (clip: string | undefined, fraction: number): void => {
    const sourceBounds = clip ? poseBounds(source, clip, fraction) : rest;
    const proofBounds = clip ? poseBounds(proof, clip, fraction) : proofRest;
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(proofBounds.min[axis] - sourceBounds.min[axis]),
        `${label} ${clip ?? 'Rest'}@${fraction} min axis ${axis} exceeds ${tolerance}`).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(proofBounds.max[axis] - sourceBounds.max[axis]),
        `${label} ${clip ?? 'Rest'}@${fraction} max axis ${axis} exceeds ${tolerance}`).toBeLessThanOrEqual(tolerance);
    }
    const sourcePoseHeight = sourceBounds.max[1] - sourceBounds.min[1];
    const proofPoseHeight = proofBounds.max[1] - proofBounds.min[1];
    expect(sourcePoseHeight, `${label} ${clip ?? 'Rest'}@${fraction} source pose height`).toBeGreaterThan(0);
    expect(proofPoseHeight, `${label} ${clip ?? 'Rest'}@${fraction} sensible height`)
      .toBeGreaterThan(sourcePoseHeight * 0.8);
    expect(proofPoseHeight, `${label} ${clip ?? 'Rest'}@${fraction} sensible height`)
      .toBeLessThan(sourcePoseHeight * 1.2);
  };
  compare(undefined, 0);
  for (const clip of CLIP_NAMES) for (const fraction of POSE_FRACTIONS) compare(clip, fraction);
}

function validateAncestryAndWeights(source: GLTF, refined: GLTF, metadata: Record<string, unknown>, label: string): void {
  const ancestry = metadata.ancestry as { encoding?: unknown; indices?: unknown } | undefined;
  expect(ancestry?.encoding, `${label} ancestry encoding`).toBe('source-vertex-index');
  expect(Array.isArray(ancestry?.indices), `${label} ancestry index list`).toBe(true);
  const sourceMeshes = allSkinnedMeshes(source);
  const refinedMeshes = allSkinnedMeshes(refined);
  expect(sourceMeshes.length, `${label} has one original skinned mesh`).toBe(1);
  expect(refinedMeshes.length, `${label} has one refined skinned mesh`).toBe(1);
  const src = sourceMeshes[0], dst = refinedMeshes[0];
  const mapping = ancestry!.indices as number[];
  const sourcePosition = src.geometry.getAttribute('position');
  const refinedPosition = dst.geometry.getAttribute('position');
  expect(mapping.length, `${label} ancestry count`).toBe(refinedPosition.count);
  for (let i = 0; i < mapping.length; i++) {
    const sourceIndex = mapping[i];
    expect(Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < sourcePosition.count,
      `${label} ancestry vertex ${i} maps to source`).toBe(true);
    const weightsFor = (mesh: SkinnedMesh, vertex: number): Map<string, number> => {
      const indices = mesh.geometry.getAttribute('skinIndex');
      const weights = mesh.geometry.getAttribute('skinWeight');
      const result = new Map<string, number>();
      for (let c = 0; c < 4; c++) {
        const weight = weights.getComponent(vertex, c);
        if (weight <= 1e-6) continue;
        const bone = mesh.skeleton.bones[indices.getComponent(vertex, c)];
        expect(bone, `${label} vertex ${vertex} references existing bone`).toBeDefined();
        result.set(bone.name, (result.get(bone.name) ?? 0) + weight);
      }
      return result;
    };
    const a = weightsFor(src, sourceIndex), b = weightsFor(dst, i);
    expect([...b.keys()].sort(), `${label} refined vertex ${i} inherited source influences`).toEqual([...a.keys()].sort());
    for (const [bone, weight] of a) {
      expect(b.get(bone), `${label} refined vertex ${i} weight for ${bone}`).toBeCloseTo(weight, 6);
    }
  }
}

function boneContactBounds(mesh: SkinnedMesh): Map<string, { min: [number, number, number]; max: [number, number, number] }> {
  const positions = mesh.geometry.getAttribute('position');
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  const bounds = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    let dominantComponent = 0;
    for (let component = 1; component < 4; component++) {
      if (weights.getComponent(vertex, component) > weights.getComponent(vertex, dominantComponent)) dominantComponent = component;
    }
    const boneIndex = indices.getComponent(vertex, dominantComponent);
    const boneName = mesh.skeleton.bones[boneIndex]?.name;
    if (!boneName) continue;
    let bound = bounds.get(boneName);
    if (!bound) {
      bound = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      bounds.set(boneName, bound);
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = positions.getComponent(vertex, axis);
      bound.min[axis] = Math.min(bound.min[axis], value);
      bound.max[axis] = Math.max(bound.max[axis], value);
    }
  }
  return bounds;
}

function compareJointContacts(source: GLTF, refined: GLTF, label: string): void {
  const sourceMesh = allSkinnedMeshes(source)[0];
  const refinedMesh = allSkinnedMeshes(refined)[0];
  const sourceBounds = boneContactBounds(sourceMesh);
  const refinedBounds = boneContactBounds(refinedMesh);
  const mismatches: string[] = [];
  const sourceAxisForBone = (name: string): number | undefined => {
    if (/Arm|ForeArm/i.test(name)) return 0; // Native T-pose arm endpoints run along X.
    if (/Leg|UpLeg|Foot/i.test(name)) return 1; // Limb contact endpoints run along Y.
    return undefined;
  };
  for (const boneName of sourceBounds.keys()) {
    const axis = sourceAxisForBone(boneName);
    if (axis === undefined) continue;
    const sourceBound = sourceBounds.get(boneName)!;
    const refinedBound = refinedBounds.get(boneName);
    expect(refinedBound, `${label} retains dominant-weight bone group ${boneName}`).toBeDefined();
    for (const endpoint of ['min', 'max'] as const) {
      const sourceValue = sourceBound[endpoint][axis];
      const refinedValue = refinedBound![endpoint][axis];
      if (Math.abs(refinedValue - sourceValue) > 1e-5) {
        mismatches.push(`${boneName}.${endpoint} source=${sourceValue} refined=${refinedValue} delta=${refinedValue - sourceValue}`);
      }
    }
  }
  expect(mismatches, `${label} bind-space joint contact endpoints`).toEqual([]);
}

describe('refined proof GLB asset fidelity', () => {
  it.each(CASES)('$id retains source provenance, rig, and clips while reducing geometry', async ({ id, source: sourcePath, manifestSource, sourceSha256 }) => {
    const sourceBytes = readFileSync(resolve(ROOT, sourcePath));
    const [source, proof] = await Promise.all([
      loadGlb(resolve(ROOT, sourcePath)),
      loadGlb(resolve(ROOT, PROOF, `${id}.glb`)),
    ]);
    const manifest = JSON.parse(readFileSync(resolve(ROOT, PACK_MANIFEST_PATH), 'utf8')) as PackManifest;
    const sourceHash = sha256(sourceBytes);
    expect(sourceHash, `${id} original source hash`).toBe(sourceSha256);
    const proofMetadata = findReworkMetadata(proof);
    expect(proofMetadata, `${id} has source provenance metadata`).not.toBeNull();
    expect(proofMetadata?.source).toBe(sourcePath);
    expect(proofMetadata?.sourceSha256).toBe(sourceHash);
    expect(proofMetadata?.geometryRevision).toBe('refined-pack-v1');

    const manifestPath = manifestSource.replace(/^blocky-pack\//, '');
    const manifestEntry = manifest.files.find((entry) => entry.path === manifestPath);
    expect(manifestEntry, `${id} has a source entry in blocky-pack/manifest.json`).toBeDefined();
    const manifestBytes = readFileSync(resolve(ROOT, manifestSource));
    expect(manifestEntry?.bytes).toBe(manifestBytes.byteLength);
    expect(manifestEntry?.sha256).toBe(sha256(manifestBytes));

    const reduction = 1 - triangleCount(proof) / triangleCount(source);
    // Require measured savings, not an arbitrary percentage that encourages
    // destroying voxel corners or flattening thin parts to meet a target.
    expect(reduction, `${id} triangle reduction`).toBeGreaterThan(0);
    expect(reduction, `${id} triangle reduction`).toBeLessThan(0.8);
    expect(jointCount(proof), `${id} source joint count`).toBe(jointCount(source));
    expect(jointCount(proof)).toBeGreaterThan(0);
    compareSkeletons(source, proof, id);
    compareAnimationTracks(source, proof, id);
    validateGeometry(proof);
    validateWeights(proof);
    validateAncestryAndWeights(source, proof, proofMetadata!, id);
    compareJointContacts(source, proof, id);
    const sourceColors = validateFiniteColors(source);
    const proofColors = validateFiniteColors(proof);
    expect(proofColors, `${id} vertex colors changed from the source`).not.toEqual(sourceColors);

    compareAnimatedBounds(source, proof, id);
    for (const gltf of [source, proof]) {
      gltf.scene.traverse((object) => {
        const mesh = object as SkinnedMesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) material.dispose();
        }
      });
    }
  });
});
