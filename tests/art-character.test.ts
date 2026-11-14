import { readFileSync } from 'node:fs';
import { AlwaysStencilFunc, Box3, EqualStencilFunc, GreaterDepth, MeshBasicMaterial, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { createArtCharacter } from '../src/camera-preview/art-character';
import { createArtFixture } from '../src/camera-preview/fixture';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { buildVoxelStudy } from '../src/camera-preview/voxel-study';

const asset = new URL('../assets-src/models/goblin/goblin.glb', import.meta.url);

describe('imported art sample', () => {
  it('loads the real export, animates its rig and shares that pose with the hidden-mob silhouette', async () => {
    const template = await new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(asset)).buffer, '');
    expect(template.animations.map((clip) => clip.name)).toContain('Walk');
    expect(template.animations).toHaveLength(10);
    const character = createArtCharacter(template);
    const meshes: SkinnedMesh[] = [];
    character.root.traverse((object) => { if (object instanceof SkinnedMesh) meshes.push(object); });
    const normal = meshes.find((mesh) => mesh.name !== 'Hidden imported mob silhouette')!;
    const ghost = meshes.find((mesh) => mesh.name === 'Hidden imported mob silhouette')!;
    expect(ghost.skeleton).toBe(normal.skeleton);
    expect(ghost.geometry).toBe(normal.geometry);
    const originalMaterial = Array.isArray(normal.material) ? normal.material[0] : normal.material;
    expect(originalMaterial.stencilFunc).toBe(AlwaysStencilFunc);
    expect(originalMaterial.stencilRef).toBe(0);
    const pose = (): number[] => normal.skeleton.bones.flatMap((bone) => bone.quaternion.toArray());
    character.update(0, new Vector3(4, 0, 3), Math.PI / 2);
    const start = pose();
    character.update(0.2, new Vector3(4.2, 0, 3), Math.PI / 2);
    expect(pose()).not.toEqual(start);
    expect(character.root.position.x).toBe(4.2);
    // Measure the actual skinned vertices, rather than cached bind-pose bounds: a stale
    // pre-skeleton measurement previously scaled this export about 100 times too large.
    for (const time of [0, 0.2, 0.5, 0.9]) {
      character.update(time, new Vector3(4.2, 0, 3), Math.PI / 2);
      const rendered = new Box3();
      const position = normal.geometry.getAttribute('position');
      const point = new Vector3();
      for (let vertex = 0; vertex < position.count; vertex++) {
        point.fromBufferAttribute(position, vertex);
        normal.applyBoneTransform(vertex, point);
        rendered.expandByPoint(point.applyMatrix4(normal.matrixWorld));
      }
      const size = rendered.getSize(new Vector3());
      expect(size.y).toBeGreaterThan(character.height * 0.9);
      expect(size.y).toBeLessThan(character.height * 1.1);
      expect(Math.max(size.x, size.z)).toBeLessThan(character.height * 1.5);
      expect(rendered.min.y).toBeGreaterThan(-0.1);
    }
    character.setHidden(0.5, true);
    const material = ghost.material as MeshBasicMaterial;
    expect(ghost.visible).toBe(true);
    expect(material.opacity).toBeCloseTo(0.11);
    expect(material.depthFunc).toBe(GreaterDepth);
    expect(material.stencilFunc).toBe(EqualStencilFunc);
    expect(material.stencilRef).toBe(1);
    character.setHidden(0.5, false);
    expect(ghost.visible).toBe(false);
    const dispose = vi.spyOn(normal.skeleton, 'dispose');
    character.stop();
    disposeTerrain(character.root);
    expect(dispose).toHaveBeenCalledOnce();
    // Disposing a map copy must not dispose its reusable source model's geometry.
    const source = template.scene.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh;
    expect(normal.geometry).not.toBe(source.geometry);
    const next = createArtCharacter(template);
    const fixture = createArtFixture('canyon', 0);
    const study = buildVoxelStudy(fixture, 0.35, {
      character: next, towerUid: fixture.sampleTowerUid, route: fixture.sampleRoute,
    });
    expect(study.enemyCount).toBe(1);
    study.dispose();
    disposeTerrain(template.scene);
  });
});
