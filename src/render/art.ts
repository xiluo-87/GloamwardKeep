// Shared drawing helpers for the code-drawn sprites. Sprites draw in local units (world pixels)
// with the origin at the foot of the figure and y pointing down.
export const TAU = Math.PI * 2;
export const OUT = '#2b2218';

/** 0 = normal, 1 = replace every fill with the tint, 2 = desaturate, 3 = blend 50% toward the tint. */
let mode = 0;
let tintC = '#ffffff';
const cache = new Map<string, string>();

export function setTint(m: 0 | 1 | 2 | 3, colour = '#ffffff'): void {
  mode = m;
  tintC = colour;
}

function parse(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Applies the current tint mode to a #rrggbb colour. */
export function C(c: string): string {
  if (mode === 0) return c;
  if (mode === 1) return tintC;
  const key = c + mode + tintC;
  let v = cache.get(key);
  if (v) return v;
  const [r, g, b] = parse(c);
  if (mode === 2) {
    const l = Math.round(r * 0.3 + g * 0.55 + b * 0.15);
    const q = Math.round(l * 0.8 + 40);
    v = '#' + ((1 << 24) | (q << 16) | (q << 8) | Math.min(255, q + 4)).toString(16).slice(1);
  } else {
    const [tr, tg, tb] = parse(tintC);
    v = '#' + ((1 << 24) | (Math.round((r + tr) / 2) << 16) | (Math.round((g + tg) / 2) << 8) | Math.round((b + tb) / 2)).toString(16).slice(1);
  }
  if (cache.size > 800) cache.clear();
  cache.set(key, v);
  return v;
}

export function fs(g: CanvasRenderingContext2D, fill: string, lw = 1.2): void {
  g.fillStyle = C(fill);
  g.fill();
  if (lw > 0) {
    g.strokeStyle = OUT;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.stroke();
  }
}
export function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 1.2, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  fs(g, fill, lw);
}
export function circ(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, lw = 1.2): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  fs(g, fill, lw);
}
export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, lw = 1.2): void {
  g.beginPath();
  g.rect(x, y, w, h);
  fs(g, fill, lw);
}
export function poly(g: CanvasRenderingContext2D, p: number[], fill: string, lw = 1.2): void {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
  fs(g, fill, lw);
}
/** A line with a dark outline underneath. */
export function stick(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, colour: string, w: number): void {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = OUT;
  g.lineWidth = w + 1.8;
  g.stroke();
  g.strokeStyle = C(colour);
  g.lineWidth = w;
  g.stroke();
}
/** A plain coloured line, no outline. */
export function seg(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, colour: string, w: number): void {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = C(colour);
  g.lineWidth = w;
  g.stroke();
}
/** Soft glow built from stacked translucent discs (no gradient allocation). */
export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number): void {
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = a * (0.25 + i * 0.2) ;
    g.fillStyle = rgb;
    g.beginPath();
    g.arc(x, y, r * (1 - i * 0.3), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Stable hash 0..1 of three integers. */
export function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Shade a #rrggbb colour by an amount (-1..1). */
export function shade(c: string, d: number): string {
  const [r, g, b] = parse(c);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(d >= 0 ? v + (255 - v) * d : v * (1 + d))));
  return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
}
