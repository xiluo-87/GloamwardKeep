import { Box3, Ray, Vector3 } from 'three';

/** A blocker must lie on the ray from the mob toward an orthographic camera. */
export function blocksView(bounds: Box3, sample: Vector3, towardCamera: Vector3, ray = new Ray(), hit = new Vector3()): boolean {
  ray.set(sample, towardCamera);
  return ray.intersectBox(bounds, hit) !== null;
}

/** Exponential easing gives the same fade timing at different frame rates. */
export function fadeToward(current: number, target: number, dt: number, duration = 0.18): number {
  const value = target + (current - target) * Math.exp(-Math.max(0, dt) / duration);
  return Math.abs(value - target) < 0.003 ? target : value;
}
