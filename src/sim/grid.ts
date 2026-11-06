import type { Enemy } from './state';

const CELL = 64;
const DIM = 128;
const MARGIN = 48; // Largest enemy radius, so queries can't miss big bodies.

/** Uniform grid centred near the player. Entities beyond its edge clamp into edge cells. */
export class Grid {
  private head = new Int32Array(DIM * DIM);
  private nextIdx: Int32Array;
  private ox = 0;
  private oy = 0;
  readonly a: Int32Array;
  readonly b: Int32Array;

  constructor(cap: number) {
    this.nextIdx = new Int32Array(cap);
    this.a = new Int32Array(cap);
    this.b = new Int32Array(cap);
  }

  rebuild(items: Enemy[], count: number, cx: number, cy: number): void {
    this.head.fill(-1);
    this.ox = cx - (DIM * CELL) / 2;
    this.oy = cy - (DIM * CELL) / 2;
    for (let i = 0; i < count; i++) {
      const c = this.cellOf(items[i].x, items[i].y);
      this.nextIdx[i] = this.head[c];
      this.head[c] = i;
    }
  }

  private clampCell(v: number): number {
    return v < 0 ? 0 : v >= DIM ? DIM - 1 : v;
  }

  private cellOf(x: number, y: number): number {
    return this.clampCell(Math.floor((y - this.oy) / CELL)) * DIM + this.clampCell(Math.floor((x - this.ox) / CELL));
  }

  /** Writes enemy indices near (x, y) into `out`; returns how many. Callers do exact distance checks. */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const R = r + MARGIN;
    const x0 = this.clampCell(Math.floor((x - R - this.ox) / CELL));
    const x1 = this.clampCell(Math.floor((x + R - this.ox) / CELL));
    const y0 = this.clampCell(Math.floor((y - R - this.oy) / CELL));
    const y1 = this.clampCell(Math.floor((y + R - this.oy) / CELL));
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = this.head[cy * DIM + cx]; i !== -1; i = this.nextIdx[i]) {
          if (n < out.length) out[n++] = i;
        }
      }
    }
    return n;
  }

  /** The chain in the cell at (x, y), for cheap separation. */
  firstAt(x: number, y: number): number {
    return this.head[this.cellOf(x, y)];
  }
  nextOf(i: number): number {
    return this.nextIdx[i];
  }
}
