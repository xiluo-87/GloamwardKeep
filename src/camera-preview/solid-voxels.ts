import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three';
import type { Voxel } from './voxel-model';

interface Bounds { min: number[]; max: number[] }
interface Rect { u0: number; u1: number; v0: number; v1: number }

const EPSILON = 1e-6;

function boundsOf(part: Voxel): Bounds {
  return {
    min: [part.x - part.w / 2, part.y - part.h / 2, part.z - part.d / 2],
    max: [part.x + part.w / 2, part.y + part.h / 2, part.z + part.d / 2],
  };
}

function subtract(rect: Rect, cut: Rect): Rect[] {
  const u0 = Math.max(rect.u0, cut.u0), u1 = Math.min(rect.u1, cut.u1);
  const v0 = Math.max(rect.v0, cut.v0), v1 = Math.min(rect.v1, cut.v1);
  if (u1 - u0 <= EPSILON || v1 - v0 <= EPSILON) return [rect];
  const pieces: Rect[] = [];
  if (u0 - rect.u0 > EPSILON) pieces.push({ u0: rect.u0, u1: u0, v0: rect.v0, v1: rect.v1 });
  if (rect.u1 - u1 > EPSILON) pieces.push({ u0: u1, u1: rect.u1, v0: rect.v0, v1: rect.v1 });
  if (v0 - rect.v0 > EPSILON) pieces.push({ u0, u1, v0: rect.v0, v1: v0 });
  if (rect.v1 - v1 > EPSILON) pieces.push({ u0, u1, v0: v1, v1: rect.v1 });
  return pieces;
}

function positiveVolumeOverlap(a: Bounds, b: Bounds): boolean {
  return [0, 1, 2].every((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > EPSILON);
}

function faceRect(bounds: Bounds, u: number, v: number): Rect {
  return { u0: bounds.min[u], u1: bounds.max[u], v0: bounds.min[v], v1: bounds.max[v] };
}

function faceCoveredBy(other: Bounds, axis: number, sign: number, plane: number): boolean {
  return sign > 0
    ? other.min[axis] <= plane + EPSILON && other.max[axis] > plane + EPSILON
    : other.max[axis] >= plane - EPSILON && other.min[axis] < plane - EPSILON;
}

function emitRect(
  rect: Rect, bounds: Bounds, axis: number, sign: number, u: number, v: number,
  color: Color, positions: number[], normals: number[], colors: number[],
): void {
  const plane = sign > 0 ? bounds.max[axis] : bounds.min[axis];
  const points: number[][] = [];
  for (const [uc, vc] of [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]]) {
    const point = [0, 0, 0];
    point[axis] = plane;
    point[u] = uc;
    point[v] = vc;
    points.push(point);
  }
  const order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const index of order) {
    positions.push(...points[index]);
    normals.push(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    colors.push(color.r, color.g, color.b);
  }
}

/** Builds a nonindexed, opaque vertex-colored surface for the exterior of overlapping Painter boxes. */
export function buildSolidVoxels(parts: readonly Voxel[]): Mesh<BufferGeometry, MeshStandardMaterial> {
  const bounds = parts.map(boundsOf);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  parts.forEach((part, index) => {
    const color = new Color(part.color);
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const sign of [-1, 1]) {
        const plane = sign > 0 ? bounds[index].max[axis] : bounds[index].min[axis];
        let remaining = [faceRect(bounds[index], u, v)];
        for (let otherIndex = 0; otherIndex < parts.length && remaining.length; otherIndex++) {
          if (otherIndex === index) continue;
          const other = bounds[otherIndex];
          const coplanarEarlier = otherIndex < index
            && Math.abs((sign > 0 ? other.max[axis] : other.min[axis]) - plane) <= EPSILON;
          if (coplanarEarlier && positiveVolumeOverlap(bounds[index], other)) {
            remaining = remaining.flatMap((rect) => subtract(rect, faceRect(other, u, v)));
            continue;
          }
          if (!faceCoveredBy(other, axis, sign, plane)) continue;
          remaining = remaining.flatMap((rect) => subtract(rect, faceRect(other, u, v)));
        }
        for (const rect of remaining) emitRect(rect, bounds[index], axis, sign, u, v, color, positions, normals, colors);
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  if (positions.length) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  return new Mesh(geometry, material);
}
