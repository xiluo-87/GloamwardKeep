import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FEATURE } from '../src/sim/mapgen';
import { paintNature } from '../src/camera-preview/nature-models';
import { Painter } from '../src/camera-preview/voxel-model';

const origin = new Vector3(4, 0.56, 7);

function paint(kind: number, index: number, seed: number): Painter {
  const result = new Painter();
  paintNature(result, kind, origin, index, seed);
  return result;
}

describe('deterministic nature voxels', () => {
  it('is repeatable and changes decoration with the seed or tile index', () => {
    expect(paint(FEATURE.forest, 17, 42).parts).toEqual(paint(FEATURE.forest, 17, 42).parts);
    expect(paint(FEATURE.rocks, 17, 42).parts).toEqual(paint(FEATURE.rocks, 17, 42).parts);
    expect(paint(FEATURE.forest, 17, 42).parts).not.toEqual(paint(FEATURE.forest, 17, 43).parts);
    expect(paint(FEATURE.rocks, 17, 42).parts).not.toEqual(paint(FEATURE.rocks, 18, 42).parts);
  });

  it('keeps forest silhouettes and bush clumps within the tile footprint and height budget', () => {
    const model = paint(FEATURE.forest, 5, 2178416768);
    expect(model.parts.length).toBeGreaterThan(50);
    for (const part of model.parts) {
      expect([part.x, part.y, part.z, part.w, part.h, part.d].every(Number.isFinite)).toBe(true);
      expect(part.w).toBeGreaterThan(0);
      expect(part.h).toBeGreaterThan(0);
      expect(part.d).toBeGreaterThan(0);
      const dx = Math.abs(part.x - origin.x) + part.w / 2;
      const dz = Math.abs(part.z - origin.z) + part.d / 2;
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(0.7);
      expect(part.y - origin.y - part.h / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(part.y - origin.y + part.h / 2).toBeLessThanOrEqual(1.35);
    }
    const leaves = new Set(['#355727', '#486b27', '#62822d', '#7d9635', '#8fa43c']);
    const centralCanopy = model.parts.filter((part) => leaves.has(part.color)
      && Math.abs(part.x - origin.x) < 0.07 && Math.abs(part.z - origin.z) < 0.07)
      .sort((a, b) => a.y - b.y);
    expect(centralCanopy).toHaveLength(6);
    for (let n = 1; n < centralCanopy.length; n++) {
      const lower = centralCanopy[n - 1], upper = centralCanopy[n];
      expect(upper.y - lower.y).toBeLessThanOrEqual((lower.h + upper.h) / 2 + 1e-6);
    }
  });

  it('makes varied chunky rock clusters within the same footprint and height budget', () => {
    const model = paint(FEATURE.rocks, 11, 7);
    expect(model.parts.length).toBeGreaterThanOrEqual(6);
    expect(model.parts.length).toBeLessThanOrEqual(11);
    expect(Math.max(...model.parts.map((part) => part.y - origin.y + part.h / 2))).toBeGreaterThan(0.48);
    for (const part of model.parts) {
      expect([part.x, part.y, part.z, part.w, part.h, part.d].every(Number.isFinite)).toBe(true);
      expect([part.w, part.h, part.d].every((size) => size > 0)).toBe(true);
      expect(part.h).toBeGreaterThanOrEqual(0.75 * Math.min(part.w, part.d));
      expect(part.h).toBeLessThanOrEqual(1.3 * Math.max(part.w, part.d));
      expect(Math.hypot(Math.abs(part.x - origin.x) + part.w / 2, Math.abs(part.z - origin.z) + part.d / 2)).toBeLessThanOrEqual(0.7);
      expect(part.y - origin.y - part.h / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(part.y - origin.y + part.h / 2).toBeLessThanOrEqual(0.65);
      const bottom = part.y - part.h / 2;
      if (bottom > origin.y + 1e-6) expect(model.parts.some((base) => base !== part
        && Math.abs(base.y + base.h / 2 - bottom) < 1e-6
        && Math.abs(base.x - part.x) < (base.w + part.w) / 2
        && Math.abs(base.z - part.z) < (base.d + part.d) / 2)).toBe(true);
    }
  });

  it('leaves FEATURE.none empty and does not use global random state', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('unexpected global randomness'); });
    expect(paint(FEATURE.none, 2, 3).parts).toEqual([]);
    expect(paint(FEATURE.forest, 2, 3).parts.length).toBeGreaterThan(0);
    expect(paint(FEATURE.rocks, 2, 3).parts.length).toBeGreaterThan(0);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
