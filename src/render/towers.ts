// Code-drawn towers. Origin = tile centre at the tile's top face; y points down.
import { Tower } from '../sim/state';
import { circ, ell, frame, glow, poly, rect, seg, stick, TAU, C, fs, OUT } from './art';

const WOOD = '#8a5a2c';
const WOOD_L = '#a8743a';
const WOOD_D = '#6a4220';
const STONE = '#9a9ca2';
const STONE_L = '#b9bbc1';
const STONE_D = '#74767d';
const ROOF = '#a8412c';
const GOLD = '#e8b830';

const recoilOf = (t: Tower): number => (t.fired < 0.15 ? 1 - t.fired / 0.15 : 0);

/** Directions toward neighbouring wall tiles, as dx,dy pairs (n pairs). */
export interface WallLinks { n: number; d: Float32Array }
export const newLinks = (): WallLinks => ({ n: 0, d: new Float32Array(12) });

export function drawTower(g: CanvasRenderingContext2D, t: Tower, time: number, links: WallLinks): void {
  switch (t.type) {
    case 'palisade': palisade(g, t, time, links); break;
    case 'archer': archer(g, t, time); break;
    case 'catapult': catapult(g, t, time); break;
    case 'frost': frost(g, t, time); break;
    case 'mage': mage(g, t, time); break;
    case 'lightning': lightning(g, t, time); break;
    case 'aviary': aviary(g, t, time); break;
    case 'shrine': shrine(g, t, time); break;
    default: break;
  }
}

/** Approximate sprite height above the tile, for status icons and HP bars. */
export function towerHeight(t: Tower): number {
  switch (t.type) {
    case 'palisade': return t.tier >= 3 || t.fork ? 30 : t.tier === 2 ? 22 : 24;
    case 'archer': return t.fork === 'a' ? 50 : 34 + t.tier * 3;
    case 'catapult': return 28;
    case 'frost': return 24 + t.tier * 5;
    case 'mage': return 38 + t.tier * 6;
    case 'lightning': return (t.fork === 'b' ? 62 : t.fork === 'a' ? 56 : 40 + t.tier * 6) + 4;
    case 'aviary': return 32 + t.tier * 3;
    case 'shrine': return 30;
    default: return 34;
  }
}

function merlons(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, n: number, fill: string): void {
  const w = (x1 - x0) / (n * 2 - 1);
  for (let i = 0; i < n; i++) rect(g, x0 + i * 2 * w, y - 4, w, 4.5, fill, 0.9);
}

function blocks(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rowH: number): void {
  g.strokeStyle = 'rgba(40,40,50,0.35)';
  g.lineWidth = 0.7;
  g.beginPath();
  let r = 0;
  for (let yy = y + rowH; yy < y + h; yy += rowH, r++) {
    g.moveTo(x, yy);
    g.lineTo(x + w, yy);
    for (let xx = x + (r % 2 ? rowH * 0.7 : rowH * 1.4); xx < x + w; xx += rowH * 1.4) {
      g.moveTo(xx, yy);
      g.lineTo(xx, yy - rowH);
    }
  }
  g.stroke();
}

// ---------------------------------------------------------------------------------------------
// Palisade: wooden stakes, then a stone wall that joins its neighbours.
// ---------------------------------------------------------------------------------------------
function palisade(g: CanvasRenderingContext2D, t: Tower, time: number, links: WallLinks): void {
  const rc = recoilOf(t);
  if (t.tier === 1) {
    // Wooden stakes in a staggered row, lashed together.
    const hs = [19, 24, 28, 24, 19];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const x = -16 + i * 8 + (row ? 4 : 0);
        if (row && i === 4) continue;
        const y = row ? 0 : 5;
        const h = hs[i] - (row ? 3 : 0);
        poly(g, [x - 3.6, y, x - 3.6, y - h + 6, x, y - h, x + 3.6, y - h + 6, x + 3.6, y], row ? WOOD_D : (i % 2 ? WOOD_L : WOOD), 1);
      }
    }
    stick(g, -18, -5 - rc * 2, 18, -5 - rc * 2, '#d8c08a', 1.6);
    return;
  }
  const spiked = t.fork === 'a';
  const guard = t.fork === 'b';
  const fort = t.tier >= 3 || t.fork !== 0;
  const H = fort ? 20 : 14;
  const gy = 3;
  // Connectors toward neighbouring walls.
  for (let k = 0; k < links.n; k++) {
    const dx = links.d[k * 2] * 0.5;
    const dy = links.d[k * 2 + 1] * 0.5;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 4.5;
    const py = (dx / len) * 2.4;
    const h = H - 4;
    const ax = px, ay = gy + py, bx = dx + px, by = gy + dy + py, cx = dx - px, cy = gy + dy - py, ex = -px, ey = gy - py;
    // Side faces and top.
    poly(g, [ax, ay, bx, by, bx, by - h, ax, ay - h], STONE_D, 0.9);
    poly(g, [cx, cy, bx, by, bx, by - h, cx, cy - h], STONE_D, 0.9);
    poly(g, [ex, ey, cx, cy, cx, cy - h, ex, ey - h], STONE, 0.9);
    poly(g, [ax, ay, ex, ey, ex, ey - h, ax, ay - h], STONE, 0.9);
    poly(g, [ax, ay - h, bx, by - h, cx, cy - h, ex, ey - h], STONE_L, 1);
    if (fort) {
      g.strokeStyle = 'rgba(40,40,50,0.5)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo((ax + bx) / 2, (ay + by) / 2 - h);
      g.lineTo((ex + cx) / 2, (ey + cy) / 2 - h);
      g.stroke();
    }
  }
  // Central post: a squat stone block.
  const w = fort ? 12 : 11;
  rect(g, -w, gy - H, w * 2, H + 1, STONE, 1.2);
  rect(g, -w, gy - H, w * 0.9, H + 1, STONE_L, 0);
  g.strokeStyle = OUT;
  g.lineWidth = 1.2;
  g.strokeRect(-w, gy - H, w * 2, H + 1);
  blocks(g, -w, gy - H, w * 2, H + 1, 5);
  ell(g, 0, gy - H, w, 4.5, STONE_L, 1.1);
  if (t.tier >= 3 || fort) {
    // Crenellations around the top rim.
    for (const mx of [-w + 1.5, -w / 3, w / 3, w - 1.5]) rect(g, mx - 2, gy - H - 5, 4, 5, STONE_L, 0.9);
  }
  if (spiked) {
    const n = t.forkTier >= 2 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const x = -w + 2 + (i * (w * 2 - 4)) / (n - 1);
      poly(g, [x - 2, gy - H - 3, x, gy - H - 12 - (i % 2) * 3, x + 2, gy - H - 3], '#c8ccd4', 1);
    }
    // Side spikes pointing outward.
    for (const sx of [-1, 1]) for (let j = 0; j < 2; j++) {
      const y = gy - 4 - j * 8;
      poly(g, [sx * w, y - 2, sx * (w + 7), y, sx * w, y + 2], '#c8ccd4', 0.9);
    }
    for (let k = 0; k < links.n; k++) {
      const dx = links.d[k * 2] * 0.35;
      const dy = links.d[k * 2 + 1] * 0.35;
      poly(g, [dx - 1.8, gy + dy - H + 2, dx, gy + dy - H - 7, dx + 1.8, gy + dy - H + 2], '#c8ccd4', 0.9);
    }
  } else if (guard) {
    // Battlement with an archer behind it.
    const ay = gy - H - 4;
    archerFigure(g, -3.5, ay, (t.angle + frame.angle), 1, '#3f7a3a', rc, time);
    if (t.forkTier >= 2) archerFigure(g, 4, ay + 1, (t.angle + frame.angle), 1, '#8a2d2a', rc, time);
    merlons(g, -w - 1, w + 1, gy - H + 0.5, 4, STONE_L);
    rect(g, -1, gy - H - 16, 1.4, 12, '#4a3420', 0.5);
    poly(g, [0.4, gy - H - 16, 7, gy - H - 14, 0.4, gy - H - 11], '#2f5fb8', 0.8);
  }
  // Door slit.
  rect(g, -1.5, gy - 9, 3, 7, '#2a2630', 0.6);
}

function archerFigure(g: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number, hood: string, rc: number, time: number): void {
  // Body and head.
  poly(g, [x - 3 * s, y, x - 2.4 * s, y - 6 * s, x + 2.4 * s, y - 6 * s, x + 3 * s, y], '#6a4a2a', 0.9);
  circ(g, x, y - 8.2 * s, 2.6 * s, '#f0c8a0', 0.9);
  g.beginPath();
  g.arc(x, y - 8.6 * s, 2.9 * s, Math.PI, 0);
  g.closePath();
  fs(g, hood, 0.8);
  // Bow facing the target.
  const bx = x + Math.cos(ang) * 3.5 * s;
  const by = y - 5 * s + Math.sin(ang) * 3 * s;
  const bl = 6 * s;
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const draw = rc > 0 ? 0 : 1.5;
  g.strokeStyle = C('#6a4220');
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(bx + px * bl, by + py * bl);
  g.quadraticCurveTo(bx + Math.cos(ang) * 3.5 * s, by + Math.sin(ang) * 3.5 * s, bx - px * bl, by - py * bl);
  g.stroke();
  seg(g, bx + px * bl, by + py * bl, bx - Math.cos(ang) * draw, by - Math.sin(ang) * draw, '#e8e0c8', 0.6);
  seg(g, bx - Math.cos(ang) * draw, by - Math.sin(ang) * draw, bx - px * bl, by - py * bl, '#e8e0c8', 0.6);
  if (rc === 0) seg(g, bx - Math.cos(ang) * draw, by - Math.sin(ang) * draw, bx + Math.cos(ang) * 5 * s, by + Math.sin(ang) * 5 * s, '#d8c8a0', 0.9);
  void time;
}

// ---------------------------------------------------------------------------------------------
// Archer tower
// ---------------------------------------------------------------------------------------------
function archer(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const rc = recoilOf(t);
  const gy = 5;
  const fork = t.fork;
  if (fork === 'a') {
    // Longbow: tall, slim, pale stone.
    const top = -40;
    poly(g, [-7, gy, -5.5, top, 5.5, top, 7, gy], STONE, 1.2);
    poly(g, [-7, gy, -5.5, top, -1, top, -1, gy], STONE_L, 0);
    g.strokeStyle = OUT; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-7, gy); g.lineTo(-5.5, top); g.lineTo(5.5, top); g.lineTo(7, gy); g.closePath(); g.stroke();
    blocks(g, -6.5, top, 13, gy - top, 6);
    rect(g, -1, -12, 2, 8, '#2a2630', 0.6);
    rect(g, -1, -28, 2, 7, '#2a2630', 0.6);
    // Platform and roof.
    rect(g, -9, top - 2, 18, 4, STONE_D, 1);
    merlons(g, -9, 9, top - 2, 4, STONE_L);
    archerFigure(g, 0, top - 2, (t.angle + frame.angle), 1.15, '#2f6a45', rc, time);
    if (t.forkTier >= 2) {
      rect(g, -0.7, top - 22, 1.4, 12, '#4a3420', 0.5);
      poly(g, [0.7, top - 22, 9, top - 19, 0.7, top - 15], GOLD, 0.8);
    }
    return;
  }
  if (fork === 'b') {
    // Volley: wide stone keep with several archers.
    const top = -24;
    rect(g, -16, top, 32, gy - top, STONE, 1.2);
    rect(g, -16, top, 12, gy - top, STONE_L, 0);
    g.strokeStyle = OUT; g.lineWidth = 1.2; g.strokeRect(-16, top, 32, gy - top);
    blocks(g, -16, top, 32, gy - top, 6);
    rect(g, -3, -10, 6, 15, '#4a3420', 1);
    rect(g, -17, top - 3, 34, 4, STONE_D, 1);
    merlons(g, -17, 17, top - 3, 6, STONE_L);
    archerFigure(g, -10, top - 3, (t.angle + frame.angle), 1, '#3f7a3a', rc, time);
    archerFigure(g, 0, top - 3, (t.angle + frame.angle), 1, '#8a2d2a', rc, time);
    archerFigure(g, 10, top - 3, (t.angle + frame.angle), 1, '#2f5fb8', rc, time);
    if (t.forkTier >= 2) {
      for (const bx of [-14, 14]) {
        rect(g, bx - 0.7, top - 20, 1.4, 17, '#4a3420', 0.5);
        poly(g, [bx + 0.7, top - 20, bx + 8 * (bx < 0 ? -1 : 1), top - 17, bx + 0.7, top - 13], GOLD, 0.8);
      }
      rect(g, -16, top + 8, 32, 2.5, GOLD, 0.8);
    }
    return;
  }
  if (t.tier === 1) {
    // Small wooden platform on stilts.
    stick(g, -8, gy, -6, -12, WOOD_D, 2);
    stick(g, 8, gy, 6, -12, WOOD_D, 2);
    stick(g, -7, gy - 1, 6, -10, WOOD_D, 1.2);
    stick(g, 7, gy - 1, -6, -10, WOOD_D, 1.2);
    rect(g, -10, -15, 20, 4, WOOD_L, 1.1);
    rect(g, -9, -21, 18, 2, WOOD, 0.9);
    archerFigure(g, 0, -15, (t.angle + frame.angle), 1, '#3f7a3a', rc, time);
  } else if (t.tier === 2) {
    stick(g, -9, gy, -7, -20, WOOD_D, 2.4);
    stick(g, 9, gy, 7, -20, WOOD_D, 2.4);
    stick(g, -8, gy - 1, 7, -16, WOOD_D, 1.2);
    stick(g, 8, gy - 1, -7, -16, WOOD_D, 1.2);
    rect(g, -11, -23, 22, 4, WOOD_L, 1.1);
    stick(g, -9, -23, -9, -33, WOOD_D, 1.6);
    stick(g, 9, -23, 9, -33, WOOD_D, 1.6);
    poly(g, [-13, -32, 0, -42, 13, -32], ROOF, 1.2);
    archerFigure(g, 0, -23, (t.angle + frame.angle), 1, '#3f7a3a', rc, time);
  } else {
    // Stone tower.
    rect(g, -11, -26, 22, gy + 26, STONE, 1.2);
    rect(g, -11, -26, 8, gy + 26, STONE_L, 0);
    g.strokeStyle = OUT; g.lineWidth = 1.2; g.strokeRect(-11, -26, 22, gy + 26);
    blocks(g, -11, -26, 22, gy + 26, 6);
    rect(g, -2.5, -9, 5, 14, '#4a3420', 1);
    rect(g, -1, -20, 2, 6, '#2a2630', 0.6);
    rect(g, -13, -29, 26, 4, STONE_D, 1);
    merlons(g, -13, 13, -29, 5, STONE_L);
    archerFigure(g, -4, -29, (t.angle + frame.angle), 1, '#3f7a3a', rc, time);
    archerFigure(g, 5, -29, (t.angle + frame.angle), 1, '#8a2d2a', rc, time);
  }
}

// ---------------------------------------------------------------------------------------------
// Catapult
// ---------------------------------------------------------------------------------------------
function catapult(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const f = Math.cos((t.angle + frame.angle)) < -0.05 ? -1 : 1;
  g.save();
  g.scale(f, 1);
  const fire = t.fork === 'a';
  const scatter = t.fork === 'b';
  const wood = fire ? '#6a3a20' : WOOD;
  const woodL = fire ? '#8a4a28' : WOOD_L;
  const big = t.tier >= 2 || t.fork !== 0;
  const gy = 4;
  // Swing: s = 0 at rest, 1 at full throw.
  const fr = t.fired;
  const s = fr < 0.1 ? fr / 0.1 : Math.max(0, 1 - (fr - 0.1) / 0.6);
  const rest = Math.PI * 0.82;
  const thrown = -Math.PI * 0.28;
  const a = rest + (thrown - rest) * s;
  const len = big ? 22 : 18;
  const py = -12 - (big ? 2 : 0);
  // Frame and supports.
  rect(g, -15, -2, 30, 5, woodL, 1.1);
  poly(g, [-9, -2, -2, py, 2, py, 9, -2], wood, 1.1);
  if (big) {
    stick(g, -14, 0, 14, 0, '#555a62', 1.2);
    rect(g, -15, -5, 6, 3, '#555a62', 0.8);
  }
  // Wheels.
  for (const wx of [-11, 11]) {
    circ(g, wx, gy - 1, 5, WOOD_D, 1.2);
    circ(g, wx, gy - 1, 1.6, '#c8b080', 0.6);
    for (let k = 0; k < 4; k++) seg(g, wx, gy - 1, wx + Math.cos(k * 0.785) * 4.4, gy - 1 + Math.sin(k * 0.785) * 4.4, '#c8b080', 0.7);
    seg(g, wx, gy - 1, wx - Math.cos(0.785) * 4.4, gy - 1 + Math.sin(0.785) * 4.4, '#c8b080', 0.7);
  }
  // Counterweight on the short end.
  const ex = Math.cos(a) * len;
  const ey = py + Math.sin(a) * len;
  const cwx = -Math.cos(a) * 6;
  const cwy = py - Math.sin(a) * 6;
  stick(g, cwx, cwy, ex, ey, woodL, 2.8);
  rect(g, cwx - 3.5, cwy - 1, 7, 6, '#6d6a74', 1);
  circ(g, 0, py, 2.4, '#555a62', 1);
  // Bucket and ammo.
  if (fire) {
    // Iron pot with flames.
    g.beginPath();
    g.moveTo(ex - 5, ey - 3);
    g.lineTo(ex + 5, ey - 3);
    g.lineTo(ex + 3.5, ey + 4);
    g.lineTo(ex - 3.5, ey + 4);
    g.closePath();
    fs(g, '#32323a', 1.1);
    const fl = 4 + Math.sin(time * 18) * 1.2;
    poly(g, [ex - 4, ey - 3, ex - 2, ey - 3 - fl, ex, ey - 3 - fl * 1.5, ex + 2, ey - 3 - fl * 0.9, ex + 4, ey - 3], '#ff7a2f', 0.8);
    poly(g, [ex - 2, ey - 3, ex, ey - 3 - fl, ex + 2, ey - 3], '#ffd24a', 0);
  } else if (scatter) {
    g.beginPath();
    g.moveTo(ex - 6, ey - 2);
    g.lineTo(ex + 6, ey - 2);
    g.lineTo(ex + 4, ey + 3);
    g.lineTo(ex - 4, ey + 3);
    g.closePath();
    fs(g, WOOD_D, 1.1);
    if (s < 0.5) for (const [dx, dy] of [[-3.5, -3.5], [0, -4.6], [3.5, -3.5], [-1.5, -6.6], [2, -6.8]]) circ(g, ex + dx, ey + dy, 2.2, '#8d8f94', 0.8);
  } else {
    g.beginPath();
    g.arc(ex, ey, 4.5, 0, Math.PI);
    g.closePath();
    fs(g, WOOD_D, 1.1);
    if (s < 0.5) circ(g, ex, ey - 2.5, big ? 3.8 : 3.2, '#8d8f94', 1);
  }
  // Rock pile beside the machine for the scatter fork; flag for tier 3.
  if (scatter) for (const [dx, dy] of [[-17, 2], [-13, 1], [-15, -2]]) circ(g, dx - 2, dy + 1, 2.3, '#8d8f94', 0.8);
  if (t.tier >= 3 || t.forkTier >= 2) {
    rect(g, 11, py - 16, 1.2, 15, '#4a3420', 0.4);
    poly(g, [12, py - 16, 19, py - 13, 12, py - 10], fire ? '#c8452a' : '#2f5fb8', 0.7);
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Frost tower
// ---------------------------------------------------------------------------------------------
function crystal(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, body: string, facet: string, lean: number, jag: boolean): void {
  if (jag) {
    poly(g, [x - w, y, x - w * 0.9 + lean * 0.3, y - h * 0.45, x - w * 0.3 + lean * 0.6, y - h * 0.6, x + lean, y - h, x + w * 0.35 + lean * 0.7, y - h * 0.55, x + w * 0.95 + lean * 0.3, y - h * 0.4, x + w, y], body, 1.2);
    poly(g, [x, y, x - w * 0.3 + lean * 0.6, y - h * 0.6, x + lean, y - h, x + w * 0.35 + lean * 0.7, y - h * 0.55], facet, 0.8);
  } else {
    poly(g, [x - w, y, x - w * 0.7, y - h * 0.7, x + lean, y - h, x + w * 0.7, y - h * 0.7, x + w, y], body, 1.2);
    poly(g, [x, y, x - w * 0.5, y - h * 0.7, x + lean, y - h, x + w * 0.45, y - h * 0.72], facet, 0.7);
  }
}

function frost(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const a = t.fork === 'a';
  const b = t.fork === 'b';
  const body = a ? '#cfeeff' : b ? '#2f4f9e' : '#4fb2ee';
  const facet = a ? '#ffffff' : b ? '#5d86d8' : '#a8e2ff';
  const dark = a ? '#9ccbe6' : b ? '#22377a' : '#3a8ac4';
  // Rocky base.
  ell(g, 0, 3, 15, 6, '#7a7d86', 1.2);
  ell(g, 0, 1, 11, 4.5, '#9a9da6', 0.9);
  const rc = recoilOf(t);
  const pulse = 1 + Math.sin(time * 3 + t.uid) * 0.06 + rc * 0.12;
  const jag = b;
  const side = (n: number, hh: number, ww: number): void => {
    for (let i = 0; i < n; i++) {
      const sx = (i % 2 ? 1 : -1);
      const x = sx * (7 + Math.floor(i / 2) * 3.2);
      const h = hh * (1 - Math.floor(i / 2) * 0.2);
      crystal(g, x, 2, ww, h, dark, body, sx * 3, jag);
    }
  };
  const fk = t.forkTier;
  let main = 22;
  if (t.tier === 1) main = 24;
  else if (t.tier === 2) { side(2, 15, 3.6); main = 30; }
  else { side(4, 17, 3.6); main = 36; }
  if (t.fork) { side(2 + fk * 2, 14 + fk * 3, 3.4); main += 4 + fk * 3; }
  crystal(g, 0, 2, 6 + (t.tier >= 3 ? 1.5 : 0) + (jag ? 1 : 0), main * pulse, body, facet, jag ? 2 : 0, jag);
  // Glow and sparkles.
  glow(g, 0, -main * 0.6, 12 * pulse, a ? '#e8f8ff' : b ? '#5a86ff' : '#8ad8ff', 0.18 + rc * 0.25);
  if (a) {
    g.fillStyle = C('#ffffff');
    for (let i = 0; i < 3; i++) {
      const k = (time * 0.9 + i / 3) % 1;
      g.globalAlpha = 1 - k;
      g.fillRect(-10 + i * 9 + Math.sin(i) * 3, -main * 0.3 - k * 16, 1.8, 1.8);
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Mage tower
// ---------------------------------------------------------------------------------------------
function mage(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const rc = recoilOf(t);
  const gy = 5;
  const th = t.tier === 1 ? 20 : t.tier === 2 ? 28 : 36;
  const wBase = 11;
  const wTop = 9;
  // Round tower body.
  poly(g, [-wBase, gy, -wTop, -th, wTop, -th, wBase, gy], STONE, 1.2);
  poly(g, [-wBase, gy, -wTop, -th, -wTop + 6, -th, -wBase + 6, gy], STONE_L, 0);
  g.strokeStyle = OUT; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-wBase, gy); g.lineTo(-wTop, -th); g.lineTo(wTop, -th); g.lineTo(wBase, gy); g.closePath(); g.stroke();
  blocks(g, -wBase, -th, wBase * 2, gy + th, 6);
  rect(g, -2, gy - 9, 4, 9, '#3a2a4a', 0.8);
  // Runes on the wall.
  g.fillStyle = C('#c58bff');
  g.globalAlpha = 0.6 + Math.sin(time * 2 + t.uid) * 0.25;
  g.fillRect(-1, -th * 0.45, 2, 5);
  g.fillRect(-3, -th * 0.45 + 2, 6, 1.4);
  g.globalAlpha = 1;
  // Balcony ring and top.
  rect(g, -wTop - 3, -th - 3, (wTop + 3) * 2, 4, STONE_D, 1);
  if (t.tier >= 2) rect(g, -wBase - 1, -th * 0.55, wBase * 2 + 2, 2.4, STONE_D, 0.9);
  if (t.tier >= 3 && !t.fork) {
    poly(g, [-wTop - 1, -th - 3, 0, -th - 12, wTop + 1, -th - 3], '#4a2f78', 1);
  }
  const oy = -th - 11 - (t.fork === 'b' ? 5 : 0);
  const hot = rc * 0.5;
  if (t.fork === 'b') {
    // Floating lens: a rotating ring around a diamond of glass.
    const bob = Math.sin(time * 2 + t.uid) * 1.5;
    const ly = oy + bob;
    glow(g, 0, ly, 14, '#d8b0ff', 0.18 + hot);
    g.strokeStyle = C('#e8c040');
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, ly, 11, 4 + Math.sin(time * 1.3) * 1.5, 0.4 + time * 0.5, 0, TAU);
    g.stroke();
    poly(g, [0, ly - 9, 6.5, ly, 0, ly + 9, -6.5, ly], '#c8a0ff', 1.1);
    poly(g, [0, ly - 9, 6.5, ly, 0, ly], '#f0e0ff', 0.6);
    circ(g, 0, ly, 1.8, '#ffffff', 0);
    return;
  }
  const r = 5.5 + (t.fork === 'a' ? 1 : 0) + hot * 2;
  glow(g, 0, oy, r * 2.4, '#b070ff', 0.2 + hot);
  circ(g, 0, oy, r, '#9a55e8', 1.2);
  circ(g, -r * 0.3, oy - r * 0.3, r * 0.35, '#e8d0ff', 0);
  if (t.fork === 'a') {
    // Crackling arcs around the orb.
    g.strokeStyle = C('#e8f4ff');
    g.lineWidth = 1.1;
    const seed = Math.floor(time * 14);
    for (let i = 0; i < 3; i++) {
      const ang = ((seed * 1.7 + i * 2.1) % TAU);
      g.beginPath();
      let x = Math.cos(ang) * r;
      let y = oy + Math.sin(ang) * r;
      g.moveTo(x, y);
      for (let k = 1; k <= 3; k++) {
        x = Math.cos(ang + Math.sin(seed * 3 + i * k) * 0.4) * (r + k * 3.6) + Math.sin(seed * (k + i)) * 1.6;
        y = oy + Math.sin(ang + Math.sin(seed * 3 + i * k) * 0.4) * (r + k * 3.6) + Math.cos(seed * (k + i)) * 1.6;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Aviary
// ---------------------------------------------------------------------------------------------
function aviary(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const a = t.fork === 'a';
  const b = t.fork === 'b';
  const wall = a ? '#c85a30' : b ? '#d9a82b' : WOOD_L;
  const roof = a ? '#8a2418' : b ? '#a8741c' : ROOF;
  const gy = 5;
  const sc = b ? 1.25 : 1;
  const postH = 18 + t.tier * 4 + (t.fork ? 3 : 0);
  // Post and a hanging perch bar.
  rect(g, -2.4 * sc, -postH, 4.8 * sc, postH + gy, WOOD_D, 1.1);
  rect(g, -9, gy - 3, 18, 3, WOOD, 1);
  const house = (x: number, y: number, w: number, h: number): void => {
    rect(g, x - w / 2, y - h, w, h, wall, 1.2);
    poly(g, [x - w / 2 - 2, y - h, x, y - h - w * 0.55, x + w / 2 + 2, y - h], roof, 1.2);
    circ(g, x, y - h * 0.5, w * 0.17, '#2a1a10', 0.8);
    rect(g, x - 1, y - h * 0.2, 2, 1.6, '#c8a060', 0.4);
  };
  const w = 14 * sc;
  const y0 = -postH + 14 * sc;
  house(0, y0, w, 12 * sc);
  if (t.tier >= 2) {
    house(-12 * sc, y0 + 8, 9 * sc, 9 * sc);
    house(12 * sc, y0 + 8, 9 * sc, 9 * sc);
  }
  if (t.tier >= 3 || t.fork) {
    rect(g, -0.6, y0 - 12 * sc - w * 0.55 - 12, 1.2, 13, '#4a3420', 0.4);
    poly(g, [0.6, y0 - 12 * sc - w * 0.55 - 12, 8, y0 - 12 * sc - w * 0.55 - 9, 0.6, y0 - 12 * sc - w * 0.55 - 6], a ? '#e8452a' : GOLD, 0.7);
  }
  if (b) {
    // Eagle statue-crest on the roof.
    const cy = y0 - 12 * sc - w * 0.55;
    poly(g, [-5, cy - 1, -2, cy - 6, 0, cy - 4, 2, cy - 6, 5, cy - 1, 0, cy - 2.4], '#fff0b0', 0.8);
  }
  // Bobbing sitting bird on the roof ridge.
  const bob = Math.sin(time * 3 + t.uid) > 0.8 ? -1 : 0;
  if (!b) {
    circ(g, 7 * sc, gy - 5 + bob, 2.6, a ? '#e8602a' : '#b08050', 0.8);
    circ(g, 9 * sc, gy - 7 + bob, 1.5, a ? '#ff9a3a' : '#c09060', 0.7);
  }
  if (a) {
    // Little flame at the base.
    const fl = 3 + Math.sin(time * 12) * 1;
    poly(g, [-14, gy, -13, gy - fl * 1.6, -11.5, gy - fl, -10, gy], '#ff7a2f', 0.7);
  }
}

// ---------------------------------------------------------------------------------------------
// Shrine
// ---------------------------------------------------------------------------------------------
function shrine(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const gy = 5;
  const pulse = 0.65 + Math.sin(time * 2.4 + t.uid) * 0.25;
  // Steps.
  ell(g, 0, gy - 1, 15, 6, STONE_D, 1.2);
  ell(g, 0, gy - 3, 12, 4.8, STONE, 1);
  const top = t.tier >= 2 ? -22 : -16;
  if (t.tier >= 2) {
    // Two small pillars with a lintel.
    for (const sx of [-1, 1]) {
      rect(g, sx * 9 - 2.4, top + 3, 4.8, gy - 3 - top - 3, STONE_L, 1);
      rect(g, sx * 9 - 3.4, top + 1, 6.8, 3, STONE, 0.9);
    }
    rect(g, -13, top - 2, 26, 4, STONE, 1);
  }
  // Standing slab with a glowing rune.
  poly(g, [-6, gy - 3, -6, -10, 0, -16 - (t.tier >= 3 ? 4 : 0), 6, -10, 6, gy - 3], STONE_L, 1.2);
  glow(g, 0, -7, 9 + (t.tier >= 3 ? 3 : 0), '#ffd86b', 0.2 * pulse + 0.1);
  g.strokeStyle = C('#ffe08a');
  g.lineWidth = 1.5;
  g.globalAlpha = 0.5 + pulse * 0.5;
  g.beginPath();
  g.moveTo(0, -12); g.lineTo(0, -2); g.moveTo(-3.5, -9); g.lineTo(3.5, -9);
  g.moveTo(-3, -5); g.lineTo(0, -2); g.lineTo(3, -5);
  g.stroke();
  g.globalAlpha = 1;
  if (t.tier >= 3) {
    for (const sx of [-1, 1]) {
      rect(g, sx * 14 - 2, gy - 12, 4, 6, '#5a5a62', 0.9);
      const fl = 3 + Math.sin(time * 11 + sx) * 1;
      poly(g, [sx * 14 - 2, gy - 12, sx * 14, gy - 12 - fl * 1.5, sx * 14 + 2, gy - 12], '#ffb830', 0.6);
    }
  }
  if (t.fork === 'a') {
    // War banner.
    const px = 15;
    rect(g, px - 0.8, -34, 1.6, 38, '#4a3420', 0.6);
    g.beginPath();
    g.moveTo(px, -34);
    for (let k = 0; k <= 5; k++) g.lineTo(px + 2 + k * 3, -34 + Math.sin(time * 4 - k) * 1.3);
    g.lineTo(px + 17, -20 + Math.sin(time * 4 - 5) * 1.3);
    g.lineTo(px + 11, -23);
    g.lineTo(px, -20);
    g.closePath();
    fs(g, '#b8322f', 1.1);
    circ(g, px + 6, -29, 2.2, GOLD, 0.6);
  } else if (t.fork === 'b') {
    // Treasure chest and coins.
    const cx = 13;
    rect(g, cx - 7, gy - 11, 14, 8, WOOD, 1.1);
    g.beginPath();
    g.ellipse(cx, gy - 11, 7, 4, 0, Math.PI, 0);
    g.closePath();
    fs(g, WOOD_L, 1.1);
    rect(g, cx - 7, gy - 8, 14, 1.8, GOLD, 0.6);
    rect(g, cx - 1.4, gy - 9, 2.8, 3.2, GOLD, 0.6);
    for (const [dx, dy] of [[-4, 0], [-1, 1], [3, 0], [5, 1]]) circ(g, cx + dx + 1, gy - 2 + dy, 1.8, GOLD, 0.6);
    const k = (time * 0.7 + t.uid * 0.37) % 1;
    g.globalAlpha = 1 - k;
    g.fillStyle = C('#fff4b0');
    g.fillRect(cx - 4 + k * 4, gy - 13 - k * 8, 2, 2);
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Lightning tower: slim dark spire with a rod; Thunderhead adds a storm cloud, Thunder Lance a golden rod.
// ---------------------------------------------------------------------------------------------
function lightning(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const rc = recoilOf(t);
  const gy = 5;
  const a = t.fork === 'a';
  const b = t.fork === 'b';
  const th = 24 + t.tier * 6 + (t.fork ? 4 : 0);
  const dark = '#4a4c58';
  const darkL = '#6a6c7a';
  // Tapering spire.
  poly(g, [-9, gy, -4.5, -th, 4.5, -th, 9, gy], dark, 1.2);
  poly(g, [-9, gy, -4.5, -th, -1, -th, -1, gy], darkL, 0);
  g.strokeStyle = OUT; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-9, gy); g.lineTo(-4.5, -th); g.lineTo(4.5, -th); g.lineTo(9, gy); g.closePath(); g.stroke();
  blocks(g, -8, -th, 16, gy + th, 6);
  rect(g, -2, gy - 8, 4, 8, '#1e1c26', 0.8);
  // Copper coils.
  const coils = t.tier + (t.fork ? 1 : 0);
  for (let i = 0; i < coils; i++) {
    const y = -th * 0.25 - i * (th * 0.55 / Math.max(1, coils));
    const w = 6.5 - (i / Math.max(1, coils)) * 2.2;
    ell(g, 0, y, w, 2.2, b ? GOLD : '#c8783a', 1);
  }
  // Cap and rod.
  rect(g, -5.5, -th - 2, 11, 3, STONE_D, 1);
  const rodH = b ? 24 + t.forkTier * 3 : 12;
  const rodC = b ? '#f0c030' : '#c8783a';
  stick(g, 0, -th - 1, 0, -th - rodH, rodC, b ? 2.8 : 1.8);
  if (b) {
    poly(g, [-2.4, -th - rodH + 1, 0, -th - rodH - 7, 2.4, -th - rodH + 1], '#fff0a0', 1);
  }
  const ty = -th - rodH - (b ? 7 : 0);
  const flick = 0.5 + 0.5 * Math.sin(time * 17 + t.uid);
  glow(g, 0, ty, (b ? 10 : 6) + rc * 8 + flick * 2, b ? '#fff0a0' : '#e8f0ff', 0.25 + rc * 0.4 + (b ? 0.12 : 0));
  g.strokeStyle = C(b ? '#fff6c0' : '#f0f6ff');
  g.lineWidth = 1.1;
  const seed = Math.floor(time * 12 + t.uid);
  for (let i = 0; i < 3; i++) {
    const ang = ((seed * 2.3 + i * 2.1) % TAU);
    g.beginPath();
    g.moveTo(0, ty);
    g.lineTo(Math.cos(ang) * 4 + Math.sin(seed + i) * 1.4, ty + Math.sin(ang) * 4);
    g.lineTo(Math.cos(ang + 0.4) * 8, ty + Math.sin(ang + 0.4) * 8);
    g.stroke();
  }
  if (a) {
    // Small storm cloud hovering above, flickering from within.
    const cy = ty - 12 + Math.sin(time * 2 + t.uid) * 1.5;
    const sc = 1 + t.forkTier * 0.18;
    for (const [dx, dy, r, c] of [[-8, 1, 6, '#4a5068'], [8, 1, 6, '#4a5068'], [0, -2, 8, '#5a6280'], [-3.5, 3, 6, '#3a4058'], [4, 3, 6, '#3a4058']] as [number, number, number, string][]) {
      circ(g, dx * sc, cy + dy * sc, r * sc, c, 1.1);
    }
    if (Math.sin(time * 9 + t.uid) > 0.6 || rc > 0) glow(g, 0, cy, 12 * sc, '#fff0a0', 0.5);
    poly(g, [-2, cy + 4 * sc, 1, cy + 8 * sc, -1, cy + 9 * sc, 2, cy + 14 * sc, -2.4, cy + 10 * sc, 0, cy + 9 * sc], '#ffe890', 0.6);
  }
}
