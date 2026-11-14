import type { Vector3 } from 'three';
import type { Painter } from './voxel-model';

/** First-artwork study, revised to a roofless platform with room for the bowman to turn. */
export function paintArcherTower(p: Painter, origin: Vector3): void {
  paintArcherPlatform(p, origin);
  paintArcherBowman(p, origin);
}

export function paintArcherPlatform(p: Painter, origin: Vector3): void {
  const { x, y, z } = origin;
  const box = (dx: number, dy: number, dz: number, w: number, h: number, d: number, color: string): void =>
    p.box(x + dx, y + dy, z + dz, w, h, d, color);
  const wood = '#956032', lightWood = '#bd8445', darkWood = '#674329';
  for (const dx of [-0.43, 0.43]) for (const dz of [-0.39, 0.39]) {
    box(dx, 0.06, dz, 0.26, 0.12, 0.26, '#a29d88');
    box(dx, 0.58, dz, 0.16, 1.12, 0.16, wood);
  }
  // Stepped diagonals keep every part cubic, including the X braces on all four sides.
  for (let step = 0; step < 8; step++) {
    const a = -0.35 + step * 0.1, up = 0.23 + step * 0.1;
    for (const sign of [-1, 1]) {
      box(a, up, sign * 0.39, 0.14, 0.15, 0.1, darkWood);
      box(-a, up, sign * 0.39, 0.14, 0.15, 0.1, wood);
      box(sign * 0.43, up, a * 0.9, 0.1, 0.15, 0.14, darkWood);
      box(sign * 0.43, up, -a * 0.9, 0.1, 0.15, 0.14, wood);
    }
  }
  box(0, 1.08, 0, 1.18, 0.16, 1.08, darkWood);
  for (let i = 0; i < 7; i++) box(-0.48 + i * 0.16, 1.18, 0, 0.15, 0.08, 1.08, i % 2 ? wood : lightWood);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 6; i++) box(-0.45 + i * 0.18, 1.34, sign * 0.48, 0.16, 0.25, 0.1, wood);
    box(0, 1.49, sign * 0.48, 1.14, 0.09, 0.15, lightWood);
    box(sign * 0.52, 1.34, 0, 0.1, 0.25, 0.86, wood);
    box(sign * 0.52, 1.49, 0, 0.15, 0.09, 1.04, lightWood);
  }
}

/** Separate from the platform so live targeting can turn the bowman independently. */
export function paintArcherBowman(p: Painter, origin: Vector3): void {
  const { x, y, z } = origin;
  const box = (dx: number, dy: number, dz: number, w: number, h: number, d: number, color: string): void =>
    p.box(x + dx, y + dy, z + dz, w, h, d, color);
  // An original, deliberately small bowman on the open platform.
  const figure = (dx: number, dy: number, dz: number, w: number, h: number, d: number, color: string): void =>
    box(dx, dy, dz + 0.2, w, h, d, color);
  figure(0, 1.37, 0.04, 0.24, 0.28, 0.2, '#4c5560');
  figure(0, 1.59, 0.04, 0.34, 0.3, 0.26, '#657b87');
  figure(0, 1.86, 0.08, 0.32, 0.28, 0.29, '#d3a674');
  figure(0, 2.01, 0.06, 0.39, 0.11, 0.35, '#848b86');
  figure(-0.15, 1.92, 0.04, 0.08, 0.16, 0.29, '#626d70');
  for (const dx of [-0.075, 0.075]) figure(dx, 1.88, 0.23, 0.045, 0.05, 0.025, '#242c29');
  figure(-0.21, 1.64, 0.18, 0.14, 0.15, 0.3, '#d3a674');
  figure(0.2, 1.65, 0.2, 0.13, 0.14, 0.32, '#d3a674');
  for (let i = 0; i < 7; i++) {
    const offset = Math.abs(i - 3);
    figure(0.3 + (3 - offset) * 0.025, 1.46 + i * 0.075, 0.36, 0.055, 0.08, 0.055, '#b28b51');
  }
  figure(0.3, 1.68, 0.36, 0.018, 0.44, 0.018, '#d9cba7');
}
