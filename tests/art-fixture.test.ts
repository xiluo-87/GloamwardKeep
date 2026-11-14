import { describe, expect, it } from 'vitest';
import { type MapId } from '../src/data/balance';
import { createArtFixture } from '../src/camera-preview/fixture';
import { canBuild, findTower } from '../src/sim/actions';
import { hexDistance } from '../src/sim/hex';
import { FEATURE, generateMap } from '../src/sim/mapgen';

describe('single-tower art fixture', () => {
  for (const map of ['meadow', 'highlands', 'canyon'] as MapId[]) {
    for (const seed of [0, 3219769271]) {
      it(`${map} seed ${seed}: places one legal raised archer beside open roads`, () => {
        const fixture = createArtFixture(map, seed);
        const { run: s, routes, sampleRoute } = fixture;
        const original = generateMap(map, seed);
        const { cols, height, feature, spawns, goal } = s.terrain;
        expect(Array.from(height)).toEqual(Array.from(original.height));
        expect(fixture.towerCount).toBe(1);
        expect(fixture.wallCount).toBe(0);
        expect(s.towers).toHaveLength(1);
        const tower = findTower(s, fixture.sampleTowerUid)!;
        expect(tower.type).toBe('archer');
        expect(tower.height).toBeGreaterThan(0);
        expect(canBuild(s, 'archer', tower.tx, tower.ty)).toBe('occupied');
        expect(feature[tower.ty * cols + tower.tx]).toBe(FEATURE.none);
        const changedFeatures = Array.from(feature).flatMap((value, index) => value !== original.feature[index] ? [index] : []);
        expect(changedFeatures).toEqual(fixture.cleared ? [tower.ty * cols + tower.tx] : []);
        expect(spawns.some(([x, y]) => tower.tx === x && tower.ty === y)).toBe(false);
        expect([tower.tx, tower.ty]).not.toEqual(goal);

        expect(routes).toHaveLength(spawns.length);
        routes.forEach((route, gate) => {
          expect(route[0]).toBe(spawns[gate][1] * cols + spawns[gate][0]);
          expect(route.at(-1)).toBe(goal[1] * cols + goal[0]);
          route.forEach((index, n) => {
            expect(height[index]).toBe(0);
            expect(s.occ[index]).toBe(0);
            if (n) expect(hexDistance(index % cols, Math.floor(index / cols), route[n - 1] % cols, Math.floor(route[n - 1] / cols))).toBe(1);
          });
        });
        expect(sampleRoute.length).toBeGreaterThanOrEqual(2);
        expect(sampleRoute.length).toBeLessThanOrEqual(5);
        sampleRoute.forEach((index, n) => {
          expect(height[index]).toBe(0);
          expect(s.occ[index]).toBe(0);
          if (n) expect(hexDistance(index % cols, Math.floor(index / cols), sampleRoute[n - 1] % cols, Math.floor(sampleRoute[n - 1] / cols))).toBe(1);
        });
        expect(sampleRoute.some((index) => hexDistance(tower.tx, tower.ty, index % cols, Math.floor(index / cols)) <= 2)).toBe(true);
      });
    }
  }

  it('is deterministic for seed zero', () => {
    const a = createArtFixture('canyon', 0);
    const b = createArtFixture('canyon', 0);
    expect(a.run.towers).toEqual(b.run.towers);
    expect(a.routes).toEqual(b.routes);
    expect(a.sampleRoute).toEqual(b.sampleRoute);
    expect(a.cleared).toBe(b.cleared);
  });

  it('handles a modest seed sweep across every preset', () => {
    const seeds = [...Array.from({ length: 20 }, (_, seed) => seed), 5, 2178416768];
    for (const map of ['meadow', 'highlands', 'canyon'] as MapId[]) {
      for (const seed of new Set(seeds)) {
        const fixture = createArtFixture(map, seed);
        const { run: s, sampleRoute } = fixture;
        const tower = findTower(s, fixture.sampleTowerUid)!;
        expect(fixture.towerCount).toBe(1);
        expect(s.towers).toHaveLength(1);
        expect(tower.type).toBe('archer');
        expect(tower.height).toBeGreaterThan(0);
        expect(s.occ[tower.ty * s.terrain.cols + tower.tx]).toBe(tower.uid);
        expect(sampleRoute.length).toBeGreaterThanOrEqual(2);
        expect(sampleRoute.length).toBeLessThanOrEqual(5);
        for (let n = 0; n < sampleRoute.length; n++) {
          const index = sampleRoute[n];
          expect(s.terrain.height[index]).toBe(0);
          expect(s.occ[index]).toBe(0);
          if (n) expect(hexDistance(index % s.terrain.cols, Math.floor(index / s.terrain.cols), sampleRoute[n - 1] % s.terrain.cols, Math.floor(sampleRoute[n - 1] / s.terrain.cols))).toBe(1);
        }
      }
    }
  });
});
