import { Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FEATURE } from '../src/sim/mapgen';
import { paintNature } from '../src/camera-preview/nature-models';
import { buildSolidVoxels } from '../src/camera-preview/solid-voxels';
import { Painter, type Voxel } from '../src/camera-preview/voxel-model';

function box(x: number, y: number, z: number, w: number, h: number, d: number, color = '#808080'): Voxel {
  return { x, y, z, w, h, d, color };
}

function surfaceArea(mesh: ReturnType<typeof buildSolidVoxels>): number {
  const position = mesh.geometry.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let area = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
}

describe('solid voxel surface builder', () => {
  it('removes the shared interface between adjacent cubes', () => {
    const mesh = buildSolidVoxels([box(0, 0, 0, 1, 1, 1), box(1, 0, 0, 1, 1, 1, '#ff0000')]);
    expect(surfaceArea(mesh)).toBeCloseTo(10, 5);
    expect(mesh.material.transparent).toBe(false);
    expect(mesh.material.roughness).toBe(1);
    expect(mesh.material.vertexColors).toBe(true);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('subtracts partially covered faces and emits coplanar duplicates only once', () => {
    const overlap = buildSolidVoxels([
      box(0.5, 0.5, 0.5, 1, 1, 1),
      box(1, 0.5, 0.5, 1, 0.5, 0.5, '#d08040'),
    ]);
    expect(surfaceArea(overlap)).toBeCloseTo(7, 5);
    const duplicate = buildSolidVoxels([box(0, 0, 0, 1, 1, 1), box(0, 0, 0, 1, 1, 1, '#ff0000')]);
    expect(surfaceArea(duplicate)).toBeCloseTo(6, 5);
    expect(duplicate.geometry.getAttribute('position').count).toBe(36);
    overlap.geometry.dispose(); overlap.material.dispose();
    duplicate.geometry.dispose(); duplicate.material.dispose();
  });

  it('has outward top, bottom and front normals for raycasts', () => {
    const mesh = buildSolidVoxels([box(0, 0, 0, 1, 1, 1)]);
    const cases = [
      [new Vector3(0, 2, 0), new Vector3(0, -1, 0), new Vector3(0, 1, 0)],
      [new Vector3(0, -2, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0)],
      [new Vector3(0, 0, 2), new Vector3(0, 0, -1), new Vector3(0, 0, 1)],
    ];
    for (const [origin, direction, normal] of cases) {
      const hit = new Raycaster(origin as Vector3, direction as Vector3).intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      expect(hit!.face!.normal.distanceTo(normal as Vector3)).toBeLessThan(1e-6);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('handles empty input and produces finite geometry from real nature voxels', () => {
    const empty = buildSolidVoxels([]);
    expect(empty.geometry.getAttribute('position').count).toBe(0);
    const parts = new Painter();
    paintNature(parts, FEATURE.forest, new Vector3(0, 0, 0), 4, 9);
    const mesh = buildSolidVoxels(parts.parts);
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const color = mesh.geometry.getAttribute('color');
    expect(position.count).toBeGreaterThan(0);
    for (const attribute of [position, normal, color]) {
      for (let i = 0; i < attribute.count * attribute.itemSize; i++) expect(Number.isFinite(attribute.array[i])).toBe(true);
    }
    empty.geometry.dispose(); empty.material.dispose();
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
