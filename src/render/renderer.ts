import { BOSS, STEP } from '../data/balance';
import { PASSIVES, WEAPONS } from '../data/content';
import { hashCell } from '../sim/rng';
import { postRadius } from '../sim/lantern';
import { emberTarget, RunState } from '../sim/state';

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function cobbleTile(): HTMLCanvasElement {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#141927';
  g.fillRect(0, 0, 256, 256);
  // Seven columns and eight rows divide the tile exactly, so the pattern repeats without a seam.
  const colW = 256 / 7;
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col <= 7; col++) {
      const x = col * colW + (row % 2) * (colW / 2);
      const y = row * 32;
      const h = hashCell(9, (col + 7) % 7, row);
      g.fillStyle = h > 0.5 ? '#1a2030' : '#232a3d';
      g.beginPath();
      g.roundRect(x + 2, y + 2, colW - 4 - h * 3, 28 - h * 2, 8);
      g.fill();
    }
  }
  return c;
}

function lightSprite(stop: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(stop, 'rgba(0,0,0,1)');
  gr.addColorStop(0.86, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return c;
}

function glowSprite(): HTMLCanvasElement {
  const [c, g] = makeCanvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,179,71,0.3)');
  gr.addColorStop(0.35, 'rgba(255,179,71,0.08)');
  gr.addColorStop(1, 'rgba(255,179,71,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return c;
}

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; colour: string; size: number }
interface Whip { x: number; y: number; dir: number; len: number; arc: number; t: number; stained: boolean }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  zoom = 1;
  private tile: CanvasPattern | null = null;
  private dark: HTMLCanvasElement;
  private darkCtx: CanvasRenderingContext2D;
  private hole = lightSprite(0.6);
  private glow = glowSprite();
  private sparks: Spark[] = [];
  private whips: Whip[] = [];
  private shake = 0;
  reduceMotion = false;
  debug = false;
  fps = 60;
  joystick: { x: number; y: number; dx: number; dy: number } | null = null;
  private seed = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    [this.dark, this.darkCtx] = makeCanvas(2, 2);
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    // Keep at least 640 world pixels across the short side so the light always fits on phones.
    this.zoom = Math.max(0.55, Math.min(1.25, Math.min(this.w, this.h) / 640));
    this.dark.width = Math.max(1, Math.ceil(this.w / 2));
    this.dark.height = Math.max(1, Math.ceil(this.h / 2));
    this.tile = this.ctx.createPattern(cobbleTile(), 'repeat');
  }

  viewHalf(): { w: number; h: number } {
    return { w: this.w / this.zoom / 2, h: this.h / this.zoom / 2 };
  }

  resetFx(seed: number): void {
    this.sparks.length = 0;
    this.whips.length = 0;
    this.shake = 0;
    this.seed = seed;
  }

  private addSparks(x: number, y: number, n: number, colour: string, speed: number): void {
    for (let i = 0; i < n && this.sparks.length < 300; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.25 + Math.random() * 0.35, colour, size: 1 + Math.random() * 2 });
    }
  }

  /** Turns the frame's simulation events into visual effects. */
  consumeEvents(s: RunState): void {
    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      switch (e.type) {
        case 'dawn': this.whips.length = 0; break;
        case 'hit': if (e.a) this.addSparks(e.x, e.y, 1, '#ffd9a0', 90); break;
        case 'kill':
          if (e.b === 2) this.addSparks(e.x, e.y, 2, '#8a8078', 40);
          else if (e.b === 1) this.addSparks(e.x, e.y, 3, '#ff7a2f', 110);
          break;
        case 'lash': case 'stainedlash':
          this.whips.push({ x: e.x, y: e.y, dir: e.a, len: e.b, arc: e.c, t: 0, stained: e.type === 'stainedlash' });
          break;
        case 'hurt': this.shake = Math.max(this.shake, e.a ? 12 : 4); break;
        case 'inversion': this.shake = 14; break;
        case 'sweep': this.shake = Math.max(this.shake, 8); break;
        case 'oil': this.addSparks(e.x, e.y, 5, '#7ad7c2', 80); break;
        case 'boss': this.shake = 10; break;
        default: break;
      }
    }
  }

  private skyColour(s: RunState): [number, number, number, number] {
    const m = s.t / 60;
    const dusk: [number, number, number] = [38, 24, 62];
    const night: [number, number, number] = [11, 14, 26];
    const k = clamp01(m / 4);
    let r = lerp(dusk[0], night[0], k);
    let g = lerp(dusk[1], night[1], k);
    let b = lerp(dusk[2], night[2], k);
    let a = 0.97;
    if (m > 13) { const d = clamp01((m - 13) / 2) * 0.35; r = lerp(r, 90, d); g = lerp(g, 68, d); b = lerp(b, 84, d); }
    if (s.bossDead) {
      const d = clamp01(s.dawnT / BOSS.dawnTime);
      r = lerp(r, 232, d); g = lerp(g, 183, d); b = lerp(b, 176, d);
      a = lerp(a, 0.28, d);
    }
    return [r, g, b, a];
  }

  private decor(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const size = 340;
    for (let cy = Math.floor(y0 / size) - 1; cy <= Math.floor(y1 / size) + 1; cy++) {
      for (let cx = Math.floor(x0 / size) - 1; cx <= Math.floor(x1 / size) + 1; cx++) {
        const h = hashCell(this.seed + 5, cx, cy);
        if (h > 0.62) continue;
        const x = (cx + 0.2 + hashCell(this.seed + 6, cx, cy) * 0.6) * size;
        const y = (cy + 0.2 + hashCell(this.seed + 8, cx, cy) * 0.6) * size;
        if (h < 0.22) { // Doorway set in a wall stub.
          g.fillStyle = '#10141f';
          g.fillRect(x - 44, y - 58, 88, 66);
          g.fillStyle = '#2a2230';
          g.fillRect(x - 13, y - 34, 26, 42);
          g.fillStyle = '#6b5a48';
          g.fillRect(x + 7, y - 12, 3, 3);
        } else if (h < 0.42) { // Fence.
          g.fillStyle = '#2b3246';
          for (let i = 0; i < 6; i++) g.fillRect(x - 45 + i * 18, y - 22, 5, 26);
          g.fillRect(x - 50, y - 14, 100, 3);
        } else { // Dead tree.
          g.strokeStyle = '#2a3043';
          g.lineWidth = 5;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y - 48);
          g.lineTo(x - 22, y - 78);
          g.moveTo(x, y - 40);
          g.lineTo(x + 24, y - 66);
          g.moveTo(x - 12, y - 62);
          g.lineTo(x - 2, y - 88);
          g.stroke();
        }
      }
    }
  }

  drawTitle(time: number): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.tile ?? '#141927';
    g.fillRect(0, 0, this.w, this.h);
    const d = this.darkCtx;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.dark.width, this.dark.height);
    d.fillStyle = 'rgba(30,20,50,0.97)';
    d.fillRect(0, 0, this.dark.width, this.dark.height);
    d.globalCompositeOperation = 'destination-out';
    const r = (Math.min(this.w, this.h) * 0.42 + Math.sin(time * 1.7) * 6 + Math.sin(time * 4.3) * 3) / 2;
    d.drawImage(this.hole, this.dark.width / 2 - r, this.dark.height * 0.5 - r, r * 2, r * 2);
    g.drawImage(this.dark, 0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(this.glow, this.w / 2 - r * 2, this.h / 2 - r * 2, r * 4, r * 4);
    g.globalCompositeOperation = 'source-over';
  }

  draw(s: RunState, alpha: number, frameDt: number, wallTime: number): void {
    const g = this.ctx;
    const p = s.player;
    const px = lerp(p.px, p.x, alpha);
    const py = lerp(p.py, p.y, alpha);
    const z = this.zoom;
    const hw = this.w / z / 2;
    const hh = this.h / z / 2;
    this.shake *= Math.exp(-frameDt * 9);
    const sh = this.reduceMotion ? 0 : this.shake;
    const camX = px - hw + (sh ? (Math.random() - 0.5) * sh : 0);
    const camY = py - hh + (sh ? (Math.random() - 0.5) * sh : 0);
    const inView = (x: number, y: number, m: number): boolean => x > camX - m && x < camX + hw * 2 + m && y > camY - m && y < camY + hh * 2 + m;

    // World.
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.save();
    g.scale(z, z);
    g.translate(-camX, -camY);
    g.fillStyle = this.tile ?? '#141927';
    g.fillRect(camX - 2, camY - 2, hw * 2 + 4, hh * 2 + 4);
    this.decor(g, camX, camY, camX + hw * 2, camY + hh * 2);
    this.drawPosts(g, s, camX, camY, hw, hh);

    // Burning ground.
    for (let i = 0; i < s.pools.count; i++) {
      const b = s.pools.items[i];
      if (!inView(b.x, b.y, b.r)) continue;
      g.globalAlpha = 0.3 * (1 - b.t / b.life) + 0.08;
      g.fillStyle = '#ff7a2f';
      g.beginPath();
      g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Crates.
    for (let i = 0; i < s.crates.count; i++) {
      const c = s.crates.items[i];
      g.fillStyle = '#5a4630';
      g.fillRect(c.x - 12, c.y - 10, 24, 20);
      g.strokeStyle = '#7ad7c2';
      g.lineWidth = 2;
      g.strokeRect(c.x - 12, c.y - 10, 24, 20);
    }

    // Pickups.
    this.drawPickups(g, s, alpha, 1, inView);

    // Enemies in the light, batched by kind.
    this.drawEnemies(g, s, alpha, px, py, inView);

    // Sentries, moths, projectiles.
    for (let i = 0; i < s.sentries.count; i++) {
      const c = s.sentries.items[i];
      g.fillStyle = '#6d5a42';
      g.fillRect(c.x - 5, c.y - 12, 10, 16);
      g.fillStyle = '#f7e3b0';
      g.fillRect(c.x - 3, c.y - 20, 6, 10);
      g.fillStyle = c.bell ? '#cfe0ff' : '#ffb347';
      g.beginPath();
      g.arc(c.x, c.y - 23, 3, 0, Math.PI * 2);
      g.fill();
    }
    const fire = s.weapons.some((w) => w.id === 'firemoth');
    g.fillStyle = fire ? '#ff9a4a' : '#e8dcae';
    const mothCount = !s.bossDead && s.weapons.some((w) => w.id === 'moth' || w.id === 'firemoth') ? s.moths.length : 0;
    for (let i = 0; i < mothCount; i++) {
      const m = s.moths[i];
      const mx = lerp(m.px, m.x, alpha);
      const my = lerp(m.py, m.y, alpha);
      const flap = 3 + Math.sin(wallTime * 30 + i) * 2;
      g.beginPath();
      g.ellipse(mx - 3, my, flap, 2.4, 0.4, 0, Math.PI * 2);
      g.ellipse(mx + 3, my, flap, 2.4, -0.4, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < s.projectiles.count; i++) {
      const q = s.projectiles.items[i];
      const x = lerp(q.px, q.x, alpha);
      const y = lerp(q.py, q.y, alpha);
      if (q.kind === 'cinder') {
        const k = q.t / q.life;
        g.fillStyle = '#ff7a2f';
        g.beginPath();
        g.arc(x, y - Math.sin(k * Math.PI) * 60, 5, 0, Math.PI * 2);
        g.fill();
      } else if (q.kind === 'shard') {
        g.fillStyle = '#9fd8ff';
        g.fillRect(x - 3, y - 3, 6, 6);
      } else if (q.kind === 'stained') {
        g.fillStyle = `hsl(${q.hue} 80% 65%)`;
        g.fillRect(x - 3, y - 3, 6, 6);
      } else {
        g.fillStyle = '#ffe2a8';
        g.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    // Bell rings.
    g.lineWidth = 3;
    for (let i = 0; i < s.rings.count; i++) {
      const r = s.rings.items[i];
      g.strokeStyle = `rgba(217,210,240,${0.75 * (1 - r.r / r.max) + 0.1})`;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    this.drawWhips(g, frameDt);

    // Player, then lantern.
    const hurt = p.hurt > 0;
    g.fillStyle = hurt ? '#d94f6a' : '#cbbfae';
    g.beginPath();
    g.moveTo(px - 9, py + 11);
    g.quadraticCurveTo(px - 8, py - 12, px, py - 14);
    g.quadraticCurveTo(px + 8, py - 12, px + 9, py + 11);
    g.closePath();
    g.fill();
    const lx = px + Math.cos(p.facing) * 11;
    const ly = py - 3 + Math.sin(p.facing) * 6;
    if (s.flame !== 'guttering') {
      g.fillStyle = s.flame === 'dimmed' ? '#b87a30' : '#ffcf7a';
      g.beginPath();
      g.arc(lx, ly, 4, 0, Math.PI * 2);
      g.fill();
    }
    // Sparks.
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const f = this.sparks[i];
      f.t += frameDt;
      if (f.t >= f.life) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
      f.x += f.vx * frameDt;
      f.y += f.vy * frameDt;
      g.globalAlpha = 1 - f.t / f.life;
      g.fillStyle = f.colour;
      g.fillRect(f.x, f.y, f.size, f.size);
    }
    g.globalAlpha = 1;
    this.drawBossBody(g, s, alpha, wallTime);
    g.restore();

    // Darkness layer at half resolution, holes cut with destination-out.
    this.drawDarkness(s, px, py, camX, camY, z, wallTime);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.drawImage(this.dark, 0, 0, this.w, this.h);

    // Warm glow on top.
    g.globalCompositeOperation = 'lighter';
    const flick = 1 + Math.sin(wallTime * 7.3) * 0.02 + Math.sin(wallTime * 13.1) * 0.015;
    const gr = s.radius * z * 1.25 * flick;
    const sx = (px - camX) * z;
    const sy = (py - camY) * z;
    g.drawImage(this.glow, sx - gr, sy - gr, gr * 2, gr * 2);
    for (const post of s.bossDead ? [] : s.litPosts) {
      const r = postRadius(post) * z * 1.1;
      g.drawImage(this.glow, (post.x - camX) * z - r, (post.y - camY) * z - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    // Things that read over the dark: eyes, pickups, telegraphs.
    g.save();
    g.scale(z, z);
    g.translate(-camX, -camY);
    this.drawEyes(g, s, alpha, px, py, inView);
    this.drawPickups(g, s, alpha, 0.42, inView);
    this.drawBossOverlay(g, s, alpha, wallTime);
    g.restore();

    this.drawHud(s, wallTime, camX, camY, z);
  }

  private drawPosts(g: CanvasRenderingContext2D, s: RunState, camX: number, camY: number, hw: number, hh: number): void {
    const size = 700;
    const x0 = Math.floor(camX / size);
    const x1 = Math.floor((camX + hw * 2) / size);
    const y0 = Math.floor(camY / size);
    const y1 = Math.floor((camY + hh * 2) / size);
    for (let cy = y0 - 1; cy <= y1 + 1; cy++) {
      for (let cx = x0 - 1; cx <= x1 + 1; cx++) {
        const x = (cx + 0.2 + hashCell(s.cfg.seed, cx, cy) * 0.6) * size;
        const y = (cy + 0.2 + hashCell(s.cfg.seed + 77, cx, cy) * 0.6) * size;
        const post = s.posts.get((cx + 32768) * 65536 + (cy + 32768));
        const lit = (post?.life ?? 0) > 0;
        g.fillStyle = '#39415a';
        g.fillRect(x - 3, y - 46, 6, 50);
        g.fillStyle = lit ? '#ffcf7a' : '#4a5470';
        g.fillRect(x - 8, y - 60, 16, 16);
        g.fillStyle = '#39415a';
        g.fillRect(x - 10, y - 64, 20, 4);
        if (s.activePost === post && post) {
          g.strokeStyle = '#ffb347';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + (post.progress / 1) * Math.PI * 2);
          g.stroke();
        }
      }
    }
  }

  private drawPickups(g: CanvasRenderingContext2D, s: RunState, alpha: number, a: number, inView: (x: number, y: number, m: number) => boolean): void {
    g.globalAlpha = a;
    const items = s.pickups.items;
    for (const [kind, colour] of [['ember', '#ff7a2f'], ['droplet', '#7ad7c2'], ['flask', '#7ad7c2']] as const) {
      g.fillStyle = colour;
      g.beginPath();
      for (let i = 0; i < s.pickups.count; i++) {
        const k = items[i];
        if (k.kind !== kind) continue;
        const x = lerp(k.px, k.x, alpha);
        const y = lerp(k.py, k.y, alpha);
        if (!inView(x, y, 10)) continue;
        if (kind === 'ember') {
          const r = k.value >= 25 ? 6 : k.value >= 5 ? 4 : 2.5;
          g.moveTo(x, y - r);
          g.lineTo(x + r, y);
          g.lineTo(x, y + r);
          g.lineTo(x - r, y);
          g.closePath();
        } else if (kind === 'droplet') {
          g.moveTo(x, y - 6);
          g.quadraticCurveTo(x + 5, y + 1, x, y + 4);
          g.quadraticCurveTo(x - 5, y + 1, x, y - 6);
        } else {
          g.rect(x - 6, y - 7, 12, 14);
          g.rect(x - 3, y - 11, 6, 4);
        }
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawEnemies(g: CanvasRenderingContext2D, s: RunState, alpha: number, px: number, py: number, inView: (x: number, y: number, m: number) => boolean): void {
    const items = s.enemies.items;
    const n = s.enemies.count;
    const bodies: Record<string, string> = { mite: '#070910', hollow: '#0c0f19', snuffer: '#0d1220', hound: '#160a14' };
    for (const kind of ['mite', 'snuffer', 'hollow', 'hound']) {
      g.fillStyle = bodies[kind];
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const e = items[i];
        if (e.def.id !== kind || !e.inLight) continue;
        const x = lerp(e.px, e.x, alpha);
        const y = lerp(e.py, e.y, alpha);
        if (!inView(x, y, e.r + 4)) continue;
        const r = e.r;
        if (kind === 'mite') {
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, Math.PI * 2);
        } else if (kind === 'hollow') {
          g.moveTo(x - r, y + r);
          g.quadraticCurveTo(x - r, y - r * 1.8, x, y - r * 1.8);
          g.quadraticCurveTo(x + r, y - r * 1.8, x + r, y + r);
          g.closePath();
        } else if (kind === 'snuffer') {
          g.moveTo(x - r * 1.6, y - r * 0.5);
          g.lineTo(x, y - r);
          g.lineTo(x + r * 1.6, y - r * 0.5);
          g.lineTo(x, y + r);
          g.closePath();
        } else {
          g.moveTo(x + r * 1.5, y);
          g.ellipse(x, y, r * 1.5, r * 0.8, 0, 0, Math.PI * 2);
        }
      }
      g.fill();
    }
    // Rim light on the side facing the lantern.
    g.strokeStyle = 'rgba(255,179,71,0.85)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const e = items[i];
      if (!e.inLight || e.boss) continue;
      const x = lerp(e.px, e.x, alpha);
      const y = lerp(e.py, e.y, alpha);
      if (!inView(x, y, e.r + 4)) continue;
      const a = Math.atan2(py - y, px - x);
      g.moveTo(x + Math.cos(a - 0.9) * e.r, y + Math.sin(a - 0.9) * e.r);
      g.arc(x, y, e.r, a - 0.9, a + 0.9);
    }
    g.stroke();
    // Hit flashes, elite halos, danger eyes.
    g.fillStyle = 'rgba(255,240,220,0.9)';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const e = items[i];
      if (e.flash <= 0 || !e.inLight || e.boss) continue;
      const x = lerp(e.px, e.x, alpha);
      const y = lerp(e.py, e.y, alpha);
      if (!inView(x, y, e.r)) continue;
      g.moveTo(x + e.r, y);
      g.arc(x, y, e.r, 0, Math.PI * 2);
    }
    g.fill();
    g.strokeStyle = 'rgba(232,230,245,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const e = items[i];
      if (!e.elite) continue;
      const x = lerp(e.px, e.x, alpha);
      const y = lerp(e.py, e.y, alpha);
      if (!inView(x, y, e.r + 8)) continue;
      g.moveTo(x + e.r + 5, y);
      g.arc(x, y, e.r + 5, 0, Math.PI * 2);
    }
    g.stroke();
    g.fillStyle = '#d94f6a';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const e = items[i];
      if (!e.inLight || e.boss) continue;
      const x = lerp(e.px, e.x, alpha);
      const y = lerp(e.py, e.y, alpha);
      if (!inView(x, y, e.r)) continue;
      g.rect(x - 4, y - 3, 2.4, 2.4);
      g.rect(x + 1.6, y - 3, 2.4, 2.4);
    }
    g.fill();
  }

  private drawEyes(g: CanvasRenderingContext2D, s: RunState, alpha: number, px: number, py: number, inView: (x: number, y: number, m: number) => boolean): void {
    g.fillStyle = 'rgba(222,228,255,0.5)';
    g.beginPath();
    for (let i = 0; i < s.enemies.count; i++) {
      const e = s.enemies.items[i];
      if (e.inLight || e.boss || e.def.id === 'hound') continue; // Hounds show nothing in the dark.
      const x = lerp(e.px, e.x, alpha);
      const y = lerp(e.py, e.y, alpha);
      if (!inView(x, y, 10)) continue;
      const d = Math.hypot(px - x, py - y) || 1;
      const ox = ((px - x) / d) * 2;
      const oy = ((py - y) / d) * 2;
      const w = e.elite ? 3.5 : 2;
      g.rect(x + ox - 3 - w / 2, y + oy - 1, w, w);
      g.rect(x + ox + 3 - w / 2, y + oy - 1, w, w);
    }
    g.fill();
  }

  private drawWhips(g: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.whips.length - 1; i >= 0; i--) {
      const w = this.whips[i];
      w.t += dt;
      const k = w.t / 0.18;
      if (k >= 1) { this.whips.splice(i, 1); continue; }
      const sweep = w.dir - w.arc + w.arc * 2 * Math.min(1, k * 1.6);
      g.strokeStyle = w.stained ? `hsla(${280 + k * 160},85%,68%,${1 - k})` : `rgba(255,190,100,${1 - k})`;
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(w.x, w.y, w.len * (0.75 + k * 0.25), w.dir - w.arc, sweep);
      g.stroke();
      g.globalAlpha = (1 - k) * 0.22;
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.moveTo(w.x, w.y);
      g.arc(w.x, w.y, w.len, w.dir - w.arc, sweep);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
  }

  private drawBossBody(g: CanvasRenderingContext2D, s: RunState, alpha: number, time: number): void {
    const e = s.bossEnemy;
    const b = s.boss;
    if (!e || !b) return;
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    // In the last phase the lit view shows nothing of it.
    if (b.phase === 3 && s.flame !== 'dimmed') return;
    g.fillStyle = '#04050a';
    g.beginPath();
    g.moveTo(x - 40, y + 44);
    g.quadraticCurveTo(x - 46, y - 80, x, y - 110);
    g.quadraticCurveTo(x + 46, y - 80, x + 40, y + 44);
    g.quadraticCurveTo(x, y + 60 + Math.sin(time * 2) * 6, x - 40, y + 44);
    g.fill();
    if (e.flash > 0) {
      g.fillStyle = 'rgba(180,170,210,0.25)';
      g.fill();
    }
  }

  private drawBossOverlay(g: CanvasRenderingContext2D, s: RunState, alpha: number, time: number): void {
    const e = s.bossEnemy;
    const b = s.boss;
    if (!e || !b) return;
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    // Ring of pale eyes, closed for good in the last phase.
    if (b.phase < 3) {
      g.fillStyle = 'rgba(232,230,245,0.85)';
      for (let i = 0; i < 9; i++) {
        const a = time * 0.4 + (i / 9) * Math.PI * 2;
        const ex = x + Math.cos(a) * 26;
        const ey = y - 58 + Math.sin(a) * 26;
        g.beginPath();
        g.ellipse(ex, ey, 4, 2.2, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // The core flickers whenever the lantern dims, and burns steadily when it matters.
    const show = (b.phase === 3 && s.flame === 'dimmed') || b.dimFlicker > 0;
    if (show) {
      const steady = b.phase === 3 && s.flame === 'dimmed';
      const a = steady ? 0.9 + Math.sin(time * 9) * 0.1 : (Math.sin(time * 60) > 0 ? 0.8 : 0.15) * (b.dimFlicker / BOSS.dimFlicker);
      g.globalAlpha = a;
      g.fillStyle = '#ff5a2a';
      g.beginPath();
      g.arc(x, y - 40, 13 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = a * 0.3;
      g.beginPath();
      g.arc(x, y - 40, 30, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    // Sweeps, bright against the dark.
    if (b.sweepT > 0 || b.sweepFlash > 0) {
      const fire = b.sweepFlash > 0;
      const k = fire ? 1 : 1 - b.sweepT / BOSS.sweepTelegraph;
      g.globalAlpha = fire ? 0.75 : 0.14 + k * 0.28;
      g.fillStyle = fire ? '#f2eaff' : '#c9b8ff';
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, BOSS.sweepLength * (fire ? 1 : 0.5 + k * 0.5), b.sweepAngle - BOSS.sweepHalfArc, b.sweepAngle + BOSS.sweepHalfArc);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
  }

  private drawDarkness(s: RunState, px: number, py: number, camX: number, camY: number, z: number, time: number): void {
    const d = this.darkCtx;
    const [r, gc, b, a] = this.skyColour(s);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.dark.width, this.dark.height);
    const cx = this.dark.width / 2;
    const cy = this.dark.height / 2;
    const grad = d.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.2, cx, cy, Math.hypot(cx, cy));
    grad.addColorStop(0, `rgba(${r | 0},${gc | 0},${b | 0},${a})`);
    grad.addColorStop(1, `rgba(${Math.max(0, r * 0.55) | 0},${Math.max(0, gc * 0.55) | 0},${Math.max(0, b * 0.6) | 0},${Math.min(1, a + 0.02)})`);
    d.fillStyle = grad;
    d.fillRect(0, 0, this.dark.width, this.dark.height);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, rad: number): void => {
      const R = rad * z * 0.5 * 1.16;
      const hx = (x - camX) * z * 0.5;
      const hy = (y - camY) * z * 0.5;
      d.drawImage(this.hole, hx - R, hy - R, R * 2, R * 2);
    };
    let stutter = 1;
    if (s.boss && s.boss.stutter > 0) stutter = Math.sin(time * 47) > 0 ? 0.25 : 1;
    const breathe = 1 + Math.sin(time * 5.1) * 0.012 + Math.sin(time * 11.7) * 0.008;
    if (s.radius > 1) hole(px, py, s.radius * breathe * stutter);
    // Morning has no pools of light in it, or they would read as dark patches.
    if (!s.bossDead) {
      for (const post of s.litPosts) hole(post.x, post.y, postRadius(post));
      for (const l of s.litSentries) hole(l.x, l.y, 80);
    }
    d.globalCompositeOperation = 'source-over';
  }

  private drawHud(s: RunState, time: number, camX: number, camY: number, z: number): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const p = s.player;
    const W = this.w;
    const H = this.h;
    const small = W < 560;

    // Screen edge darkens when oil runs low.
    if (p.oil < 20 && !s.bossDead) {
      const k = (1 - p.oil / 20) * (0.6 + Math.sin(time * 5) * 0.15);
      const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
      v.addColorStop(0, 'rgba(5,4,10,0)');
      v.addColorStop(1, `rgba(5,4,10,${k})`);
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }

    // Ember bar across the top.
    const need = emberTarget(s);
    g.fillStyle = 'rgba(10,12,22,0.8)';
    g.fillRect(0, 0, W, 8);
    g.fillStyle = '#ff7a2f';
    g.fillRect(0, 0, W * clamp01(p.embers / need), 8);

    // HP bar.
    const margin = 14;
    const barW = small ? 92 : 170;
    g.fillStyle = 'rgba(10,12,22,0.8)';
    g.beginPath();
    g.roundRect(margin + 44, 20, barW, 12, 4);
    g.fill();
    g.fillStyle = '#d94f6a';
    g.beginPath();
    g.roundRect(margin + 44, 20, barW * clamp01(p.hp / p.maxHp), 12, 4);
    g.fill();
    g.fillStyle = '#efe6da';
    g.font = '600 12px Georgia, serif';
    g.textBaseline = 'middle';
    // On a phone the number sits inside the bar so it can't run into the clock.
    g.textAlign = small ? 'center' : 'left';
    g.fillText(`${Math.ceil(p.hp)}`, small ? margin + 44 + barW / 2 : margin + 50 + barW, small ? 26.5 : 27);
    g.textAlign = 'left';
    g.font = '12px Georgia, serif';
    g.fillStyle = '#b9b3c4';
    g.fillText(`Level ${p.level}`, margin + 44, 44);

    // Oil gauge shaped like the lantern's reservoir.
    const low = p.oil < 20;
    const pulse = low ? 0.5 + Math.sin(time * 9) * 0.5 : 0;
    const gx = margin;
    const gy = 20;
    const gw = 34;
    const gh = 58;
    g.strokeStyle = low ? `rgba(217,79,106,${0.6 + pulse * 0.4})` : '#a9927a';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(gx + gw / 2, gy + 6, 8, Math.PI, 0);
    g.stroke();
    g.fillStyle = '#a9927a';
    g.fillRect(gx + 7, gy + 6, gw - 14, 4);
    g.save();
    g.beginPath();
    g.roundRect(gx, gy + 11, gw, gh - 11, 9);
    g.fillStyle = 'rgba(10,12,22,0.85)';
    g.fill();
    g.clip();
    const lv = clamp01(p.oil / p.maxOil);
    g.fillStyle = low ? `rgba(122,215,194,${0.55 + pulse * 0.45})` : '#7ad7c2';
    g.fillRect(gx, gy + gh - (gh - 11) * lv, gw, (gh - 11) * lv);
    g.restore();
    g.beginPath();
    g.roundRect(gx, gy + 11, gw, gh - 11, 9);
    g.stroke();
    g.fillStyle = '#efe6da';
    g.font = '600 12px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(`${Math.floor(p.oil)}`, gx + gw / 2, gy + 38);
    if (s.flame === 'dimmed') { g.fillStyle = '#b87a30'; g.font = '11px Georgia, serif'; g.fillText('dim', gx + gw / 2, gy + gh + 11); }
    if (s.flame === 'guttering') { g.fillStyle = '#d94f6a'; g.font = '11px Georgia, serif'; g.fillText('out', gx + gw / 2, gy + gh + 11); }

    // Clock.
    const t = s.t;
    const label = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    g.textAlign = 'center';
    g.fillStyle = '#efe6da';
    g.font = `600 ${small ? 20 : 26}px Georgia, serif`;
    g.fillText(label, W / 2, 30);

    // Boss bar.
    if (s.bossEnemy && s.boss) {
      const bw = Math.min(W - 40, 420);
      g.fillStyle = 'rgba(10,12,22,0.85)';
      g.fillRect(W / 2 - bw / 2, 48, bw, 8);
      g.fillStyle = '#e8e4f5';
      g.fillRect(W / 2 - bw / 2, 48, bw * clamp01(s.bossEnemy.hp / s.bossEnemy.maxHp), 8);
      g.font = '12px Georgia, serif';
      g.fillStyle = '#b9b3c4';
      g.fillText('The Long Night', W / 2, 68);
    }

    // Weapon and passive slots.
    const sz = small ? 26 : 32;
    const gap = 4;
    const by = H - sz - 12;
    const total = 6 * (sz + gap) - gap;
    let sx = W - margin - total;
    const row = (items: { glyph: string; colour: string; rank: number; max: number }[], y: number): void => {
      sx = W - margin - total;
      for (let i = 0; i < 6; i++) {
        g.fillStyle = 'rgba(10,12,22,0.72)';
        g.beginPath();
        g.roundRect(sx, y, sz, sz, 5);
        g.fill();
        const it = items[i];
        if (it) {
          g.strokeStyle = it.colour;
          g.lineWidth = 1.5;
          g.stroke();
          g.fillStyle = it.colour;
          g.font = `600 ${small ? 10 : 12}px Georgia, serif`;
          g.textAlign = 'center';
          g.fillText(it.glyph, sx + sz / 2, y + sz / 2 - 2);
          for (let r = 0; r < it.max; r++) {
            g.fillStyle = r < it.rank ? it.colour : 'rgba(255,255,255,0.15)';
            g.fillRect(sx + 4 + r * ((sz - 8) / 5), y + sz - 6, (sz - 8) / 5 - 1, 3);
          }
        }
        sx += sz + gap;
      }
    };
    row(s.weapons.map((w) => ({ glyph: WEAPONS[w.id].glyph, colour: WEAPONS[w.id].colour, rank: w.rank, max: WEAPONS[w.id].maxRank })), by);
    row(s.passives.map((q) => ({ glyph: PASSIVES[q.id].glyph, colour: PASSIVES[q.id].colour, rank: q.rank, max: 5 })), by - sz - gap);

    // Crate indicators at the edge of the view.
    g.fillStyle = '#7ad7c2';
    for (let i = 0; i < s.crates.count; i++) {
      const c = s.crates.items[i];
      const x = (c.x - camX) * z;
      const y = (c.y - camY) * z;
      if (x > 0 && x < W && y > 0 && y < H) continue;
      const a = Math.atan2(y - H / 2, x - W / 2);
      const k = Math.min((W / 2 - 18) / Math.max(1e-3, Math.abs(Math.cos(a))), (H / 2 - 18) / Math.max(1e-3, Math.abs(Math.sin(a))));
      const ax = W / 2 + Math.cos(a) * k;
      const ay = H / 2 + Math.sin(a) * k;
      g.save();
      g.translate(ax, ay);
      g.rotate(a);
      g.beginPath();
      g.moveTo(8, 0);
      g.lineTo(-6, -6);
      g.lineTo(-6, 6);
      g.closePath();
      g.fill();
      g.restore();
    }

    // Touch joystick.
    if (this.joystick) {
      const j = this.joystick;
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(j.x, j.y, 46, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.arc(j.x + j.dx * 46, j.y + j.dy * 46, 20, 0, Math.PI * 2);
      g.fill();
    }

    if (this.debug) {
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(8, H - 132, 210, 124);
      g.fillStyle = '#9fd8a0';
      g.font = '12px monospace';
      g.textAlign = 'left';
      const lines = [
        `fps ${this.fps.toFixed(0)}  step ${(STEP * 1000).toFixed(1)}ms`,
        `enemies ${s.enemies.count}`,
        `projectiles ${s.projectiles.count}`,
        `pickups ${s.pickups.count}`,
        `oil ${p.oil.toFixed(1)} flame ${s.flame}`,
        `radius ${s.radius.toFixed(0)} cap ${Number.isFinite(s.lightCap) ? s.lightCap.toFixed(0) : '-'}`,
        `boss phase ${s.boss?.phase ?? '-'}  kills ${s.kills}`,
        `seed ${s.cfg.seed}`,
      ];
      lines.forEach((l, i) => g.fillText(l, 14, H - 122 + i * 14));
    }
  }
}
