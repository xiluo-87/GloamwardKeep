import { describe, expect, it } from 'vitest';
import { type MapId } from '../src/data/balance';
import { createDensityFixture } from '../src/camera-preview/fixture';
import { hexDistance } from '../src/sim/hex';
import { FEATURE, generateMap } from '../src/sim/mapgen';
import { buildVoxelStudy } from '../src/camera-preview/voxel-study';
import { disposeTerrain, tilePosition } from '../src/camera-preview/terrain';
import { Raycaster, Vector3 } from 'three';

describe('real-map voxel readability fixture', () => {
  for (const map of ['meadow', 'highlands', 'canyon'] as MapId[]) {
    it(`${map}: places dense defenses legally without changing terrain heights or closing gates`, () => {
      const seed = map === 'canyon' ? 3219769271 : 5;
      const fixture = createDensityFixture(map, seed, 80);
      const { run: s, routes, towerCount, wallCount } = fixture;
      const original = generateMap(map, seed);
      const { cols, height, feature, spawns, goal } = s.terrain;
      expect(Array.from(height)).toEqual(Array.from(original.height));
      expect(towerCount).toBe(80);
      expect(s.towers.length).toBe(towerCount + wallCount);
      expect(new Set(s.towers.map((tower) => tower.ty * cols + tower.tx)).size).toBe(s.towers.length);
      for (const tower of s.towers) {
        const i = tower.ty * cols + tower.tx;
        expect(feature[i]).toBe(FEATURE.none);
        expect(s.occ[i]).toBe(tower.uid);
        expect(tower.height).toBe(height[i]);
        expect(spawns.some(([x, y]) => tower.tx === x && tower.ty === y)).toBe(false);
        expect([tower.tx, tower.ty]).not.toEqual(goal);
      }
      expect(routes).toHaveLength(spawns.length);
      routes.forEach((route, gate) => {
        expect(route[0]).toBe(spawns[gate][1] * cols + spawns[gate][0]);
        expect(route.at(-1)).toBe(goal[1] * cols + goal[0]);
        route.forEach((i, n) => {
          expect(height[i]).toBe(0);
          expect(s.occ[i]).toBe(0);
          if (n > 0) expect(hexDistance(i % cols, Math.floor(i / cols), route[n - 1] % cols, Math.floor(route[n - 1] / cols))).toBe(1);
        });
      });
    });
  }
  it('recreates the same layout and accepts seed zero', () => {
    const a = createDensityFixture('canyon', 0, 40);
    const b = createDensityFixture('canyon', 0, 40);
    expect(a.towerCount).toBe(40);
    expect(a.run.towers).toEqual(b.run.towers);
    expect(a.routes).toEqual(b.routes);
    expect(createDensityFixture('canyon', 0, 0).run.towers).toHaveLength(0);
  });
  it('keeps original tile IDs pickable under the voxel surface', () => {
    const fixture = createDensityFixture('canyon', 3219769271, 40);
    const study = buildVoxelStudy(fixture);
    study.root.updateMatrixWorld(true);
    for (const index of [0, 25, 150, 335]) {
      const top = tilePosition(fixture.run.terrain, index);
      const ray = new Raycaster(top.clone().add(new Vector3(0, 10, 0)), new Vector3(0, -1, 0));
      expect(ray.intersectObject(study.tiles, false)[0]?.instanceId).toBe(index);
    }
    study.update(50);
    expect(study.enemyCount).toBe(48);
    disposeTerrain(study.root);
  });
});
