// The keep at the goal tile, drawn live (level 1..3). Origin = tile centre, y points down.
import { circ, ell, poly, rect } from './art';

const WALL = '#b9b3a4';
const WALL_D = '#a39d8e';
const STONE = '#c8c2b2';
const BLUE = '#2f5fb8';
const GOLD = '#f0c030';
const OUTL = '#2b2218';

function banner(g: CanvasRenderingContext2D, x: number, y: number, len: number, time: number, colour: string, trim: boolean): void {
  // Pole above (x, y), flag waving to the right.
  g.fillStyle = '#4a3420';
  g.fillRect(x - 0.7, y - len, 1.4, len);
  const by = y - len;
  g.beginPath();
  g.moveTo(x + 0.7, by);
  for (let k = 0; k <= 6; k++) g.lineTo(x + 0.7 + k * 2.4, by + Math.sin(time * 5 - k * 0.8 + x) * 1.4 * (k / 6));
  for (let k = 6; k >= 0; k--) g.lineTo(x + 0.7 + k * 2.4, by + 8 + Math.sin(time * 5 - k * 0.8 + x) * 1.4 * (k / 6) - (k === 6 ? 2 : 0));
  g.closePath();
  g.fillStyle = colour;
  g.fill();
  g.strokeStyle = OUTL;
  g.lineWidth = 1;
  g.stroke();
  if (trim) { g.fillStyle = GOLD; g.fillRect(x + 3.5, by + 2.5, 5, 2.5); }
}

function tower(g: CanvasRenderingContext2D, x: number, top: number, w: number, roof: string, gold: boolean): void {
  rect(g, x - w / 2, top, w, 8 - top, '#a9a393', 1.2);
  rect(g, x - w / 2, top, w * 0.35, 8 - top, '#bdb7a8', 0);
  g.strokeStyle = OUTL;
  g.lineWidth = 1.2;
  g.strokeRect(x - w / 2, top, w, 8 - top);
  poly(g, [x - w / 2 - 2, top, x, top - w * 0.95, x + w / 2 + 2, top], roof, 1.2);
  rect(g, x - 1.5, top + 8, 3, 6, '#2a2630', 0.8);
  if (gold) {
    rect(g, x - w / 2 - 0.5, top + 3, w + 1, 2, GOLD, 0.7);
    circ(g, x, top - w * 0.95 - 1, 1.5, GOLD, 0.6);
  }
}

function crenel(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, n: number, fill: string): void {
  const w = (x1 - x0) / (n * 2 - 1);
  for (let i = 0; i < n; i++) rect(g, x0 + i * 2 * w, y - 4, w, 4.5, fill, 0.9);
}

function wall(g: CanvasRenderingContext2D, x0: number, x1: number, top: number, gold: boolean): void {
  rect(g, x0, top, x1 - x0, 8 - top, WALL, 1.2);
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = 0.7;
  for (let y = top + 6; y < 8; y += 6) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  crenel(g, x0 + 1, x1 - 1, top, Math.max(2, Math.round((x1 - x0) / 9)), WALL);
  if (gold) rect(g, x0, top + 2, x1 - x0, 1.6, GOLD, 0.6);
}

function gatehouse(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.beginPath();
  g.moveTo(x - 6, 8);
  g.lineTo(x - 6, y);
  g.arc(x, y, 6, Math.PI, 0);
  g.lineTo(x + 6, 8);
  g.closePath();
  g.fillStyle = '#5a3a1e';
  g.fill();
  g.strokeStyle = OUTL;
  g.lineWidth = 1.2;
  g.stroke();
  circ(g, x + 3, y + 5, 0.9, GOLD, 0);
}

export function drawKeepSprite(g: CanvasRenderingContext2D, level: number, time: number): void {
  const lv = Math.max(1, Math.min(3, Math.round(level)));
  ell(g, 0, 8, 22 + lv * 7, 9, '#2a2418', 0);
  g.globalAlpha = 1;
  if (lv === 1) {
    wall(g, -20, 20, -14, false);
    tower(g, -19, -26, 12, BLUE, false);
    tower(g, 19, -26, 12, BLUE, false);
    rect(g, -10, -32, 20, 40, STONE, 1.2);
    crenel(g, -9, 9, -32, 3, STONE);
    rect(g, -1.5, -22, 3, 8, '#2a2630', 0.8);
    gatehouse(g, 0, -2);
    banner(g, 0, -34, 17, time, BLUE, true);
    return;
  }
  if (lv === 2) {
    // Outer curtain wall with two extra small towers, then the inner keep with its two towers.
    wall(g, -34, 34, -12, false);
    tower(g, -33, -20, 9, BLUE, false);
    tower(g, 33, -20, 9, BLUE, false);
    tower(g, -19, -28, 12, BLUE, false);
    tower(g, 19, -28, 12, BLUE, false);
    rect(g, -11, -36, 22, 44, STONE, 1.2);
    rect(g, -11, -36, 8, 44, '#d6d0c0', 0);
    crenel(g, -10, 10, -36, 3, STONE);
    rect(g, -1.5, -26, 3, 8, '#2a2630', 0.8);
    gatehouse(g, 0, -2);
    banner(g, 0, -38, 19, time, BLUE, true);
    banner(g, -19, -38, 11, time, '#c8302a', false);
    banner(g, 19, -38, 11, time, '#c8302a', false);
    return;
  }
  // Level 3: a proper castle with a double-tiered donjon, four banner towers and gold trim.
  wall(g, -42, 42, -14, true);
  tower(g, -41, -24, 11, BLUE, true);
  tower(g, 41, -24, 11, BLUE, true);
  tower(g, -26, -32, 13, BLUE, true);
  tower(g, 26, -32, 13, BLUE, true);
  rect(g, -14, -34, 28, 42, STONE, 1.2);
  rect(g, -14, -34, 9, 42, '#d6d0c0', 0);
  rect(g, -14, -24, 28, 2.2, GOLD, 0.7);
  crenel(g, -13, 13, -34, 4, STONE);
  // Second tier.
  rect(g, -9, -52, 18, 19, STONE, 1.2);
  rect(g, -9, -52, 6, 19, '#d6d0c0', 0);
  rect(g, -9, -45, 18, 2, GOLD, 0.7);
  crenel(g, -8, 8, -52, 3, STONE);
  poly(g, [-6, -52, 0, -66, 6, -52], BLUE, 1.2);
  circ(g, 0, -67, 1.8, GOLD, 0.7);
  rect(g, -1.5, -46, 3, 8, '#2a2630', 0.8);
  rect(g, -1.5, -30, 3, 6, '#2a2630', 0.8);
  gatehouse(g, 0, -3);
  rect(g, -7, -6, 14, 1.6, GOLD, 0.6);
  banner(g, 0, -67, 18, time, BLUE, true);
  for (const x of [-41, -26, 26, 41]) banner(g, x, x === 41 || x === -41 ? -24 - 11 * 0.95 : -32 - 13 * 0.95, 11, time, x < 0 ? '#c8302a' : BLUE, true);
  void WALL_D;
}
