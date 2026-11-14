import { Group, InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { visualTileHeight, SURFACE_MAX_OFFSET } from '../src/camera-preview/surface';
import { WORLD } from '../src/data/balance';
import { RangeTiles, rangeTileKinds, upgradeRange } from '../src/render3d/range';
import { build, upgrade } from '../src/sim/actions';
import { tileCenter } from '../src/sim/hex';
import { generateMap } from '../src/sim/mapgen';
import { freeTiles, mk } from './helpers';

describe('tile-based live range overlays', () => {
  it('classifies tile centres, keeping the upgrade extension separate from current range', () => {
    const terrain = generateMap('canyon', 5);
    const center = tileCenter(11, 8);
    const current = 150, extended = 195;
    const kinds = rangeTileKinds(terrain, center.x, center.y, current, extended);
    expect(Array.from(kinds).some(kind => kind === 1)).toBe(true);
    expect(Array.from(kinds).some(kind => kind === 2)).toBe(true);
    for (let i = 0; i < kinds.length; i++) {
      const tile = tileCenter(i % terrain.cols, Math.floor(i / terrain.cols));
      const distance = Math.hypot(tile.x - center.x, tile.y - center.y);
      expect(kinds[i]).toBe(distance <= current ? 1 : distance <= extended ? 2 : 0);
    }
    const withoutPreview = rangeTileKinds(terrain, center.x, center.y, current, null);
    expect(Array.from(withoutPreview).some(kind => kind === 2)).toBe(false);
    expect(rangeTileKinds(terrain, center.x, center.y, current, 100)).toEqual(withoutPreview);
  });

  it.each(['a', 'b'] as const)('matches real tier and fork %s upgrades including height and perks, without mutating the run', fork => {
    const s = mk({ perks: ['eagle', 'highground'] });
    const tile = freeTiles(s, height => height > 0)[0];
    const tower = build(s, 'archer', ...tile)!;
    for (let stage = 0; stage < 4; stage++) {
      const path = tower.tier < 3 ? 'tier' : fork;
      const before = { ...tower, stats: { ...tower.stats }, skills: [...tower.skills] };
      const gold = s.gold, events = s.eventCount, rng = JSON.stringify(s.rng);
      const preview = upgradeRange(s, tower, path);
      expect(tower).toEqual(before);
      expect(s.gold).toBe(gold);
      expect(s.eventCount).toBe(events);
      expect(JSON.stringify(s.rng)).toBe(rng);
      expect(upgrade(s, tower.uid, fork)).toBe(true);
      expect(preview).toBeCloseTo(tower.stats.range);
    }
    expect(upgradeRange(s, tower, fork)).toBeNull();
  });

  it('puts filled highlights on each raised top and removes the green extension when preview ends', () => {
    const terrain = generateMap('highlands', 5);
    const center = tileCenter(11, 8);
    const range = new RangeTiles();
    range.show(terrain, center.x, center.y, 150, 190);
    const mesh = range.root.children[0] as InstancedMesh;
    const expected = rangeTileKinds(terrain, center.x, center.y, 150, 190);
    const matrix = new Matrix4(), point = new Vector3();
    let slot = 0;
    for (let i = 0; i < expected.length; i++) if (expected[i]) {
      mesh.getMatrixAt(slot++, matrix);
      point.setFromMatrixPosition(matrix);
      const tile = tileCenter(i % terrain.cols, Math.floor(i / terrain.cols));
      expect(point.x).toBeCloseTo(tile.x / WORLD.hex);
      expect(point.z).toBeCloseTo(tile.y / WORLD.hex);
      expect(point.y).toBeCloseTo(visualTileHeight(terrain, i) + SURFACE_MAX_OFFSET + 0.02);
    }
    expect(mesh.count).toBe(slot);
    expect(range.root.userData.upgradeTiles).toBeGreaterThan(0);
    range.show(terrain, center.x, center.y, 150, null);
    expect(range.root.userData.upgradeTiles).toBe(0);
    range.hide(); expect(range.root.visible).toBe(false);
    disposeTerrain(new Group().add(range.root));
  });
});
