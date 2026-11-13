// Static terrain: pointy-top hexes drawn as terraces, baked once into an offscreen canvas.
import { WORLD } from '../data/balance';
import { boardHeight, boardWidth, hexNeighbours, tileCenter } from '../sim/hex';
import { FEATURE, Terrain } from '../sim/mapgen';
import { circ, ell, hash3, poly, rect, shade, TAU } from './art';

/** Pixels each height level lifts a tile. */
export const LIFT = 5;
/** Extra world pixels above the board so raised tiles on the first row fit. */
export const TOP_MARGIN = 4 * LIFT + 8;
const PAD_X = 6;
const PAD_BOTTOM = 8;

const R = WORLD.hex;
const TOPS = ['#c9b07a', '#74a04e', '#5a8540', '#80786a', '#e6e8ec'];
const SIDES = ['#9c8556', '#4f7335', '#3d5c2a', '#5b5449', '#a4a9b3'];

// Hex corner offsets (pointy-top): index 0 is the right-upper corner, going clockwise on screen.
const CX: number[] = [];
const CY: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i - 30);
  CX.push(R * Math.cos(a));
  CY.push(R * Math.sin(a));
}

export function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r = 1): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) g.lineTo(cx + CX[i] * r, cy + CY[i] * r);
  g.closePath();
}

/** Adds a hex as a subpath (no beginPath) so many hexes can share one stroke. */
export function hexSub(g: CanvasRenderingContext2D, cx: number, cy: number, r = 1): void {
  g.moveTo(cx + CX[0] * r, cy + CY[0] * r);
  for (let i = 1; i < 6; i++) g.lineTo(cx + CX[i] * r, cy + CY[i] * r);
  g.closePath();
}

export interface Bake { canvas: HTMLCanvasElement; scale: number; version: number }
const bakes = new WeakMap<Terrain, Bake>();

const bucket = (s: number): number => (s <= 0.5 ? 0.5 : s <= 1 ? 1 : s <= 1.5 ? 1.5 : s <= 2 ? 2 : s <= 3 ? 3 : 4);

/** Returns the baked canvas for a terrain at roughly the requested pixel scale. */
export function getBake(t: Terrain, scale: number, version = 0): Bake {
  const b = bucket(scale);
  let bk = bakes.get(t);
  if (!bk || bk.scale !== b || bk.version !== version) {
    bk = { canvas: bakeTerrain(t, b), scale: b, version };
    bakes.set(t, bk);
  }
  return bk;
}

/** Draws the baked terrain with world origin at (ox, oy) device px and k device px per world px. */
export function blitBake(g: CanvasRenderingContext2D, t: Terrain, ox: number, oy: number, k: number, scaleHint: number, version = 0): void {
  const bk = getBake(t, scaleHint, version);
  g.drawImage(bk.canvas, ox - PAD_X * k, oy - TOP_MARGIN * k, bk.canvas.width / bk.scale * k, bk.canvas.height / bk.scale * k);
}

export function bakeTerrain(t: Terrain, scale: number): HTMLCanvasElement {
  const w = boardWidth(t.cols) + PAD_X * 2;
  const h = boardHeight(t.rows) + TOP_MARGIN + PAD_BOTTOM;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(scale, 0, 0, scale, PAD_X * scale, TOP_MARGIN * scale);
  // Soft ground shadow under the board edge so it sits on the vignette.
  const hAt = (col: number, row: number): number => (col < 0 || row < 0 || col >= t.cols || row >= t.rows ? -1 : t.height[row * t.cols + col]);
  for (let row = 0; row < t.rows; row++) {
    for (let col = 0; col < t.cols; col++) drawTile(g, t, col, row, hAt);
  }
  // Gates and the keep sit on top of their tiles.
  for (const [col, row] of t.spawns) {
    const p = tileCenter(col, row);
    drawGate(g, p.x, p.y - t.height[row * t.cols + col] * LIFT);
  }
  const [gc, gr] = t.goal;
  const gp = tileCenter(gc, gr);
  drawKeep(g, gp.x, gp.y - t.height[gr * t.cols + gc] * LIFT);
  return c;
}

function rgbOf(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function tint(c: string, d: number): string {
  const [r, g, b] = rgbOf(c);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * (1 + d))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function drawTile(g: CanvasRenderingContext2D, t: Terrain, col: number, row: number, hAt: (c: number, r: number) => number): void {
  const i = row * t.cols + col;
  const h = t.height[i];
  const p = tileCenter(col, row);
  const cx = p.x;
  const cy = p.y - h * LIFT;
  const v = hash3(col, row, 11);
  const v2 = hash3(col, row, 23);
  const var_ = (v - 0.5) * 0.12;

  // Side faces (the two lower edges, extruded down to the ground).
  if (h > 0) {
    const d = h * LIFT;
    g.beginPath();
    g.moveTo(cx + CX[1], cy + CY[1]);
    g.lineTo(cx + CX[2], cy + CY[2]);
    g.lineTo(cx + CX[2], cy + CY[2] + d);
    g.lineTo(cx + CX[1], cy + CY[1] + d);
    g.closePath();
    g.fillStyle = tint(SIDES[h], -0.14 + var_ * 0.5);
    g.fill();
    g.beginPath();
    g.moveTo(cx + CX[2], cy + CY[2]);
    g.lineTo(cx + CX[3], cy + CY[3]);
    g.lineTo(cx + CX[3], cy + CY[3] + d);
    g.lineTo(cx + CX[2], cy + CY[2] + d);
    g.closePath();
    g.fillStyle = tint(SIDES[h], 0.04 + var_ * 0.5);
    g.fill();
    // Strata lines on rock and snow, grass roots on the green terraces.
    g.strokeStyle = h >= 3 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)';
    g.lineWidth = 0.8;
    for (let s = 1; s < h; s++) {
      const y = cy + s * LIFT;
      g.beginPath();
      g.moveTo(cx + CX[3], y + CY[3]);
      g.lineTo(cx + CX[2], y + CY[2]);
      g.lineTo(cx + CX[1], y + CY[1]);
      g.stroke();
    }
    // Dark base line.
    g.strokeStyle = 'rgba(20,16,10,0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx + CX[3], cy + CY[3] + d);
    g.lineTo(cx + CX[2], cy + CY[2] + d);
    g.lineTo(cx + CX[1], cy + CY[1] + d);
    g.moveTo(cx + CX[1], cy + CY[1]);
    g.lineTo(cx + CX[1], cy + CY[1] + d);
    g.moveTo(cx + CX[3], cy + CY[3]);
    g.lineTo(cx + CX[3], cy + CY[3] + d);
    g.stroke();
  }

  // Top face.
  hexPath(g, cx, cy, 0.995);
  g.fillStyle = tint(TOPS[h], var_);
  g.fill();

  g.save();
  hexPath(g, cx, cy, 1);
  g.clip();
  if (h === 0) roadTexture(g, cx, cy, col, row);
  else groundTexture(g, cx, cy, h, col, row, v2);

  // Soft shadow where a taller neighbour stands next to this tile.
  const nb = hexNeighbours(row);
  for (let k = 0; k < 6; k++) {
    const nc = col + nb[k][0];
    const nr = row + nb[k][1];
    const dh = hAt(nc, nr) - h;
    if (dh <= 0) continue;
    const q = tileCenter(nc, nr);
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ex = cx + dx * R * 0.87;
    const ey = cy + dy * R * 0.87;
    const gr = g.createLinearGradient(ex, ey, ex - dx * 15, ey - dy * 15);
    const a = Math.min(0.42, 0.14 + 0.1 * dh) * (dx < 0 ? 1.35 : 1);
    gr.addColorStop(0, `rgba(25,20,30,${a})`);
    gr.addColorStop(1, 'rgba(25,20,30,0)');
    g.fillStyle = gr;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  g.restore();

  // Bright rim along the upper edges of raised tiles, outline for all.
  if (h > 0) {
    g.strokeStyle = 'rgba(255,255,230,0.22)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx + CX[3] + 1, cy + CY[3] - 1);
    g.lineTo(cx + CX[4], cy + CY[4] + 1);
    g.lineTo(cx + CX[5], cy + CY[5] + 1);
    g.stroke();
  }
  hexPath(g, cx, cy, 0.995);
  g.strokeStyle = h === 0 ? 'rgba(70,52,26,0.35)' : 'rgba(10,20,5,0.3)';
  g.lineWidth = 0.9;
  g.stroke();

  const f = t.feature[i];
  if (f === FEATURE.forest) forest(g, cx, cy, col, row);
  else if (f === FEATURE.rocks) rocks(g, cx, cy, col, row);
}

function roadTexture(g: CanvasRenderingContext2D, cx: number, cy: number, col: number, row: number): void {
  // Cobbles: small rounded stones in slightly different sandy tones.
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = hash3(col, row, 100 + k) * TAU;
    const rr = Math.sqrt(hash3(col, row, 200 + k)) * R * 0.78;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.9;
    const s = 3.4 + hash3(col, row, 300 + k) * 2.8;
    const tone = hash3(col, row, 400 + k);
    g.beginPath();
    g.ellipse(x, y, s, s * 0.7, hash3(col, row, 500 + k) * 3, 0, TAU);
    g.fillStyle = tone > 0.5 ? 'rgba(255,240,200,0.28)' : 'rgba(120,90,50,0.22)';
    g.fill();
    g.strokeStyle = 'rgba(90,66,34,0.28)';
    g.lineWidth = 0.7;
    g.stroke();
  }
  // Dirt specks.
  g.fillStyle = 'rgba(100,72,36,0.35)';
  for (let k = 0; k < 6; k++) {
    const x = cx + (hash3(col, row, 600 + k) - 0.5) * R * 1.4;
    const y = cy + (hash3(col, row, 700 + k) - 0.5) * R * 1.3;
    g.fillRect(x, y, 1.3, 1.3);
  }
}

function groundTexture(g: CanvasRenderingContext2D, cx: number, cy: number, h: number, col: number, row: number, v2: number): void {
  if (h <= 2) {
    // Grass tufts and the odd flower.
    g.strokeStyle = h === 1 ? 'rgba(40,80,30,0.45)' : 'rgba(30,60,25,0.45)';
    g.lineWidth = 0.9;
    for (let k = 0; k < 7; k++) {
      const x = cx + (hash3(col, row, 10 + k) - 0.5) * R * 1.45;
      const y = cy + (hash3(col, row, 20 + k) - 0.5) * R * 1.3;
      g.beginPath();
      g.moveTo(x - 1.5, y);
      g.lineTo(x - 2.2, y - 3);
      g.moveTo(x, y);
      g.lineTo(x, y - 3.6);
      g.moveTo(x + 1.5, y);
      g.lineTo(x + 2.2, y - 3);
      g.stroke();
    }
    if (v2 > 0.72) {
      const x = cx + (hash3(col, row, 31) - 0.5) * R;
      const y = cy + (hash3(col, row, 32) - 0.5) * R;
      g.fillStyle = v2 > 0.86 ? '#f2e46a' : '#f4f0ea';
      g.beginPath();
      g.arc(x, y, 1.5, 0, TAU);
      g.fill();
    }
  } else if (h === 3) {
    g.fillStyle = 'rgba(40,36,30,0.22)';
    for (let k = 0; k < 8; k++) {
      const x = cx + (hash3(col, row, 40 + k) - 0.5) * R * 1.5;
      const y = cy + (hash3(col, row, 50 + k) - 0.5) * R * 1.3;
      g.beginPath();
      g.ellipse(x, y, 2.5, 1.5, hash3(col, row, 60 + k) * 3, 0, TAU);
      g.fill();
    }
  } else {
    g.fillStyle = 'rgba(150,175,215,0.35)';
    for (let k = 0; k < 6; k++) {
      const x = cx + (hash3(col, row, 70 + k) - 0.5) * R * 1.5;
      const y = cy + (hash3(col, row, 80 + k) - 0.5) * R * 1.3;
      g.beginPath();
      g.ellipse(x, y, 4, 1.6, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 4; k++) g.fillRect(cx + (hash3(col, row, 90 + k) - 0.5) * R * 1.3, cy + (hash3(col, row, 95 + k) - 0.5) * R, 1.4, 1.4);
  }
}

function forest(g: CanvasRenderingContext2D, cx: number, cy: number, col: number, row: number): void {
  const spots = [[-9, 5], [8, 6], [-1, -2], [-12, -6], [11, -5]];
  const n = 4 + (hash3(col, row, 3) > 0.5 ? 1 : 0);
  // Back to front.
  const order = [3, 4, 2, 0, 1];
  for (let q = 0; q < n; q++) {
    const idx = order[q];
    const [dx, dy] = spots[idx];
    const s = 8 + hash3(col, row, 300 + idx) * 3.5;
    const x = cx + dx + (hash3(col, row, 310 + idx) - 0.5) * 3;
    const y = cy + dy;
    const dark = hash3(col, row, 320 + idx) > 0.5;
    g.fillStyle = shade('#4a3420', 0);
    g.fillRect(x - 1.2, y - 1, 2.4, 4);
    for (let tier = 0; tier < 3; tier++) {
      const ty = y - tier * s * 0.38;
      const w = s * (0.85 - tier * 0.22);
      poly(g, [x - w, ty, x, ty - s * 0.75, x + w, ty], tier === 0 ? (dark ? '#1f4a22' : '#2b5e2a') : (dark ? '#26582a' : '#37722f'), 0.9);
    }
    g.fillStyle = 'rgba(180,230,140,0.25)';
    g.beginPath();
    g.moveTo(x - s * 0.2, y - s * 0.45);
    g.lineTo(x, y - s * 1.2);
    g.lineTo(x + 0.5, y - s * 0.55);
    g.fill();
  }
}

function rocks(g: CanvasRenderingContext2D, cx: number, cy: number, col: number, row: number): void {
  const spots = [[-6, 4, 7], [7, 3, 6], [0, -4, 7], [-10, -3, 4.5]];
  for (let k = 0; k < spots.length; k++) {
    const [dx, dy, s0] = spots[k];
    const s = s0 + (hash3(col, row, 410 + k) - 0.5) * 2;
    ell(g, cx + dx + 1.5, cy + dy + s * 0.5, s * 1.05, s * 0.4, '#3a3a3a', 0);
    g.globalAlpha = 1;
    // Faceted boulder.
    const x = cx + dx;
    const y = cy + dy;
    poly(g, [x - s, y + s * 0.3, x - s * 0.7, y - s * 0.55, x - s * 0.1, y - s * 0.95, x + s * 0.7, y - s * 0.6, x + s, y + s * 0.25, x + s * 0.4, y + s * 0.6, x - s * 0.5, y + s * 0.6], '#7a7a80', 1);
    poly(g, [x - s * 0.7, y - s * 0.55, x - s * 0.1, y - s * 0.95, x + s * 0.7, y - s * 0.6, x + s * 0.1, y - s * 0.15, x - s * 0.55, y - s * 0.1], '#a5a5ab', 0);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x - s * 0.1, y - s * 0.1);
    g.lineTo(x + s * 0.1, y + s * 0.5);
    g.stroke();
  }
}

const SX = '#3d3a44';
export function drawGate(g: CanvasRenderingContext2D, x: number, y: number): void {
  // Dark stone gatehouse with an arched opening and two little towers.
  ell(g, x, y + 8, 24, 8, '#2a2418', 0);
  rect(g, x - 20, y - 14, 10, 24, '#6d6a74');
  rect(g, x + 10, y - 14, 10, 24, '#6d6a74');
  for (const sx of [-1, 1]) {
    const bx = x + sx * 15;
    poly(g, [bx - 7, y - 14, bx, y - 26, bx + 7, y - 14], '#8a2d2a');
    rect(g, bx - 1, y - 20, 2, 5, '#d9c9a0', 0.6);
  }
  rect(g, x - 11, y - 14, 22, 24, SX);
  g.beginPath();
  g.moveTo(x - 8, y + 10);
  g.lineTo(x - 8, y - 4);
  g.arc(x, y - 4, 8, Math.PI, 0);
  g.lineTo(x + 8, y + 10);
  g.closePath();
  g.fillStyle = '#120f14';
  g.fill();
  g.strokeStyle = '#26202a';
  g.lineWidth = 1.5;
  g.stroke();
  // Portcullis bars and glowing eyes.
  g.strokeStyle = '#444';
  g.lineWidth = 1;
  for (let k = -5; k <= 5; k += 3.3) {
    g.beginPath();
    g.moveTo(x + k, y - 10);
    g.lineTo(x + k, y - 4);
    g.stroke();
  }
  g.fillStyle = '#e04a30';
  g.fillRect(x - 4, y + 1, 2, 2);
  g.fillRect(x + 2, y + 1, 2, 2);
  // Merlons on the top.
  for (let k = -2; k <= 2; k++) rect(g, x + k * 4.4 - 1.6, y - 17, 3.2, 3.5, '#6d6a74', 0.8);
}

export function drawKeep(g: CanvasRenderingContext2D, x: number, y: number): void {
  ell(g, x, y + 8, 26, 9, '#2a2418', 0);
  // Curtain wall and towers.
  rect(g, x - 20, y - 14, 40, 22, '#b9b3a4');
  for (let k = 0; k < 4; k++) rect(g, x - 18 + k * 10, y - 18, 6, 5, '#b9b3a4', 0.9);
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = 0.7;
  for (let r = 0; r < 3; r++) {
    g.beginPath();
    g.moveTo(x - 20, y - 8 + r * 6);
    g.lineTo(x + 20, y - 8 + r * 6);
    g.stroke();
  }
  for (const sx of [-1, 1]) {
    const bx = x + sx * 19;
    rect(g, bx - 6, y - 26, 12, 34, '#a9a393');
    poly(g, [bx - 8, y - 26, bx, y - 38, bx + 8, y - 26], '#2f5fb8');
    rect(g, bx - 1.5, y - 20, 3, 6, '#2a2630', 0.8);
  }
  // Central keep.
  rect(g, x - 10, y - 32, 20, 40, '#c8c2b2');
  for (let k = 0; k < 3; k++) rect(g, x - 9 + k * 7, y - 36, 5, 5, '#c8c2b2', 0.9);
  g.beginPath();
  g.moveTo(x - 6, y + 8);
  g.lineTo(x - 6, y - 2);
  g.arc(x, y - 2, 6, Math.PI, 0);
  g.lineTo(x + 6, y + 8);
  g.closePath();
  g.fillStyle = '#5a3a1e';
  g.fill();
  g.strokeStyle = '#2b2218';
  g.lineWidth = 1.2;
  g.stroke();
  rect(g, x - 1.5, y - 22, 3, 8, '#2a2630', 0.8);
  circ(g, x + 3, y + 3, 0.9, '#e8b830', 0);
  // Pole (banner is animated live).
  g.fillStyle = '#4a3420';
  g.fillRect(x - 0.7, y - 52, 1.4, 17);
}

/** Waving banner for the keep, drawn live. */
export function drawKeepBanner(g: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const bx = x + 0.7;
  const by = y - 52;
  g.beginPath();
  g.moveTo(bx, by);
  for (let k = 0; k <= 6; k++) g.lineTo(bx + k * 2.4, by + Math.sin(time * 5 - k * 0.8) * 1.4 * (k / 6));
  for (let k = 6; k >= 0; k--) g.lineTo(bx + k * 2.4, by + 8 - Math.sin(time * 5 - k * 0.8) * 0.4 + Math.sin(time * 5 - k * 0.8) * 1.4 * (k / 6) - (k === 6 ? 2 : 0));
  g.closePath();
  g.fillStyle = '#2f5fb8';
  g.fill();
  g.strokeStyle = '#2b2218';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#f0c030';
  g.fillRect(bx + 3, by + 2.5, 5, 2.5);
}
