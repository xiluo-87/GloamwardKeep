// Code-drawn enemies. Sprites face right with the origin at the feet; the caller flips and positions them.
import { Enemy } from '../sim/state';
import { circ, ell, glow, poly, rect, seg, stick, TAU, C, fs } from './art';

function legPair(g: CanvasRenderingContext2D, ph: number, x: number, len: number, w: number, colour: string, amp = 2.5): void {
  const s = Math.sin(ph);
  rect(g, x - w - 0.5 + s * amp, -len, w, len, colour, 1);
  rect(g, x + 0.5 - s * amp, -len, w, len, colour, 1);
}

export function drawEnemySprite(g: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const id = e.def.id;
  const ph = time * (4 + e.def.speed * 0.08) + e.uid * 1.7;
  const bob = Math.abs(Math.sin(ph)) * 1.2;
  switch (id) {
    case 'goblin': goblin(g, ph, bob, false); break;
    case 'hexer': goblin(g, ph, bob, true); break;
    case 'orc': orc(g, ph, bob); break;
    case 'stalker': stalker(g, e, ph); break;
    case 'bat': bat(g, time, e.uid); break;
    case 'troll': troll(g, ph, bob, e.smashing > 0, time); break;
    case 'wagon': wagon(g, time * (e.def.speed * 0.2) + e.uid, time); break;
    case 'shaman': shaman(g, ph, bob, time); break;
    case 'ogreking': ogreking(g, ph, time, e.smashing > 0); break;
    case 'lich': lich(g, time); break;
    default: break;
  }
}

function goblin(g: CanvasRenderingContext2D, ph: number, bob: number, hexer: boolean): void {
  const skin = hexer ? '#7aa84a' : '#6aae4a';
  legPair(g, ph, 0, 4, 2.6, '#4a6e30', 2);
  g.translate(0, -bob);
  // Ear, body, head.
  poly(g, [-2, -13, -9, -16, -3, -10], skin, 1);
  poly(g, [-4.5, -4, -5, -11, 4.5, -11, 5, -4], hexer ? '#6a3fa0' : '#8a5a2c', 1.1);
  ell(g, 0, -13.5, 4.8, 4.2, skin, 1.1);
  if (hexer) {
    poly(g, [-5.5, -12, -4, -19, 2, -23, 6, -17, 5.5, -12, 0, -10], '#5a2f90', 1.1);
    circ(g, 2.6, -13.4, 1.2, '#ff6ad8', 0);
    circ(g, 5.2, -12.4, 0.9, '#ff6ad8', 0);
    glow(g, 8, -8, 4, '#d070ff', 0.4);
    circ(g, 8, -8, 1.8, '#f0c0ff', 0.7);
  } else {
    poly(g, [4, -12, 8, -11, 4, -9.4], '#8cc864', 0.8);
    circ(g, 2.8, -14.4, 1.2, '#f8e04a', 0.5);
    circ(g, 3.2, -14.4, 0.5, '#202010', 0);
    stick(g, 4, -6, 9, -10, '#b8bcc4', 1.2);
  }
}

function orc(g: CanvasRenderingContext2D, ph: number, bob: number): void {
  legPair(g, ph, 0, 6, 4, '#4a5a30', 2);
  g.translate(0, -bob);
  // Axe behind.
  stick(g, 7, -4, 12, -22, '#6a4220', 1.8);
  poly(g, [9, -20, 16, -24, 15, -14, 11.5, -16], '#aab0b8', 1.1);
  // Torso with iron plates.
  poly(g, [-9, -6, -10, -20, 10, -20, 9, -6], '#5e8a38', 1.3);
  poly(g, [-8, -8, -8.5, -18, 8.5, -18, 8, -8], '#6d7078', 1.1);
  rect(g, -9, -12, 18, 1.8, '#4a4d54', 0.6);
  circ(g, -9, -19, 4, '#7d8088', 1.1);
  circ(g, 9, -19, 4, '#7d8088', 1.1);
  // Head with helm and horns.
  circ(g, 1.5, -25, 5, '#6a9a40', 1.2);
  poly(g, [-3.5, -26, -3.5, -31, 6, -31, 6.4, -26], '#7d8088', 1.1);
  poly(g, [-3, -30, -6, -37, -1.4, -31], '#e8e0c0', 0.9);
  poly(g, [5, -30, 8.6, -37, 6.2, -31], '#e8e0c0', 0.9);
  circ(g, 4.2, -24, 1, '#f8d030', 0);
  poly(g, [3, -22, 5, -19.4, 6, -22], '#f0ead8', 0.7);
}

function stalker(g: CanvasRenderingContext2D, e: Enemy, ph: number): void {
  const hidden = e.def.stealth && !e.revealed;
  const sh = Math.sin(ph * 0.7);
  const dark = '#2a2b3a';
  if (hidden) {
    // Faint shimmer: only a wavering outline.
    g.globalAlpha *= 0.25 + 0.1 * sh;
  } else {
    g.globalAlpha *= 0.88;
  }
  const s = Math.sin(ph * 1.6);
  const leg = (x: number, p: number): void => {
    const lx = x + Math.sin(ph * 1.6 + p) * 3.5;
    stick(g, x, -8, lx, 0 - Math.max(0, Math.cos(ph * 1.6 + p)) * 2, '#1e1f2c', 2.4);
  };
  leg(-8, 0);
  leg(-4, 2);
  // Body, tail, head.
  poly(g, [-12, -9 + s, -17, -12, -10, -13, -3, -14.5, 5, -13, 8, -9, 0, -6, -8, -6.4], dark, 1.2);
  poly(g, [6, -14, 12, -15 + s * 0.6, 16.5, -11, 11, -8.5, 6, -9], dark, 1.2);
  poly(g, [8, -14, 8.6, -19, 11, -15], dark, 0.9);
  poly(g, [11.4, -14.6, 12.4, -19, 14, -14], dark, 0.9);
  leg(2, 3.4);
  leg(6, 5.4);
  // Glowing eyes and fangs.
  glow(g, 12.6, -12.6, 3.4, '#ffe040', 0.5);
  circ(g, 12.6, -12.6, 1, '#fff070', 0);
  poly(g, [13, -9, 14, -6.5, 15, -9.2], '#f0f0f0', 0.5);
  // Misty wisps.
  g.fillStyle = C('#8a8cc0');
  g.globalAlpha *= 0.4;
  for (let i = 0; i < 3; i++) g.fillRect(-14 - i * 3 - (ph * 3 % 4), -10 + i * 2, 2.6, 1.2);
}

function bat(g: CanvasRenderingContext2D, time: number, uid: number): void {
  const flap = Math.sin(time * 16 + uid);
  // Wings (drawn from the body outward), flapping up and down.
  const wy = -flap * 8;
  for (const sy of [-1, 1]) {
    poly(g, [0, -1, sy * 7, -3 + wy * 0.5, sy * 15, 1 + wy, sy * 12, 4 + wy * 0.6, sy * 8, 2 + wy * 0.3, sy * 5, 4, 0, 3], '#4a3560', 1.1);
  }
  ell(g, 0, 0, 4.4, 5.4, '#5a4070', 1.2);
  circ(g, 0, -6, 3.4, '#5a4070', 1.1);
  poly(g, [-3, -8, -3.4, -12.4, -0.6, -8.6], '#5a4070', 0.9);
  poly(g, [3, -8, 3.4, -12.4, 0.6, -8.6], '#5a4070', 0.9);
  circ(g, -1.4, -6.4, 0.9, '#ff4a4a', 0);
  circ(g, 1.4, -6.4, 0.9, '#ff4a4a', 0);
  poly(g, [-1, -4, -0.5, -2.4, 0, -4], '#ffffff', 0.4);
}

function troll(g: CanvasRenderingContext2D, ph: number, bob: number, smash: boolean, time: number): void {
  legPair(g, ph, 0, 8, 6, '#58705a', 1.6);
  g.translate(0, -bob * 0.7);
  // Club.
  g.save();
  g.translate(11, -14);
  g.rotate(smash ? -1.2 + Math.abs(Math.sin(time * 8)) * 2 : -0.5 + Math.sin(ph) * 0.1);
  stick(g, 0, 4, 0, -16, '#6a4220', 3.2);
  ell(g, 0, -19, 5, 7, '#7a5230', 1.3);
  for (const [dx, dy] of [[-3, -22], [3, -18], [-2, -15]]) poly(g, [dx, dy, dx + 2.6, dy + 1.2, dx, dy + 2.6], '#c8c0a8', 0.6);
  g.restore();
  // Hunched hulking body.
  poly(g, [-13, -6, -16, -22, -9, -33, 6, -33, 14, -22, 12, -6], '#6a8a68', 1.4);
  poly(g, [-9, -7, -11, -20, -5, -28, 0, -26, -2, -8], '#7ea07a', 0);
  // Belly patch and loincloth.
  ell(g, 1, -15, 7, 8, '#8ab088', 0.8);
  rect(g, -10, -9, 20, 4, '#6a4a2a', 1);
  // Arm (near) and fist.
  poly(g, [-14, -28, -19, -14, -14, -9, -10, -13, -11, -24], '#6a8a68', 1.2);
  circ(g, -15, -8, 4, '#6a8a68', 1.2);
  // Small head, jutting jaw, tusks.
  circ(g, 3, -37, 5.4, '#6a8a68', 1.3);
  poly(g, [0, -38, 10, -37, 11, -32, 1, -32], '#6a8a68', 1.1);
  poly(g, [5, -33, 6, -29.4, 7.4, -33], '#f0ead8', 0.7);
  poly(g, [9, -33, 10.4, -29.8, 11.2, -33.4], '#f0ead8', 0.7);
  circ(g, 5.4, -38.6, 1.1, '#f8d030', 0.4);
  poly(g, [-2, -41, -6, -44, -3, -39], '#6a8a68', 0.8);
  // Moss and warts.
  g.fillStyle = C('#4a6a3a');
  g.fillRect(-6, -30, 3, 2);
  g.fillRect(4, -26, 2, 2);
}

function wagon(g: CanvasRenderingContext2D, wheel: number, time: number): void {
  const bob = Math.sin(time * 9) * 0.5;
  g.translate(0, bob);
  // Cargo of goblins peeking out.
  for (const [x, c] of [[-6, '#6aae4a'], [1, '#7aba54'], [7, '#6aae4a']] as [number, string][]) {
    circ(g, x, -22 + Math.sin(time * 6 + x) * 1.2, 4, c, 1);
    circ(g, x + 1.4, -22.6, 0.9, '#f8e04a', 0);
  }
  poly(g, [-15, -22, -13, -26, 15, -26, 14, -21], '#6a4220', 0.7);
  // Cart body.
  poly(g, [-17, -8, -19, -22, 17, -22, 19, -8, 16, -4, -14, -4], '#8a5a2c', 1.4);
  poly(g, [-17, -8, -19, -22, -4, -22, -4, -8], '#a8743a', 0);
  g.strokeStyle = 'rgba(40,24,10,0.5)';
  g.lineWidth = 0.9;
  for (const y of [-12, -17]) {
    g.beginPath();
    g.moveTo(-18, y);
    g.lineTo(18, y);
    g.stroke();
  }
  rect(g, -19, -15, 38, 1.8, '#555a62', 0.6);
  // Tow bar and flag.
  stick(g, 18, -9, 25, -6, '#5a3a1e', 1.6);
  stick(g, -14, -22, -14, -34, '#4a3420', 1.2);
  poly(g, [-14, -34, -5, -31 + Math.sin(time * 6), -14, -28], '#c8302a', 0.8);
  // Wheels with spokes.
  for (const wx of [-11, 11]) {
    circ(g, wx, -1.5, 6.5, '#5a3a1e', 1.4);
    circ(g, wx, -1.5, 5, '#8a5a2c', 0.6);
    for (let k = 0; k < 4; k++) {
      const a = wheel + k * Math.PI / 4;
      seg(g, wx - Math.cos(a) * 5, -1.5 - Math.sin(a) * 5, wx + Math.cos(a) * 5, -1.5 + Math.sin(a) * 5, '#d8c08a', 0.9);
    }
    circ(g, wx, -1.5, 1.4, '#555a62', 0.6);
  }
}

function shaman(g: CanvasRenderingContext2D, ph: number, bob: number, time: number): void {
  legPair(g, ph, 0, 5, 3.4, '#4a3a2a', 1.6);
  g.translate(0, -bob);
  // Staff with a glowing orb and feathers.
  stick(g, 9, -1, 9, -28, '#6a4220', 1.6);
  const p = 0.7 + Math.sin(time * 4) * 0.25;
  glow(g, 9, -31, 7 * p, '#60e8c0', 0.35);
  circ(g, 9, -31, 3, '#90ffe0', 1);
  stick(g, 6, -26, 4, -22, '#c8302a', 1);
  stick(g, 12, -26, 14, -22, '#3a8ac4', 1);
  // Robe.
  poly(g, [-7, -5, -9, -18, -5, -23, 6, -23, 9, -18, 8, -5], '#7a3a8a', 1.3);
  poly(g, [-7, -5, -9, -18, -3, -20, -2, -5], '#9a5aa8', 0);
  rect(g, -8, -11, 16, 2, '#e8b830', 0.6);
  // Orc head with bone mask.
  circ(g, 1, -26.5, 5, '#6a9a40', 1.2);
  poly(g, [-3, -30, 6, -30, 6.4, -24, 3, -21, -2.6, -24], '#f0ead8', 1.1);
  rect(g, -0.5, -29, 1.6, 2.4, '#2a2218', 0);
  circ(g, 3.6, -27.4, 1.4, '#1a1410', 0);
  circ(g, 3.8, -27.4, 0.5, '#60ffd0', 0);
  rect(g, 1.4, -23, 1, 2, '#2a2218', 0);
  // Feather headdress.
  poly(g, [-3, -31, -6, -39, -1.4, -33], '#c8302a', 0.8);
  poly(g, [0, -32, -1, -41, 2, -33], '#e8b830', 0.8);
  poly(g, [3, -31, 6, -38, 4.6, -31], '#3a8ac4', 0.8);
}

function ogreking(g: CanvasRenderingContext2D, ph: number, time: number, smash: boolean): void {
  const bob = Math.abs(Math.sin(ph * 0.6)) * 2;
  // Stomping legs.
  rect(g, -17 + Math.sin(ph * 0.6) * 2, -14, 13, 14, '#a8805a', 1.4);
  rect(g, 4 - Math.sin(ph * 0.6) * 2, -14, 13, 14, '#a8805a', 1.4);
  rect(g, -18, -3, 15, 4, '#3a2a1a', 1);
  rect(g, 3, -3, 15, 4, '#3a2a1a', 1);
  g.translate(0, -bob);
  // Giant spiked club.
  g.save();
  g.translate(20, -26);
  g.rotate(smash ? -1.4 + Math.abs(Math.sin(time * 6)) * 2.4 : -0.35 + Math.sin(ph * 0.6) * 0.08);
  stick(g, 0, 8, 0, -30, '#6a4220', 5);
  ell(g, 0, -34, 9, 13, '#7a5230', 1.6);
  for (const [dx, dy] of [[-8, -40], [8, -36], [-7, -29], [7, -29], [0, -47], [0, -23]]) poly(g, [dx - 2, dy, dx + (dx < 0 ? -4 : 4), dy - 2.4, dx + 2, dy + 2], '#c8c0a8', 0.9);
  g.restore();
  // Big belly body.
  poly(g, [-22, -12, -27, -34, -17, -52, 17, -52, 27, -34, 23, -12], '#b88a60', 1.8);
  poly(g, [-18, -14, -23, -34, -15, -48, -4, -48, -7, -14], '#c8a078', 0);
  ell(g, 2, -28, 13, 14, '#c8a078', 1);
  circ(g, 2, -25, 1.6, '#8a6040', 0.6);
  // Belt and loincloth.
  rect(g, -23, -19, 46, 6, '#5a3a1e', 1.3);
  rect(g, -3, -20, 8, 8, '#e8b830', 1);
  poly(g, [-14, -13, -10, -4, 10, -4, 14, -13], '#8a3a2a', 1.1);
  // Arm and fist.
  poly(g, [-24, -46, -32, -28, -26, -18, -19, -24, -20, -40], '#b88a60', 1.5);
  circ(g, -26, -16, 6, '#b88a60', 1.5);
  // Head with crown.
  circ(g, 3, -57, 9, '#b88a60', 1.7);
  poly(g, [-1, -57, 12, -56, 13, -48, -1, -48], '#b88a60', 1.3);
  poly(g, [5, -49, 6.5, -43.4, 8.6, -49], '#f0ead8', 0.8);
  poly(g, [9.8, -49, 11.4, -44, 12.6, -49.4], '#f0ead8', 0.8);
  circ(g, 8, -59, 1.8, '#f0e0a0', 0.8);
  circ(g, 8.4, -59, 0.8, '#c8302a', 0);
  poly(g, [0, -61, 6, -63, 12, -61], '#5a3a1e', 1);
  poly(g, [-6, -63, -5.4, -72, -1.6, -66, 3, -75, 7, -66, 11, -74, 12, -63], '#f0c030', 1.4);
  circ(g, 3, -68, 1.5, '#d03a30', 0.6);
  circ(g, -4, -66, 1.1, '#3a8ac4', 0.5);
  // Ear.
  circ(g, -6, -57, 2.8, '#b88a60', 1);
}

function lich(g: CanvasRenderingContext2D, time: number): void {
  const hover = Math.sin(time * 1.6) * 3;
  const pulse = 0.65 + Math.sin(time * 3) * 0.2;
  glow(g, 0, -36 + hover, 46, '#58ff9a', 0.14 * pulse);
  g.translate(0, hover - 6);
  // Ragged robe, tapering into wisps (no legs).
  poly(g, [-18, 0, -22, -22, -14, -48, -6, -58, 6, -58, 14, -48, 22, -22, 18, 0, 11, -5, 5, 3, 0, -4, -6, 4, -12, -5], '#2e2640', 1.8);
  poly(g, [-18, 0, -22, -22, -14, -48, -6, -58, -2, -58, -6, -20, -8, -4], '#3e3458', 0);
  rect(g, -12, -30, 24, 2.6, '#58ff9a', 0.7);
  for (let i = -2; i <= 2; i++) rect(g, i * 5 - 0.6, -26, 1.2, 6, '#58ff9a', 0);
  // Bony hands and staff.
  stick(g, 20, 8, 20, -66, '#4a3a2a', 2.4);
  glow(g, 20, -72, 14 * pulse, '#58ff9a', 0.4);
  circ(g, 20, -72, 5.5, '#a8ffcc', 1.4);
  poly(g, [15, -66, 20, -62, 25, -66, 20, -70], '#2e2640', 1);
  circ(g, 18, -30, 2.6, '#e8e4d4', 1);
  circ(g, 16, -33, 1.8, '#e8e4d4', 0.8);
  // Skull head under a hood.
  poly(g, [-9, -54, -11, -62, -5, -73, 5, -73, 11, -62, 9, -54], '#2e2640', 1.6);
  circ(g, 0, -62, 7.4, '#ece8d8', 1.5);
  rect(g, -4, -56, 8, 3.4, '#ece8d8', 1);
  for (let i = -1; i <= 2; i++) seg(g, i * 2 - 1, -56, i * 2 - 1, -53, '#2a2218', 0.8);
  circ(g, -3, -63, 2.4, '#10100e', 0);
  circ(g, 3, -63, 2.4, '#10100e', 0);
  glow(g, -3, -63, 4.6, '#58ff9a', 0.7);
  glow(g, 3, -63, 4.6, '#58ff9a', 0.7);
  poly(g, [-1, -60, 0, -58.4, 1, -60], '#10100e', 0);
  // Jagged crown.
  poly(g, [-8, -68, -8, -77, -4, -71, 0, -80, 4, -71, 8, -77, 8, -68], '#8a9a98', 1.3);
  circ(g, 0, -71, 1.4, '#58ff9a', 0);
  void fs;
  void TAU;
}
