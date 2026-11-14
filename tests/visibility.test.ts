import { AlwaysStencilFunc, Box3, EqualStencilFunc, GreaterDepth, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, fitCamera } from '../src/camera-preview/camera';
import { createDensityFixture } from '../src/camera-preview/fixture';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { blocksView, fadeToward } from '../src/camera-preview/visibility';
import { buildVoxelStudy } from '../src/camera-preview/voxel-study';

describe('mob visibility aids', () => {
  it('only treats props between the mob and camera as blockers', () => {
    const sample = new Vector3(0, 0.4, 0);
    const towardCamera = new Vector3(0, 0, 1);
    const front = new Box3(new Vector3(-0.5, 0, 1), new Vector3(0.5, 1, 2));
    const behind = new Box3(new Vector3(-0.5, 0, -2), new Vector3(0.5, 1, -1));
    const beside = new Box3(new Vector3(1, 0, 1), new Vector3(2, 1, 2));
    expect(blocksView(front, sample, towardCamera)).toBe(true);
    expect(blocksView(behind, sample, towardCamera)).toBe(false);
    expect(blocksView(beside, sample, towardCamera)).toBe(false);
    expect(blocksView(front, sample, towardCamera.clone().negate())).toBe(false);
    expect(blocksView(behind, sample, towardCamera.clone().negate())).toBe(true);
  });

  it('eases fading consistently across frame rates and restores full opacity', () => {
    const run = (fps: number): number => {
      let value = 1;
      for (let i = 0; i < fps / 2; i++) value = fadeToward(value, 0.22, 1 / fps);
      return value;
    };
    expect(run(30)).toBeCloseTo(run(60), 10);
    expect(run(60)).toBeLessThan(0.3);
    let value = 0.22;
    for (let i = 0; i < 120; i++) value = fadeToward(value, 1, 1 / 60);
    expect(value).toBe(1);
    expect(fadeToward(0.5, 1, 0)).toBe(0.5);
  });

  it('fades real occluding props, masks hidden mobs to towers, and keeps defenses opaque', () => {
    const fixture = createDensityFixture('canyon', 3219769271, 80);
    const study = buildVoxelStudy(fixture);
    const meshes = study.root.children.filter((object): object is InstancedMesh => object instanceof InstancedMesh);
    const defenses = meshes.find((mesh) => {
      const mat = mesh.material as MeshStandardMaterial;
      return mat.stencilRef === 1 && mat.stencilFunc === AlwaysStencilFunc;
    })!;
    const silhouettes = study.root.getObjectByName('Hidden mob silhouettes') as InstancedMesh;
    const material = silhouettes.material as MeshBasicMaterial;
    expect(material.depthFunc).toBe(GreaterDepth);
    expect(material.stencilFunc).toBe(EqualStencilFunc);
    expect(material.stencilRef).toBe(1);
    expect(material.depthWrite).toBe(false);
    let faded = 0, hidden = 0;
    for (const direction of DIRECTIONS) {
      const camera = new OrthographicCamera();
      fitCamera(camera, study.bounds, 1.6, direction.azimuth, 35.3);
      for (const time of [0, 5, 10]) {
        study.update(time);
        study.root.updateMatrixWorld(true);
        for (let n = 0; n < 6; n++) {
          const result = study.prepareView(camera, 0.1, time + n * 0.1, true);
          faded = Math.max(faded, result.fadedProps);
          hidden = Math.max(hidden, result.hiddenMobs);
        }
      }
      const reset = study.prepareView(camera, 0.1, 20, false);
      expect(reset.fadedProps).toBe(0);
      expect(reset.hiddenMobs).toBe(0);
      expect(reset.settling).toBe(false);
    }
    expect(faded).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    const defenseMaterial = defenses.material as MeshStandardMaterial;
    expect(defenseMaterial.opacity).toBe(1);
    expect(defenseMaterial.transparent).toBe(false);
    expect(defenseMaterial.depthWrite).toBe(true);
    expect(silhouettes.visible).toBe(false);
    disposeTerrain(study.root);
  });

  it('starts tree fading ahead of the current overlap on a real route', () => {
    const fixture = createDensityFixture('canyon', 3219769271, 80);
    const early = buildVoxelStudy(fixture);
    const currentOnly = buildVoxelStudy(fixture, 0);
    let anticipated = false;
    for (const time of [0, 0.25, 0.5, 1, 2, 5, 10]) {
      const counts = [early, currentOnly].map((study) => {
        study.update(time);
        study.root.updateMatrixWorld(true);
        const camera = new OrthographicCamera();
        fitCamera(camera, study.bounds, 1.6, 45, 35.3);
        return study.prepareView(camera, 0.5, time, true).fadedProps;
      });
      expect(counts[0]).toBeGreaterThanOrEqual(counts[1]);
      anticipated ||= counts[0] > counts[1];
    }
    expect(anticipated).toBe(true);
    disposeTerrain(early.root);
    disposeTerrain(currentOnly.root);
  });
});
