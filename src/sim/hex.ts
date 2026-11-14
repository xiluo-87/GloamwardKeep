// Hex grid geometry. Pointy-top hexes in "odd-r" offset layout: odd rows sit half a hex to the right.
// Tiles are addressed by (col, row) and stored row-major, index = row * cols + col.
import { WORLD } from '../data/balance';

const SQRT3 = Math.sqrt(3);

/** Distance between the centres of horizontal neighbours, in world pixels. */
export const HEX_W = SQRT3 * WORLD.hex;
/** Vertical distance between row centres, in world pixels. */
export const HEX_H = 1.5 * WORLD.hex;

/** World size of the board in pixels (including the half-hex overhang of odd rows). */
export const boardWidth = (cols: number): number => HEX_W * (cols + 0.5);
export const boardHeight = (rows: number): number => HEX_H * (rows - 1) + 2 * WORLD.hex;

/** Centre of a tile in world pixels. */
export function tileCenter(col: number, row: number): { x: number; y: number } {
  return { x: HEX_W * (col + 0.5 * (row & 1)) + HEX_W / 2, y: HEX_H * row + WORLD.hex };
}

const EVEN: [number, number][] = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const ODD: [number, number][] = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];

/** The six neighbour offsets (dcol, drow) for a tile in the given row. */
export const hexNeighbours = (row: number): [number, number][] => ((row & 1) ? ODD : EVEN);

/** Offset coordinates to cube coordinates. */
export function toCube(col: number, row: number): [number, number, number] {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return [x, -x - z, z];
}

export function hexDistance(c0: number, r0: number, c1: number, r1: number): number {
  const a = toCube(c0, r0);
  const b = toCube(c1, r1);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** In-bounds tile indices in a hex disk, in stable row-major order. */
export function tilesWithinHexRadius(col: number, row: number, radius: number, cols: number, rows: number): number[] {
  const tiles: number[] = [];
  for (let y = Math.max(0, row - radius); y <= Math.min(rows - 1, row + radius); y++) {
    for (let x = Math.max(0, col - radius - 1); x <= Math.min(cols - 1, col + radius + 1); x++) {
      if (hexDistance(col, row, x, y) <= radius) tiles.push(y * cols + x);
    }
  }
  return tiles;
}

/** Tile containing a world point, or null if off the board. */
export function pixelToTile(px: number, py: number, cols: number, rows: number): { col: number; row: number } | null {
  // Fractional axial coordinates, then cube rounding.
  const x = px - HEX_W / 2;
  const y = py - WORLD.hex;
  const q = (SQRT3 / 3 * x - y / 3) / WORLD.hex;
  const r = (2 / 3 * y) / WORLD.hex;
  let cx = q;
  let cz = r;
  let cy = -cx - cz;
  let rx = Math.round(cx);
  let ry = Math.round(cy);
  let rz = Math.round(cz);
  const dx = Math.abs(rx - cx);
  const dy = Math.abs(ry - cy);
  const dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  cx = rx; cy = ry; cz = rz;
  const row = cz;
  const col = cx + (row - (row & 1)) / 2;
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}
