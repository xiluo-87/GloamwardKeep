import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createArtCharacter } from '../src/camera-preview/art-character';
import { BakedModel } from '../src/render3d/baked-model';
import { RuntimeModelRegistry } from '../src/render3d/model-registry';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = 'assets-src/rework/refined/characters';
const CASES = ['goblin', 'orc', 'troll', 'archer-crew'];
const EPSILON = 1e-4;

function loadGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((resolveGlb, reject) => new GLTFLoader().parse(arrayBuffer, '', resolveGlb, reject));
}

function skinnedMeshes(root: { traverse: (fn: (object: import('three').Object3D) => void) => void }): SkinnedMesh[] {
  const result: SkinnedMesh[] = [];
  root.traverse((object) => { if ((object as SkinnedMesh).isSkinnedMesh) result.push(object as SkinnedMesh); });
  return result;
}

function disposeCharacter(character: ReturnType<typeof createArtCharacter>): void {
  character.stop();
  character.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function comparePose(template: GLTF, baked: BakedModel, clipName: string, sampleTime: number, frame: number): number {
  const character = createArtCharacter(template, clipName);
  try {
    character.update(sampleTime, new Vector3(), 0);
    const nativeMeshes = skinnedMeshes(character.root).filter((mesh) => mesh.name !== 'Hidden imported mob silhouette');
    expect(nativeMeshes.length, `${clipName} native skinned mesh count`).toBe(1);
    const nativeMesh = nativeMeshes[0];
    character.root.updateMatrixWorld(true);

    baked.beginFrame();
    const slot = baked.append(new Vector3(), 0, new Vector3(1, 1, 1), sampleTime, clipName);
    expect(slot).toBe(0);
    const pose = baked.body.geometry.getAttribute('instancePose');
    const frame0 = pose.getX(slot), frame1 = pose.getY(slot), blend = pose.getZ(slot);
    const bakedPositions = baked.positionTexture.image.data as Float32Array;
    const vertexCount = baked.stats.vertices;
    const instanceMatrix = new Matrix4();
    baked.body.getMatrixAt(slot, instanceMatrix);
    const nativePoint = new Vector3(), bakedPoint = new Vector3();
    const position = nativeMesh.geometry.getAttribute('position');
    expect(position.count).toBe(vertexCount);
    let maxDistance = 0;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      nativeMesh.getVertexPosition(vertex, nativePoint);
      nativePoint.applyMatrix4(nativeMesh.matrixWorld);
      const i0 = (frame0 * vertexCount + vertex) * 4;
      const i1 = (frame1 * vertexCount + vertex) * 4;
      bakedPoint.set(
        bakedPositions[i0] + (bakedPositions[i1] - bakedPositions[i0]) * blend,
        bakedPositions[i0 + 1] + (bakedPositions[i1 + 1] - bakedPositions[i0 + 1]) * blend,
        bakedPositions[i0 + 2] + (bakedPositions[i1 + 2] - bakedPositions[i0 + 2]) * blend,
      ).applyMatrix4(instanceMatrix);
      const distance = nativePoint.distanceTo(bakedPoint);
      maxDistance = Math.max(maxDistance, distance);
    }
    expect(maxDistance, `${clipName} sample ${frame} max vertex difference`).toBeLessThan(EPSILON);
    return maxDistance;
  } finally {
    disposeCharacter(character);
  }
}

describe('refined character native and baked poses agree', () => {
  it.each(CASES)('%s has matching Idle and Walk vertex positions at baked samples', async (id) => {
    const template = await loadGlb(resolve(ROOT, ASSET_DIR, `${id}.glb`));
    const sourceMeshes = skinnedMeshes(template.scene);
    expect(sourceMeshes.length, `${id} source has one skinned mesh`).toBe(1);
    const baked = new BakedModel(template, 1);
    try {
      const results: number[] = [];
      for (const [clipName, samples] of [['Idle', 8], ['Walk', 16]] as const) {
        const clip = template.animations.find((animation) => animation.name === clipName);
        expect(clip, `${id} has ${clipName}`).toBeDefined();
        for (let frame = 0; frame < samples; frame++) {
          results.push(comparePose(template, baked, clipName, clip!.duration * frame / samples, frame));
        }
      }
      expect(results).toHaveLength(24);
    } finally {
      baked.dispose();
      template.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
    }
  });

  it.each(CASES)('%s matches in registry native-first viewer construction order', async (id) => {
    const template = await loadGlb(resolve(ROOT, ASSET_DIR, `${id}.glb`));
    const registry = new RuntimeModelRegistry({ loader: { loadAsync: async () => template } });
    let native: Awaited<ReturnType<RuntimeModelRegistry['createNativeCharacter']>> | undefined;
    let baked: BakedModel | undefined;
    const scene = new Group();
    const zero = new Vector3();
    try {
      // Match the review viewer: create native first, then bake from the cached adapted template.
      native = await registry.createNativeCharacter(id as 'goblin' | 'orc' | 'troll' | 'archer-crew', 'adapted');
      baked = await registry.createCrowdBatch(id as 'goblin' | 'orc' | 'troll' | 'archer-crew', 1, 'adapted');
      scene.add(native.root, baked.root);
      const heightScale = native.height / 1.02;
      const nativeMesh = skinnedMeshes(native.root).find((mesh) => mesh.name !== 'Hidden imported mob silhouette')!;
      const position = nativeMesh.geometry.getAttribute('position');
      expect(position.count).toBe(baked.stats.vertices);
      const bakedPositions = baked.positionTexture.image.data as Float32Array;
      const vertexCount = baked.stats.vertices;
      const pose = baked.body.geometry.getAttribute('instancePose');
      const instanceMatrix = new Matrix4();
      const worldMatrix = new Matrix4();
      const nativePoint = new Vector3(), batchPoint = new Vector3();
      const sceneBounds = { nativeMinY: Infinity, nativeMaxY: -Infinity, batchMinY: Infinity, batchMaxY: -Infinity };
      let worst = 0;

      // Reuse one native character and switch Walk -> Idle, as the viewer does.
      for (const [clipName, samples] of [['Walk', 16], ['Idle', 8]] as const) {
        native.setClip(clipName);
        const clip = template.animations.find((animation) => animation.name === clipName)!;
        for (let frame = 0; frame < samples; frame++) {
          const time = clip.duration * frame / samples;
          native.update(time, zero, 0);
          scene.updateMatrixWorld(true);
          baked.beginFrame();
          const slot = baked.append(zero, 0, new Vector3(heightScale, heightScale, heightScale), time, clipName);
          expect(slot).toBe(0);
          const frame0 = pose.getX(slot), frame1 = pose.getY(slot), blend = pose.getZ(slot);
          baked.body.updateMatrixWorld(true);
          baked.body.getMatrixAt(slot, instanceMatrix);
          worldMatrix.multiplyMatrices(baked.body.matrixWorld, instanceMatrix);
          let nativeMinY = Infinity, nativeMaxY = -Infinity, batchMinY = Infinity, batchMaxY = -Infinity;
          for (let vertex = 0; vertex < vertexCount; vertex++) {
            nativeMesh.getVertexPosition(vertex, nativePoint).applyMatrix4(nativeMesh.matrixWorld);
            const i0 = (frame0 * vertexCount + vertex) * 4;
            const i1 = (frame1 * vertexCount + vertex) * 4;
            batchPoint.set(
              bakedPositions[i0] + (bakedPositions[i1] - bakedPositions[i0]) * blend,
              bakedPositions[i0 + 1] + (bakedPositions[i1 + 1] - bakedPositions[i0 + 1]) * blend,
              bakedPositions[i0 + 2] + (bakedPositions[i1 + 2] - bakedPositions[i0 + 2]) * blend,
            ).applyMatrix4(worldMatrix);
            worst = Math.max(worst, nativePoint.distanceTo(batchPoint));
            nativeMinY = Math.min(nativeMinY, nativePoint.y); nativeMaxY = Math.max(nativeMaxY, nativePoint.y);
            batchMinY = Math.min(batchMinY, batchPoint.y); batchMaxY = Math.max(batchMaxY, batchPoint.y);
          }
          if (clipName === 'Idle' && frame === 0) {
            sceneBounds.nativeMinY = nativeMinY; sceneBounds.nativeMaxY = nativeMaxY;
            sceneBounds.batchMinY = batchMinY; sceneBounds.batchMaxY = batchMaxY;
          }
        }
      }
      expect(worst, `${id} registry-order max vertex difference`).toBeLessThan(EPSILON);
      expect(Math.abs(sceneBounds.nativeMinY - sceneBounds.batchMinY), `${id} Idle0 feet difference`).toBeLessThan(EPSILON);
      expect(Math.abs(sceneBounds.nativeMaxY - sceneBounds.batchMaxY), `${id} Idle0 top difference`).toBeLessThan(EPSILON);
    } finally {
      native?.stop();
      if (native) disposeCharacter(native);
      baked?.dispose();
      registry.dispose();
    }
  });
});
