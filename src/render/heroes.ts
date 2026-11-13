// Code-drawn heroes: small figures on a round plinth with a gold ring.
import { HeroId } from '../data/balance';
import { Tower } from '../sim/state';
import { circ, ell, glow, poly, rect, stick, TAU, C, fs, OUT } from './art';

const GOLD = '#e8b830';
const SKIN = '#f0c8a0';

export function drawHero(g: CanvasRenderingContext2D, t: Tower, time: number): void {
  const rc = t.fired < 0.18 ? 1 - t.fired / 0.18 : 0;
  // Plinth.
  ell(g, 0, 6, 19, 8, '#6d6f78', 1.2);
  ell(g, 0, 3, 18, 7.5, '#a5a7b0', 1.2);
  g.beginPath();
  g.ellipse(0, 3, 15.5, 6, 0, 0, TAU);
  g.strokeStyle = C(GOLD);
  g.lineWidth = 1.8;
  g.stroke();
  const bob = Math.sin(time * 2 + t.uid) * 0.5;
  g.save();
  g.translate(0, bob);
  const face = Math.cos(t.angle) < -0.1 ? -1 : 1;
  g.scale(face, 1);
  switch (t.type as HeroId) {
    case 'knight': knight(g, rc); break;
    case 'cleric': cleric(g, time, rc); break;
    case 'sorcerer': sorcerer(g, time, rc); break;
    case 'ranger': ranger(g, t, face, rc); break;
    case 'druid': druid(g, time, rc); break;
    default: break;
  }
  g.restore();
}

function legs(g: CanvasRenderingContext2D, c: string): void {
  rect(g, -4, -6, 3.2, 8, c, 1);
  rect(g, 0.8, -6, 3.2, 8, c, 1);
  ell(g, -2.4, 2, 2.6, 1.4, '#3a2a1a', 0.8);
  ell(g, 2.4, 2, 2.6, 1.4, '#3a2a1a', 0.8);
}

function knight(g: CanvasRenderingContext2D, rc: number): void {
  legs(g, '#7a7f8c');
  // Greatsword behind, swung on attack.
  g.save();
  g.translate(7, -11);
  g.rotate(0.55 + rc * 1.5);
  rect(g, -1.4, -26, 2.8, 24, '#d8dce4', 1);
  rect(g, -0.4, -25, 0.8, 21, '#ffffff', 0);
  rect(g, -4.5, -3, 9, 2.4, '#b8892a', 0.9);
  rect(g, -1.1, -1, 2.2, 6, '#5a3a1e', 0.8);
  g.restore();
  // Body: steel with a blue tabard.
  poly(g, [-6, -6, -7, -18, 7, -18, 6, -6], '#9ca3b0', 1.2);
  poly(g, [-3.6, -6, -4, -18, 4, -18, 3.6, -6], '#2f5fb8', 0.9);
  rect(g, -0.8, -16, 1.6, 8, GOLD, 0);
  rect(g, -3, -13, 6, 1.6, GOLD, 0);
  circ(g, -7, -17, 3.2, '#b8bfcc', 1);
  circ(g, 7, -17, 3.2, '#b8bfcc', 1);
  // Helmet with plume.
  circ(g, 0, -22, 4.4, '#b8bfcc', 1.2);
  rect(g, -3, -22.6, 6, 1.6, '#1c1c24', 0.5);
  poly(g, [0, -26, -3, -31, 2, -29, 5, -32, 3, -26], '#c8302a', 0.9);
}

function cleric(g: CanvasRenderingContext2D, time: number, rc: number): void {
  // White robe with gold trim.
  poly(g, [-4, -19, -9, 2, 9, 2, 4, -19], '#f2f0ea', 1.2);
  poly(g, [-1.2, -19, -1.8, 2, 1.8, 2, 1.2, -19], GOLD, 0);
  rect(g, -9, 0, 18, 1.6, GOLD, 0.6);
  circ(g, 0, -22, 4, SKIN, 1.1);
  g.beginPath();
  g.arc(0, -23, 5, Math.PI, 0);
  g.lineTo(4.4, -19);
  g.lineTo(-4.4, -19);
  g.closePath();
  fs(g, '#f2f0ea', 1.1);
  circ(g, 0, -21.6, 3, SKIN, 0.8);
  // Staff with holy glow.
  stick(g, 8, 2, 8, -26, '#8a5a2c', 1.6);
  const pulse = 0.7 + Math.sin(time * 3) * 0.2 + rc * 0.6;
  glow(g, 8, -29, 8 * pulse, '#fff2a0', 0.35);
  circ(g, 8, -29, 2.8, '#fff8d0', 1);
  stick(g, 5.4, -29, 10.6, -29, GOLD, 1);
  stick(g, 8, -31.6, 8, -26.4, GOLD, 1);
}

function sorcerer(g: CanvasRenderingContext2D, time: number, rc: number): void {
  poly(g, [-4, -18, -9, 2, 9, 2, 4, -18], '#6a3fb0', 1.2);
  poly(g, [-4, -18, -2, 2, 2, 2, 4, -18], '#8a5fd0', 0);
  rect(g, -4.2, -12, 8.4, 1.8, GOLD, 0.6);
  circ(g, 0, -21, 3.8, SKIN, 1.1);
  // Beard.
  poly(g, [-3, -20, 0, -14, 3, -20], '#e8e4dc', 0.9);
  // Pointed hat with a star.
  ell(g, 0, -24, 8, 2.4, '#4a2a88', 1.1);
  poly(g, [-5, -24, 1, -38, 5, -24], '#5a35a0', 1.2);
  circ(g, 0, -27, 1.4, '#ffe070', 0);
  // Casting hand with spark.
  stick(g, 4, -14, 9, -17 - rc * 2, '#6a3fb0', 2.4);
  glow(g, 10, -19 - rc * 2, 6 + rc * 5, '#c88aff', 0.35);
  circ(g, 10, -19 - rc * 2, 2.4, '#e8d0ff', 0.8);
  g.fillStyle = C('#ffffff');
  g.globalAlpha = 0.5 + Math.sin(time * 9) * 0.4;
  g.fillRect(12, -24, 1.4, 1.4);
  g.fillRect(7, -23, 1.2, 1.2);
  g.globalAlpha = 1;
}

function ranger(g: CanvasRenderingContext2D, t: Tower, face: number, rc: number): void {
  legs(g, '#5a4a30');
  // Quiver.
  rect(g, -8, -18, 3, 10, '#6a4220', 0.9);
  for (let i = 0; i < 3; i++) stick(g, -7.5 + i * 0.8, -18, -7.5 + i * 0.8, -21, '#d8c8a0', 0.7);
  // Green cloak and hood.
  poly(g, [-6, -6, -6.5, -18, 6.5, -18, 6, -6], '#3f7a3a', 1.2);
  poly(g, [-6, -6, -6.5, -18, -2, -18, -2.5, -6], '#4a8a44', 0);
  rect(g, -6, -10, 12, 1.5, '#5a4a30', 0.6);
  circ(g, 0, -22, 4, SKIN, 1.1);
  g.beginPath();
  g.arc(0, -22.4, 5, Math.PI * 1.05, Math.PI * 1.95 + 0.0);
  g.lineTo(2.6, -18);
  g.lineTo(-2.6, -18);
  g.closePath();
  fs(g, '#2f6a32', 1.1);
  circ(g, 1, -21.2, 2.4, SKIN, 0.6);
  // Bow aimed at the target (angle taken in the flipped frame).
  const ang = Math.atan2(Math.sin(t.angle), Math.cos(t.angle) * face);
  const bx = 5 + Math.cos(ang) * 2;
  const by = -15 + Math.sin(ang) * 2;
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  g.strokeStyle = C('#6a4220');
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(bx + px * 9, by + py * 9);
  g.quadraticCurveTo(bx + Math.cos(ang) * 6, by + Math.sin(ang) * 6, bx - px * 9, by - py * 9);
  g.stroke();
  const d = rc > 0 ? 0 : 2.5;
  g.strokeStyle = C('#e8e0c8');
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(bx + px * 9, by + py * 9);
  g.lineTo(bx - Math.cos(ang) * d, by - Math.sin(ang) * d);
  g.lineTo(bx - px * 9, by - py * 9);
  g.stroke();
  if (!rc) stick(g, bx - Math.cos(ang) * d, by - Math.sin(ang) * d, bx + Math.cos(ang) * 8, by + Math.sin(ang) * 8, '#d8c8a0', 0.9);
}

function druid(g: CanvasRenderingContext2D, time: number, rc: number): void {
  // Brown robe with a leafy mantle.
  poly(g, [-4, -18, -9, 2, 9, 2, 4, -18], '#7a5230', 1.2);
  poly(g, [-7, -16, 0, -11, 7, -16, 4, -19, -4, -19], '#4a8a3a', 1.1);
  for (const lx of [-5, -1.5, 2, 5]) poly(g, [lx, -15, lx + 1.4, -11, lx - 0.4, -10.5], '#5aa04a', 0.6);
  circ(g, 0, -22, 4, SKIN, 1.1);
  g.beginPath();
  g.arc(0, -23, 4.6, Math.PI, 0);
  g.closePath();
  fs(g, '#6a4220', 1);
  // Antler headdress.
  for (const sx of [-1, 1]) {
    stick(g, sx * 3, -26, sx * 5.5, -31, '#d8c8a0', 1.2);
    stick(g, sx * 5.5, -31, sx * 4, -35, '#d8c8a0', 1);
    stick(g, sx * 4.6, -29, sx * 8.4, -31.4, '#d8c8a0', 1);
    stick(g, sx * 5.5, -31, sx * 8.6, -35, '#d8c8a0', 0.9);
  }
  // Staff with a living tip.
  stick(g, 8, 2, 8, -26, '#6a4220', 1.6);
  glow(g, 8, -28, 7 + rc * 4, '#8aff7a', 0.25 + rc * 0.2);
  poly(g, [8, -26, 4.6, -29, 8, -35, 11.4, -29], '#5ac04a', 0.9);
  g.fillStyle = C('#d8ffc0');
  g.globalAlpha = 0.6 + Math.sin(time * 4) * 0.3;
  g.fillRect(13, -22, 1.4, 1.4);
  g.globalAlpha = 1;
  void OUT;
}

/** Level badge, drawn without the facing flip. */
export function drawHeroBadge(g: CanvasRenderingContext2D, level: number): void {
  circ(g, 16, 8, 6.2, GOLD, 1.2);
  g.fillStyle = '#3a2a10';
  g.font = 'bold 8px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(level), 16, 8.5);
}
