import { Box3, MathUtils, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

// Shared camera presets. Southeast/35.3° is the confirmed default; framing/zoom tuning remains open.
export const DIRECTIONS = [
  { label: 'Southeast', short: 'SE', azimuth: 45 },
  { label: 'Northeast', short: 'NE', azimuth: 135 },
  { label: 'Northwest', short: 'NW', azimuth: 225 },
  { label: 'Southwest', short: 'SW', azimuth: 315 },
] as const;
export const TILTS = [25, MathUtils.radToDeg(Math.atan(1 / Math.sqrt(2))), 45, 55];
export const MAX_ZOOM = 4;
export const tiltLabel = (tilt: number): string => `${Number(tilt.toFixed(1))}°`;

/** Fit the complete blockout, including props, with the same margin in every candidate view. */
export function fitCamera(camera: OrthographicCamera, bounds: Box3, aspect: number, azimuth: number, tilt: number): void {
  const center = bounds.getCenter(new Vector3());
  const distance = bounds.getSize(new Vector3()).length() * 2 + 10;
  const az = MathUtils.degToRad(azimuth);
  const elevation = MathUtils.degToRad(tilt);
  camera.position.set(Math.sin(az) * Math.cos(elevation), Math.sin(elevation), Math.cos(az) * Math.cos(elevation))
    .multiplyScalar(distance).add(center);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.near = 0.1;
  camera.far = distance * 3;
  camera.zoom = 1;
  camera.updateMatrixWorld(true);
  let halfWidth = 0;
  let halfHeight = 0;
  const corner = new Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    halfWidth = Math.max(halfWidth, Math.abs(corner.x));
    halfHeight = Math.max(halfHeight, Math.abs(corner.y));
  }
  halfHeight = Math.max(halfHeight, halfWidth / aspect) * 1.1;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

/** Change scale while keeping an elevated terrain point under the same screen coordinate. */
export function zoomCameraAt(camera: OrthographicCamera, screen: Vector2, anchor: Vector3, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  camera.zoom = MathUtils.clamp(camera.zoom * factor, 1, MAX_ZOOM);
  camera.updateProjectionMatrix();
  const raycaster = new Raycaster();
  raycaster.setFromCamera(screen, camera);
  const after = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -anchor.y), new Vector3());
  if (after) camera.position.add(anchor.clone().sub(after));
  camera.updateMatrixWorld(true);
}
