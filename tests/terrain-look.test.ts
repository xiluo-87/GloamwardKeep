import { Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapId } from '../src/data/balance';
import { generateMap } from '../src/sim/mapgen';
import { buildTerrainGround, type TerrainLook } from '../src/camera-preview/terrain-look';
import { disposeTerrain, tilePosition } from '../src/camera-preview/terrain';
import { Group } from 'three';

describe('terrain appearance studies', () => {
  for (const map of ['meadow', 'highlands', 'canyon'] as MapId[]) {
    it(`${map}: keeps rendered terrain tops and map data identical across appearances`, () => {
      const terrain = generateMap(map, 0);
      const heights = Array.from(terrain.height), features = Array.from(terrain.feature);
      const decorations = Array.from(terrain.decoration);
      const routes = JSON.stringify({ spawns: terrain.spawns, goal: terrain.goal, gaps: terrain.gaps, seed: terrain.seed });
      const samples = new Set([0, 150, terrain.height.length - 1]);
      for (let level = 0; level <= 4; level++) {
        const index = terrain.height.indexOf(level);
        if (index !== -1) samples.add(index);
      }
      for (const look of ['artwork', 'blockout'] as TerrainLook[]) {
        const mesh = buildTerrainGround(terrain, look);
        mesh.updateMatrixWorld(true);
        for (const index of samples) {
          const point = tilePosition(terrain, index);
          const hit = new Raycaster(point.clone().add(new Vector3(0, 5, 0)), new Vector3(0, -1, 0)).intersectObject(mesh, false)[0];
          expect(hit, `surface missing at tile ${index} with ${look}`).toBeDefined();
          expect(hit.point.y).toBeCloseTo(point.y, 6);
        }
        const root = new Group();
        root.add(mesh);
        disposeTerrain(root);
      }
      expect(Array.from(terrain.height)).toEqual(heights);
      expect(Array.from(terrain.feature)).toEqual(features);
      expect(Array.from(terrain.decoration)).toEqual(decorations);
      expect(JSON.stringify({ spawns: terrain.spawns, goal: terrain.goal, gaps: terrain.gaps, seed: terrain.seed })).toBe(routes);
    });
  }
});
