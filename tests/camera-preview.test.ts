import { Box3, OrthographicCamera, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, fitCamera, MAX_ZOOM, TILTS, zoomCameraAt } from '../src/camera-preview/camera';

const bounds = new Box3(new Vector3(0, -0.18, 0), new Vector3(43, 3, 22));

describe('camera comparison math', () => {
  it('fits every bounding-box corner at all candidate angles on wide and narrow screens', () => {
    for (const aspect of [1.7, 0.65]) for (const direction of DIRECTIONS) for (const tilt of TILTS) {
      const camera = new OrthographicCamera();
      fitCamera(camera, bounds, aspect, direction.azimuth, tilt);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const screen = new Vector3(x, y, z).project(camera);
        expect(Math.abs(screen.x)).toBeLessThan(0.92);
        expect(Math.abs(screen.y)).toBeLessThan(0.92);
        expect(Math.abs(screen.z)).toBeLessThan(1);
      }
    }
  });

  it('keeps an elevated terrain anchor fixed on screen while zooming without rotating', () => {
    for (const direction of DIRECTIONS) for (const tilt of TILTS) {
      const camera = new OrthographicCamera();
      fitCamera(camera, bounds, 1.5, direction.azimuth, tilt);
      const anchor = new Vector3(31, 1.12, 7);
      const before = anchor.clone().project(camera);
      const orientation = camera.quaternion.clone();
      const height = camera.position.y;
      const point = new Vector2(before.x, before.y);
      for (const factor of [1.6, 1.5, 0.8, 1.2]) {
        zoomCameraAt(camera, point, anchor, factor);
        const after = anchor.clone().project(camera);
        expect(after.x).toBeCloseTo(before.x, 10);
        expect(after.y).toBeCloseTo(before.y, 10);
        expect(camera.quaternion.equals(orientation)).toBe(true);
        expect(camera.position.y).toBeCloseTo(height, 10);
      }
    }
  });

  it('bounds preview zoom and ignores invalid scale factors', () => {
    const camera = new OrthographicCamera();
    fitCamera(camera, bounds, 1.5, 45, 35);
    const anchor = bounds.getCenter(new Vector3());
    const point = new Vector2(0, 0);
    for (const factor of [NaN, Infinity, 0, -2]) zoomCameraAt(camera, point, anchor, factor);
    expect(camera.zoom).toBe(1);
    zoomCameraAt(camera, point, anchor, 100);
    expect(camera.zoom).toBe(MAX_ZOOM);
    zoomCameraAt(camera, point, anchor, 0.001);
    expect(camera.zoom).toBe(1);
  });
});
