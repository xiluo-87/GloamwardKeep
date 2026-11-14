import {
  AnimationClip, Bone, BufferAttribute, BufferGeometry, Group, MeshStandardMaterial, SkinnedMesh,
  Skeleton, Vector3, VectorKeyframeTrack, type WebGLRenderer,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { BakedModel } from '../src/render3d/baked-model';

function animatedFixture(): { gltf: GLTF; sourceGeometry: BufferGeometry; sourceMaterial: MeshStandardMaterial } {
  const scene = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array([
    1, 0.7, 0.4, 0.8, 1, 0.4, 0.5, 0.8, 1,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const material = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true });
  const mesh = new SkinnedMesh(geometry, material);
  const bone = new Bone(); bone.name = 'RootBone'; mesh.add(bone);
  const skeleton = new Skeleton([bone]); mesh.bind(skeleton);
  scene.add(mesh);
  const track = new VectorKeyframeTrack('RootBone.position', [0, 1], [0, 0, 0, 0, 0.4, 0]);
  const clip = new AnimationClip('Walk', 1, [track]);
  return { gltf: { scene, animations: [clip], scenes: [scene], parser: {} } as GLTF, sourceGeometry: geometry, sourceMaterial: material };
}

describe('BakedModel crowd renderer', () => {
  it('bakes finite animated poses, normalizes geometry, and prepares interpolated shader attributes', () => {
    const fixture = animatedFixture();
    const model = new BakedModel(fixture.gltf, 2);
    expect(model.stats.vertices).toBe(3);
    expect(model.stats.triangles).toBe(1);
    expect(model.stats.frames).toBe(68);
    expect(model.stats.poseBytes).toBe(1024 * 4 * 4 * 2);
    expect((model.positionTexture.image.data as Float32Array).length).toBe(1024 * 4);
    expect(model.positionTexture.image.width).toBe(1024);
    expect(model.positionTexture.image.height).toBe(1);
    const positions = model.positionTexture.image.data as Float32Array;
    expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    const walkBase = 8;
    const atFirst = (walkBase * model.stats.vertices + 0) * 4;
    const atMoved = ((walkBase + 8) * model.stats.vertices + 0) * 4;
    expect(positions[atMoved + 1]).toBeGreaterThan(positions[atFirst + 1]);
    const bodyPosition = model.body.geometry.getAttribute('position');
    expect(bodyPosition.getY(0)).toBeCloseTo(0);
    expect(bodyPosition.getY(1)).toBeCloseTo(0);
    expect(bodyPosition.getY(2)).toBeCloseTo(1.02);

    const bodyShader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '' };
    const material = model.body.material as MeshStandardMaterial;
    material.onBeforeCompile(bodyShader as never, {} as WebGLRenderer);
    expect(bodyShader.vertexShader).toContain('texture2D(bakedPositionTexture');
    expect(bodyShader.vertexShader).toContain('mix(bakedP0, bakedP1, instancePose.z)');
    const silhouetteShader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    (model.silhouettes.material as MeshStandardMaterial).onBeforeCompile(silhouetteShader as never, {} as WebGLRenderer);
    expect(silhouetteShader.vertexShader).toContain('vBakedOpacity = instanceOpacity');
    expect(silhouetteShader.fragmentShader).toContain('diffuseColor.a *= vBakedOpacity');
    model.dispose();
  });

  it('appends bounded instances with shared silhouette transforms and per-instance fade without owning the source GLTF', () => {
    const fixture = animatedFixture();
    const geometryDispose = vi.fn();
    const materialDispose = vi.fn();
    fixture.sourceGeometry.deleteAttribute('normal');
    fixture.sourceGeometry.addEventListener('dispose', geometryDispose);
    fixture.sourceMaterial.addEventListener('dispose', materialDispose);
    const model = new BakedModel(fixture.gltf, 1);
    expect(fixture.sourceGeometry.getAttribute('normal')).toBeUndefined();
    const clonedGeometry = (model as unknown as { extraOwnedGeometry: BufferGeometry[] }).extraOwnedGeometry[0];
    const cloneDisposed = vi.fn(); clonedGeometry.addEventListener('dispose', cloneDisposed);
    const bodyDisposed = vi.fn(), silhouettesDisposed = vi.fn();
    model.body.addEventListener('dispose', bodyDisposed);
    model.silhouettes.addEventListener('dispose', silhouettesDisposed);
    model.beginFrame();
    const slot = model.append(new Vector3(2, 3, 4), 0.5, new Vector3(1, 1, 1), 0.23, 'Walk', 0.1);
    expect(slot).toBe(0);
    expect(model.append(new Vector3(), 0, new Vector3(1, 1, 1), 0)).toBe(-1);
    model.endFrame();
    model.setHidden(slot, 1);
    expect(model.body.count).toBe(1);
    expect(model.silhouettes.count).toBe(1);
    expect(Array.from(model.body.instanceMatrix.array.slice(0, 16))).toEqual(Array.from(model.silhouettes.instanceMatrix.array.slice(0, 16)));
    expect((model.silhouettes.geometry.getAttribute('instanceOpacity').array as Float32Array)[0]).toBeCloseTo(0.22);
    model.beginFrame(); model.endFrame();
    expect(model.body.count).toBe(0);
    model.dispose(); model.dispose();
    expect(bodyDisposed).toHaveBeenCalledTimes(1);
    expect(silhouettesDisposed).toHaveBeenCalledTimes(1);
    expect(cloneDisposed).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});
