// Canvas 2D renderer for Gloamward Keep. Reads the simulation, never changes it.
import { ENEMIES, EnemyId, HEIGHT, HEROES, PROJECTILE, TOWERS, WORLD } from '../data/balance';
import { boardHeight, boardWidth, hexNeighbours, pixelToTile, tileCenter } from '../sim/hex';
import { FEATURE, generateMap, Terrain } from '../sim/mapgen';
import { isHeroType } from '../sim/stats';
import { Enemy, Pet, RunState, Tower } from '../sim/state';
import { circ, clamp01, glow, lerp, poly, setTint, TAU } from './art';
import { drawEnemySprite } from './enemies';
import { drawHero, drawHeroBadge } from './heroes';
import { blitBake, drawKeepBanner, hexSub, LIFT, TOP_MARGIN } from './terrain';
import { drawTower, newLinks, towerHeight, WallLinks } from './towers';
import { ViewState } from './view';

// Effect kinds.
const SPARK = 0, RING = 1, ARC = 2, CLEAVE = 3, TEXT = 4, PUFF = 5, CHIP = 6, STAR = 7;

interface Fx {
  kind: number; x: number; y: number; x2: number; y2: number; vx: number; vy: number;
  t: number; life: number; r: number; size: number; seed: number; rot: number; fill: boolean;
  colour: string; text: string;
}
const newFx = (): Fx => ({ kind: 0, x: 0, y: 0, x2: 0, y2: 0, vx: 0, vy: 0, t: 0, life: 1, r: 0, size: 1, seed: 0, rot: 0, fill: false, colour: '#fff', text: '' });
const FX_CAP = 900;
const DASH = [6, 5];
const NO_DASH: number[] = [];

/** Rough sprite heights for status icons and bars, in world px. */
const ENEMY_H: Record<EnemyId, number> = {
  goblin: 22, hexer: 26, orc: 38, stalker: 22, bat: 16, troll: 46, wagon: 36, shaman: 40, ogreking: 80, lich: 88,
};

const AURA_BUFF = (t: Tower): boolean => t.stats.buffDamage > 0 || t.stats.buffRate > 0;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  reduceMotion = false;
  private ins = { top: 0, bottom: 0, left: 0, right: 0 };
  // Camera: world px -> CSS px is `k` with origin (ox, oy).
  private k = 1;
  private ox = 0;
  private oy = 0;
  private terrainNow: Terrain | null = null;
  private bg: HTMLCanvasElement | null = null;
  private fx: Fx[] = [];
  private fxCount = 0;
  private shake = 0;
  private leakFlash = 0;
  private titleTerrain: Terrain | null = null;
  private facing = new Int8Array(4096).fill(1);
  private order: Tower[] = [];
  private enemyOrder: Enemy[] = [];
  private tileTower: (Tower | null)[] = [];
  private links: WallLinks = newLinks();
  private ghost: Tower;
  // Device-pixel transform of the current frame.
  private ka = 1;
  private tx = 0;
  private ty = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    for (let i = 0; i < FX_CAP; i++) this.fx.push(newFx());
    this.ghost = {
      uid: 7, type: 'archer', hero: false, tx: 0, ty: 0, height: 0, x: 0, y: 0, tier: 1, fork: 0, forkTier: 0, heroLevel: 1,
      heroXp: 0, skills: [], hp: 1, maxHp: 1, cd: 0, abilityCd: 1, target: 'first', angle: -Math.PI / 2, invested: 0, kills: 0, dealt: 0,
      jinxT: 0, silenceT: 0, buffDamage: 0, buffRate: 0, beamUid: 0, beamRamp: 1, beamX: 0, beamY: 0, fired: 1, hurt: 9,
    } as unknown as Tower;
    this.resize();
  }

  // -------------------------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------------------------

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.bg = null;
    this.layout();
  }

  setInsets(top: number, bottom: number, left: number, right: number): void {
    this.ins = { top, bottom, left, right };
    this.layout();
  }

  private layout(): void {
    const pad = 6;
    const availW = Math.max(40, this.w - this.ins.left - this.ins.right - pad * 2);
    const availH = Math.max(40, this.h - this.ins.top - this.ins.bottom - pad * 2);
    const ww = boardWidth(WORLD.cols);
    const wh = boardHeight(WORLD.rows) + TOP_MARGIN;
    this.k = Math.min(availW / ww, availH / wh, 3);
    this.ox = this.ins.left + pad + (availW - ww * this.k) / 2;
    this.oy = this.ins.top + pad + (availH - wh * this.k) / 2 + TOP_MARGIN * this.k;
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.ox) / this.k, y: (y - this.oy) / this.k };
  }

  /** Tile under a screen point. Raised tiles are drawn shifted up, so the front-most visible top face wins. */
  screenToTile(x: number, y: number): { col: number; row: number } | null {
    const w = this.screenToWorld(x, y);
    const cols = this.terrainNow?.cols ?? WORLD.cols;
    const rows = this.terrainNow?.rows ?? WORLD.rows;
    const t = this.terrainNow;
    if (t) {
      for (let h = HEIGHT.max; h >= 1; h--) {
        const c = pixelToTile(w.x, w.y + h * LIFT, cols, rows);
        if (c && t.height[c.row * cols + c.col] === h) return c;
      }
      const c0 = pixelToTile(w.x, w.y, cols, rows);
      return c0 && t.height[c0.row * cols + c0.col] === 0 ? c0 : null;
    }
    return pixelToTile(w.x, w.y, cols, rows);
  }

  resetFx(): void {
    this.fxCount = 0;
    this.shake = 0;
    this.leakFlash = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------------------------

  private alloc(kind: number, x: number, y: number, life: number, colour: string): Fx | null {
    if (this.fxCount >= FX_CAP) return null;
    const f = this.fx[this.fxCount++];
    f.kind = kind; f.x = x; f.y = y; f.t = 0; f.life = life; f.colour = colour;
    f.vx = 0; f.vy = 0; f.r = 0; f.size = 1; f.seed = Math.random() * 1000; f.rot = 0; f.fill = false; f.text = '';
    f.x2 = 0; f.y2 = 0;
    return f;
  }

  private sparks(x: number, y: number, n: number, colour: string, speed: number, size = 2, life = 0.5): void {
    for (let i = 0; i < n; i++) {
      const f = this.alloc(SPARK, x, y, life * (0.6 + Math.random() * 0.7), colour);
      if (!f) return;
      const a = Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.8);
      f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v - speed * 0.2; f.size = size * (0.6 + Math.random() * 0.8);
    }
  }

  private chips(x: number, y: number, n: number, colour: string, speed: number, size = 2.4): void {
    for (let i = 0; i < n; i++) {
      const f = this.alloc(CHIP, x + (Math.random() - 0.5) * 8, y, 0.7 + Math.random() * 0.5, colour);
      if (!f) return;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = speed * (0.4 + Math.random() * 0.7);
      f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v; f.size = size * (0.6 + Math.random() * 0.8); f.rot = Math.random() * TAU;
    }
  }

  private puff(x: number, y: number, r: number, colour: string, n = 4, life = 0.55): void {
    for (let i = 0; i < n; i++) {
      const f = this.alloc(PUFF, x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r * 0.5, life * (0.7 + Math.random() * 0.6), colour);
      if (!f) return;
      f.r = r * (0.5 + Math.random() * 0.5); f.vy = -10 - Math.random() * 14; f.vx = (Math.random() - 0.5) * 20;
    }
  }

  private ring(x: number, y: number, r: number, colour: string, life: number, fill = false): void {
    const f = this.alloc(RING, x, y, life, colour);
    if (f) { f.r = r; f.fill = fill; }
  }

  private text(x: number, y: number, str: string, colour: string, size = 11, life = 0.9): void {
    const f = this.alloc(TEXT, x, y, life, colour);
    if (f) { f.text = str; f.size = size; }
  }

  private liftAt(s: RunState, x: number, y: number): number {
    const c = pixelToTile(x, y, s.terrain.cols, s.terrain.rows);
    return c ? s.terrain.height[c.row * s.terrain.cols + c.col] * LIFT : 0;
  }

  /** Turns this frame's simulation events into visual effects. Does not reset s.eventCount. */
  consumeEvents(s: RunState): void {
    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      switch (e.type) {
        case 'hit': case 'bite': this.sparks(e.x, e.y - 6, 2, '#fff1b0', 70, 1.6, 0.25); break;
        case 'chain': {
          const f = this.alloc(ARC, e.x, e.y - 8, 0.16, '#d8b8ff');
          if (f) { f.x2 = e.a; f.y2 = e.b - 8; }
          this.sparks(e.a, e.b - 8, 2, '#e8d8ff', 60, 1.6, 0.25);
          break;
        }
        case 'cleave': {
          const f = this.alloc(CLEAVE, e.x, e.y - 6, 0.22, '#f4f8ff');
          if (f) { f.rot = e.a; f.r = e.b; }
          break;
        }
        case 'pulse':
          if (e.b === 1) { this.ring(e.x, e.y, e.a, '#fff0a0', 0.45, true); this.sparks(e.x, e.y - 8, 6, '#fff6c0', 70, 1.8, 0.5); }
          else this.ring(e.x, e.y, e.a, '#8ad8ff', 0.4, true);
          break;
        case 'splash':
          this.puff(e.x, e.y, Math.max(14, e.a * 0.8), '#b09870', 4, 0.5);
          this.sparks(e.x, e.y - 4, 8, '#ff9a3a', 110, 2.2, 0.4);
          this.ring(e.x, e.y, e.a, '#ffb050', 0.25);
          break;
        case 'cluster':
          this.puff(e.x, e.y, Math.max(8, e.a * 0.7), '#b09870', 2, 0.35);
          this.sparks(e.x, e.y - 3, 4, '#ffb050', 80, 1.8, 0.3);
          break;
        case 'kill':
          this.sparks(e.x, e.y - 8, e.c ? 24 : 5 + Math.min(8, Math.floor(e.b / 3)), e.c ? '#ffd24a' : '#fff0b0', e.c ? 170 : 90, 2.2, 0.55);
          this.puff(e.x, e.y - 4, e.c ? 40 : 10 + e.b * 0.6, '#9a9488', e.c ? 6 : 2, 0.5);
          if (e.a > 0) this.text(e.x, e.y - 18, '+' + Math.round(e.a), '#ffd24a', e.c ? 15 : 11, e.c ? 1.4 : 0.85);
          if (e.c) { this.ring(e.x, e.y, 90, '#ffd24a', 0.7); this.shake = Math.max(this.shake, 9); }
          break;
        case 'leak':
          this.leakFlash = 1;
          this.shake = Math.max(this.shake, 6 + Math.min(8, e.a * 2));
          this.ring(e.x, e.y, 36, '#ff4030', 0.5, true);
          this.sparks(e.x, e.y - 6, 10, '#ff6a50', 120, 2.2, 0.5);
          break;
        case 'ability': {
          const cols = ['#f0e0a0', '#fff0a0', '#d8a0ff', '#8aff8a', '#9ae070'];
          const c = cols[e.b] ?? '#ffffff';
          this.ring(e.x, e.y, e.a, c, 0.8, true);
          this.ring(e.x, e.y, e.a * 0.6, c, 0.55);
          this.sparks(e.x, e.y - 8, 18, c, 150, 2.4, 0.7);
          if (e.b === 0) this.puff(e.x, e.y, e.a * 0.4, '#b09870', 5, 0.7);
          this.shake = Math.max(this.shake, e.b === 0 || e.b === 2 ? 5 : 2);
          break;
        }
        case 'shield': this.ring(e.x, e.y - 8, e.a, '#bff4ff', 0.5); break;
        case 'silence': this.ring(e.x, e.y, e.a, '#6a3a90', 0.7, true); break;
        case 'jinx': {
          const y = e.y - this.liftAt(s, e.x, e.y) - 14;
          this.puff(e.x, y, 14, '#8a50c0', 3, 0.6);
          this.sparks(e.x, y, 6, '#d070ff', 50, 1.8, 0.5);
          break;
        }
        case 'smash': {
          const y = e.y - this.liftAt(s, e.x, e.y) - 8;
          const c = pixelToTile(e.x, e.y, s.terrain.cols, s.terrain.rows);
          const uid = c ? s.occ[c.row * s.terrain.cols + c.col] : 0;
          const t = uid ? s.towers.find((q) => q.uid === uid) : undefined;
          const stone = t ? t.type !== 'palisade' || t.tier >= 2 : false;
          this.chips(e.x, y, 4, stone ? '#9a9ca2' : '#a8743a', 90);
          break;
        }
        case 'destroyed': {
          const y = e.y - this.liftAt(s, e.x, e.y) - 6;
          this.puff(e.x, y, 30, '#8a8478', 6, 0.8);
          this.chips(e.x, y, 14, '#8a8478', 150, 3);
          this.chips(e.x, y, 6, '#8a5a2c', 130, 3);
          if (e.a) this.sparks(e.x, y, 10, '#ffd24a', 100, 2, 0.8);
          this.shake = Math.max(this.shake, 6);
          break;
        }
        case 'heroLevel': {
          const y = e.y - this.liftAt(s, e.x, e.y) - 20;
          for (let k = 0; k < 10; k++) {
            const f = this.alloc(STAR, e.x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 22, 0.8 + Math.random() * 0.4, '#ffd24a');
            if (f) { f.vy = -22; f.size = 3 + Math.random() * 2; }
          }
          this.ring(e.x, e.y, 34, '#ffd24a', 0.6);
          this.text(e.x, y - 14, 'Level ' + Math.round(e.a), '#ffe680', 13, 1.5);
          break;
        }
        case 'build': case 'upgrade': {
          const y = e.y - this.liftAt(s, e.x, e.y);
          this.puff(e.x, y + 2, 22, '#c8b48a', 5, 0.5);
          if (e.type === 'upgrade') this.sparks(e.x, y - 10, 8, '#ffe680', 80, 2, 0.6);
          break;
        }
        case 'sell': {
          const y = e.y - this.liftAt(s, e.x, e.y);
          this.puff(e.x, y, 22, '#c8b48a', 4, 0.5);
          this.sparks(e.x, y - 8, 6, '#ffd24a', 80, 2, 0.6);
          break;
        }
        case 'clear': {
          const y = e.y - this.liftAt(s, e.x, e.y) - 4;
          if (e.a === FEATURE.forest) {
            for (let k = 0; k < 14; k++) {
              const f = this.alloc(CHIP, e.x + (Math.random() - 0.5) * 20, y - Math.random() * 14, 1 + Math.random() * 0.7, k % 3 ? '#4a9a3a' : '#a8743a');
              if (f) { f.vx = (Math.random() - 0.5) * 40; f.vy = -20 + Math.random() * 20; f.size = 2 + Math.random() * 1.6; f.rot = Math.random() * TAU; }
            }
            this.puff(e.x, y, 20, '#9ab870', 3, 0.6);
          } else {
            this.chips(e.x, y, 12, '#9a9ca2', 140, 3);
            this.puff(e.x, y, 26, '#b0a890', 5, 0.7);
          }
          if (e.b > 0) this.text(e.x, y - 10, '-' + Math.round(e.b), '#e0c070', 11, 1);
          break;
        }
        case 'boss': this.shake = Math.max(this.shake, 10); break;
        default: break;
      }
    }
  }

  private updateFx(dt: number): void {
    for (let i = this.fxCount - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t >= f.life) {
        const last = --this.fxCount;
        const tmp = this.fx[i];
        this.fx[i] = this.fx[last];
        this.fx[last] = tmp;
        continue;
      }
      switch (f.kind) {
        case SPARK:
          f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 160 * dt; f.vx *= 1 - 3 * dt;
          break;
        case CHIP:
          f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 420 * dt; f.rot += dt * 9;
          break;
        case PUFF: case STAR: case TEXT:
          f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 1 - 2 * dt;
          break;
        default: break;
      }
    }
  }

  private drawFx(g: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.fxCount; i++) {
      const f = this.fx[i];
      const u = f.t / f.life;
      switch (f.kind) {
        case SPARK:
          g.globalAlpha = 1 - u * u;
          g.fillStyle = f.colour;
          g.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
          break;
        case CHIP:
          g.globalAlpha = u < 0.7 ? 1 : (1 - u) / 0.3;
          g.fillStyle = f.colour;
          g.save();
          g.translate(f.x, f.y);
          g.rotate(f.rot);
          g.fillRect(-f.size, -f.size * 0.6, f.size * 2, f.size * 1.2);
          g.restore();
          break;
        case PUFF:
          g.globalAlpha = 0.5 * (1 - u);
          g.fillStyle = f.colour;
          g.beginPath();
          g.arc(f.x, f.y, f.r * (0.6 + u * 0.7), 0, TAU);
          g.fill();
          break;
        case RING: {
          const r = f.r * (1 - (1 - u) * (1 - u));
          if (f.fill) {
            g.globalAlpha = 0.16 * (1 - u);
            g.fillStyle = f.colour;
            g.beginPath();
            g.arc(f.x, f.y, r, 0, TAU);
            g.fill();
          }
          g.globalAlpha = 0.85 * (1 - u);
          g.strokeStyle = f.colour;
          g.lineWidth = 2.5 * (1 - u * 0.6);
          g.beginPath();
          g.arc(f.x, f.y, r, 0, TAU);
          g.stroke();
          break;
        }
        case ARC: {
          const dx = f.x2 - f.x;
          const dy = f.y2 - f.y;
          const len = Math.hypot(dx, dy) || 1;
          const n = Math.max(2, Math.round(len / 10));
          const px = -dy / len;
          const py = dx / len;
          const seed = Math.floor(f.t * 40) + f.seed;
          g.globalAlpha = 1 - u;
          for (let pass = 0; pass < 2; pass++) {
            g.strokeStyle = pass === 0 ? f.colour : '#ffffff';
            g.lineWidth = pass === 0 ? 4 : 1.4;
            g.beginPath();
            g.moveTo(f.x, f.y);
            for (let k = 1; k < n; k++) {
              const j = (Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
              g.lineTo(f.x + dx * (k / n) + px * j * 9, f.y + dy * (k / n) + py * j * 9);
            }
            g.lineTo(f.x2, f.y2);
            g.stroke();
          }
          break;
        }
        case CLEAVE: {
          const sweep = Math.min(1, u * 2.5);
          const a0 = f.rot - 1.0;
          const a1 = a0 + 2.0 * sweep;
          g.globalAlpha = 0.9 * (1 - u);
          g.strokeStyle = '#f4f8ff';
          g.lineWidth = 6 * (1 - u * 0.7);
          g.lineCap = 'round';
          g.beginPath();
          g.arc(f.x, f.y, f.r * 0.85, a0, a1);
          g.stroke();
          g.globalAlpha = 0.18 * (1 - u);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.moveTo(f.x, f.y);
          g.arc(f.x, f.y, f.r * 0.85, a0, a1);
          g.closePath();
          g.fill();
          break;
        }
        case STAR: {
          const s = f.size * Math.sin(Math.PI * u);
          g.globalAlpha = 1 - u * 0.6;
          g.fillStyle = f.colour;
          g.beginPath();
          g.moveTo(f.x, f.y - s * 1.6); g.lineTo(f.x + s * 0.4, f.y - s * 0.4); g.lineTo(f.x + s * 1.6, f.y);
          g.lineTo(f.x + s * 0.4, f.y + s * 0.4); g.lineTo(f.x, f.y + s * 1.6); g.lineTo(f.x - s * 0.4, f.y + s * 0.4);
          g.lineTo(f.x - s * 1.6, f.y); g.lineTo(f.x - s * 0.4, f.y - s * 0.4);
          g.closePath();
          g.fill();
          break;
        }
        case TEXT:
          g.globalAlpha = u < 0.6 ? 1 : (1 - u) / 0.4;
          g.font = `bold ${f.size}px sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(30,20,10,0.8)';
          g.lineJoin = 'round';
          g.strokeText(f.text, f.x, f.y - u * 16);
          g.fillStyle = f.colour;
          g.fillText(f.text, f.x, f.y - u * 16);
          break;
        default: break;
      }
    }
    g.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------------------------
  // Background
  // -------------------------------------------------------------------------------------------

  private background(g: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.bg || this.bg.width !== w || this.bg.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const b = c.getContext('2d') as CanvasRenderingContext2D;
      const gr = b.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      gr.addColorStop(0, '#34412a');
      gr.addColorStop(0.6, '#222c1c');
      gr.addColorStop(1, '#12170f');
      b.fillStyle = gr;
      b.fillRect(0, 0, w, h);
      this.bg = c;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);
  }

  // -------------------------------------------------------------------------------------------
  // Title and preview
  // -------------------------------------------------------------------------------------------

  drawTitle(time: number, terrain?: Terrain): void {
    const g = this.ctx;
    const t = terrain ?? (this.titleTerrain ??= generateMap('meadow', 1));
    const dw = this.w * this.dpr;
    const dh = this.h * this.dpr;
    this.background(g, dw, dh);
    const ww = boardWidth(t.cols);
    const wh = boardHeight(t.rows) + TOP_MARGIN;
    const k = Math.max(this.w / ww, this.h / wh) * 1.25;
    const slackX = ww * k - this.w;
    const slackY = wh * k - this.h;
    const px = 0.5 + 0.5 * Math.sin(time * 0.06);
    const py = 0.5 + 0.5 * Math.sin(time * 0.043 + 1.3);
    const ox = -slackX * px;
    const oy = -slackY * py + TOP_MARGIN * k;
    const ka = k * this.dpr;
    blitBake(g, t, ox * this.dpr, oy * this.dpr, ka, ka);
    g.setTransform(ka, 0, 0, ka, ox * this.dpr, oy * this.dpr);
    const [gc, gr] = t.goal;
    const gp = tileCenter(gc, gr);
    drawKeepBanner(g, gp.x, gp.y - t.height[gr * t.cols + gc] * LIFT, time);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = 'rgba(8,14,6,0.45)';
    g.fillRect(0, 0, this.w, this.h);
    const vg = g.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, this.w / 2, this.h / 2, Math.hypot(this.w, this.h) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, this.w, this.h);
  }

  drawPreview(ctx: CanvasRenderingContext2D, terrain: Terrain, w: number, h: number): void {
    const ww = boardWidth(terrain.cols);
    const wh = boardHeight(terrain.rows) + TOP_MARGIN;
    const k = Math.min(w / ww, h / wh);
    const ox = (w - ww * k) / 2;
    const oy = (h - wh * k) / 2 + TOP_MARGIN * k;
    const dprc = ctx.getTransform().a || 1;
    blitBake(ctx, terrain, ox, oy, k, k * dprc);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  private base(g: CanvasRenderingContext2D): void {
    g.setTransform(this.ka, 0, 0, this.ka, this.tx, this.ty);
  }

  draw(s: RunState, alpha: number, frameDt: number, wallTime: number, view: ViewState): void {
    const g = this.ctx;
    const terrain = s.terrain;
    this.terrainNow = terrain;
    const dt = Math.min(frameDt, 0.05);
    this.shake *= Math.exp(-dt * 9);
    this.leakFlash = Math.max(0, this.leakFlash - dt * 2.2);
    const sh = this.reduceMotion ? 0 : this.shake;
    const sx = sh > 0.2 ? (Math.random() - 0.5) * sh : 0;
    const sy = sh > 0.2 ? (Math.random() - 0.5) * sh : 0;
    this.ka = this.k * this.dpr;
    this.tx = (this.ox + sx) * this.dpr;
    this.ty = (this.oy + sy) * this.dpr;
    this.updateFx(dt);

    this.background(g, this.canvas.width, this.canvas.height);
    blitBake(g, terrain, this.tx, this.ty, this.ka, this.ka, s.terrainVersion);
    this.base(g);
    g.globalAlpha = 1;
    const cols = terrain.cols;

    // Tile -> tower lookup for wall links.
    const tt = this.tileTower;
    if (tt.length !== cols * terrain.rows) { tt.length = cols * terrain.rows; }
    tt.fill(null);
    const ord = this.order;
    ord.length = 0;
    for (const t of s.towers) { tt[t.ty * cols + t.tx] = t; ord.push(t); }
    ord.sort((a, b) => a.y - b.y);

    const [gc, gr] = terrain.goal;
    const gp = tileCenter(gc, gr);
    drawKeepBanner(g, gp.x, gp.y - terrain.height[gr * cols + gc] * LIFT, wallTime);

    // Burning ground.
    for (let i = 0; i < s.pools.count; i++) this.drawPool(g, s.pools.items[i], wallTime);

    this.drawGroundOverlays(g, s, view, wallTime);

    // Towers and walking enemies, back to front.
    const eo = this.enemyOrder;
    eo.length = 0;
    const E = s.enemies;
    for (let i = 0; i < E.count; i++) {
      const e = E.items[i];
      if (!e.dead && !e.def.flying) eo.push(e);
    }
    eo.sort((a, b) => a.y + a.oy - (b.y + b.oy));
    let ti = 0;
    let ei = 0;
    while (ti < ord.length || ei < eo.length) {
      const t = ord[ti];
      const e = eo[ei];
      if (t && (!e || t.y + 6 <= e.y + e.oy)) { this.drawTowerAt(g, t, s, wallTime, tt); ti++; } else if (e) { this.drawEnemy(g, e, alpha, wallTime); ei++; } else break;
    }

    // Beams, projectiles, hawks, flyers.
    for (const t of ord) if (t.stats.beam > 0 && t.beamUid !== 0) this.drawBeam(g, t);
    for (let i = 0; i < s.projectiles.count; i++) this.drawProjectile(g, s.projectiles.items[i], alpha, wallTime);
    for (let i = 0; i < s.pets.count; i++) this.drawPet(g, s.pets.items[i], alpha, wallTime);
    for (let i = 0; i < E.count; i++) {
      const e = E.items[i];
      if (!e.dead && e.def.flying) this.drawEnemy(g, e, alpha, wallTime);
    }

    this.base(g);
    this.drawFx(g);

    // Enemy and tower health bars on top of everything.
    this.drawBars(g, s, alpha);

    if (view.placing) this.drawGhost(g, s, view, wallTime);

    // Red flash when the keep is hit.
    if (this.leakFlash > 0) {
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const vg = g.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.25, this.w / 2, this.h / 2, Math.hypot(this.w, this.h) * 0.6);
      vg.addColorStop(0, 'rgba(200,20,10,0)');
      vg.addColorStop(1, `rgba(200,20,10,${0.45 * this.leakFlash})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, this.w, this.h);
    }

    if (view.debug) this.drawDebug(g, s, view);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------------------------
  // World objects
  // -------------------------------------------------------------------------------------------

  private drawPool(g: CanvasRenderingContext2D, b: { x: number; y: number; r: number; t: number; life: number }, time: number): void {
    const fade = clamp01((b.life - b.t) / 0.6) * 0.9 + 0.1;
    g.globalAlpha = 0.28 * fade;
    g.fillStyle = '#c8301a';
    g.beginPath();
    g.ellipse(b.x, b.y, b.r, b.r * 0.78, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 0.22 * fade;
    g.fillStyle = '#ffa030';
    g.beginPath();
    g.ellipse(b.x, b.y, b.r * 0.7, b.r * 0.5, 0, 0, TAU);
    g.fill();
    // Licking flames.
    g.fillStyle = '#ff8a2a';
    const n = Math.max(3, Math.round(b.r / 7));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + b.x;
      const fx = b.x + Math.cos(a) * b.r * 0.55;
      const fy = b.y + Math.sin(a) * b.r * 0.42;
      const hh = 5 + (Math.sin(time * 11 + i * 2.1 + b.x) * 0.5 + 0.5) * 6;
      g.globalAlpha = 0.85 * fade;
      g.beginPath();
      g.moveTo(fx - 3, fy);
      g.quadraticCurveTo(fx - 1, fy - hh * 0.6, fx + Math.sin(time * 9 + i) * 1.5, fy - hh);
      g.quadraticCurveTo(fx + 1, fy - hh * 0.5, fx + 3, fy);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawGroundOverlays(g: CanvasRenderingContext2D, s: RunState, view: ViewState, time: number): void {
    const terrain = s.terrain;
    const cols = terrain.cols;
    const sel = view.selectedUid ? s.towers.find((t) => t.uid === view.selectedUid) : undefined;

    // Faint outline on every buildable hex while placing.
    if (view.placing) {
      const { spawns, goal } = terrain;
      g.beginPath();
      for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (terrain.feature[i] !== FEATURE.none || s.occ[i]) continue;
          if (goal[0] === col && goal[1] === row) continue;
          let gate = false;
          for (const sp of spawns) if (sp[0] === col && sp[1] === row) gate = true;
          if (gate) continue;
          const c = tileCenter(col, row);
          hexSub(g, c.x, c.y - terrain.height[i] * LIFT, 0.86);
        }
      }
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 1;
      g.stroke();
    }

    // Hover: placement colour, or a hint that forest and rocks can be cleared.
    const hv = view.hoverTile;
    if (hv) {
      const i = hv.row * cols + hv.col;
      const c = tileCenter(hv.col, hv.row);
      const cy = c.y - terrain.height[i] * LIFT;
      if (view.placing) {
        g.beginPath();
        hexSub(g, c.x, cy, 0.97);
        g.fillStyle = view.placeOk ? 'rgba(80,220,90,0.38)' : 'rgba(230,60,50,0.38)';
        g.fill();
        g.strokeStyle = view.placeOk ? '#9dff9d' : '#ff8a80';
        g.lineWidth = 2;
        g.stroke();
      } else if (terrain.feature[i] !== FEATURE.none) {
        g.beginPath();
        hexSub(g, c.x, cy, 0.95);
        g.fillStyle = `rgba(255,226,140,${0.12 + 0.05 * Math.sin(time * 4)})`;
        g.fill();
        g.strokeStyle = 'rgba(255,226,140,0.7)';
        g.lineWidth = 1.4;
        g.stroke();
      }
    }

    // Selected tower: tile ring, range circle, buffed neighbours.
    if (sel) {
      const lift = sel.height * LIFT;
      if (AURA_BUFF(sel)) {
        g.fillStyle = 'rgba(255,214,90,0.28)';
        g.beginPath();
        for (const o of s.towers) {
          if (o === sel) continue;
          if (Math.hypot(o.x - sel.x, o.y - sel.y) <= sel.stats.range) hexSub(g, o.x, o.y - o.height * LIFT, 0.95);
        }
        g.fill();
      }
      this.rangeCircle(g, sel.x, sel.y, sel.stats.range, '#ffffff', 0.9);
      g.beginPath();
      hexSub(g, sel.x, sel.y - lift, 0.98);
      g.strokeStyle = '#ffe680';
      g.lineWidth = 2.2;
      g.stroke();
    }
  }

  private rangeCircle(g: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, a: number): void {
    g.globalAlpha = 0.07 * a;
    g.fillStyle = colour;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.globalAlpha = 0.85 * a;
    g.strokeStyle = colour;
    g.lineWidth = 1.6;
    g.setLineDash(DASH);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.stroke();
    g.setLineDash(NO_DASH);
    g.globalAlpha = 1;
  }

  private drawTowerAt(g: CanvasRenderingContext2D, t: Tower, s: RunState, time: number, tt: (Tower | null)[]): void {
    const lift = t.height * LIFT;
    const hh = t.hero ? 44 : towerHeight(t);
    g.setTransform(this.ka, 0, 0, this.ka, this.tx + t.x * this.ka, this.ty + (t.y - lift) * this.ka);
    // Contact shadow.
    g.globalAlpha = 0.28;
    g.fillStyle = '#10140a';
    g.beginPath();
    g.ellipse(0, 5, 18, 7, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 1;

    // Wall links toward adjacent wall tiles at the same height.
    const L = this.links;
    L.n = 0;
    if (t.type === 'palisade' && t.tier >= 2) {
      const nb = hexNeighbours(t.ty);
      for (let k = 0; k < 6; k++) {
        const nc = t.tx + nb[k][0];
        const nr = t.ty + nb[k][1];
        if (nc < 0 || nr < 0 || nc >= s.terrain.cols || nr >= s.terrain.rows) continue;
        const o = tt[nr * s.terrain.cols + nc];
        if (!o || o.type !== 'palisade' || o.tier < 2 || o.height !== t.height) continue;
        const q = tileCenter(nc, nr);
        L.d[L.n * 2] = q.x - t.x;
        L.d[L.n * 2 + 1] = q.y - t.y;
        L.n++;
      }
    }

    const silenced = t.silenceT > 0;
    if (silenced) setTint(2);
    else if (t.hurt < 0.15) setTint(3, '#ff3a2a');
    if (t.hero) {
      if (t.abilityCd === 0) {
        const p = 0.5 + 0.5 * Math.sin(time * 5);
        g.globalAlpha = 0.35 + 0.4 * p;
        g.strokeStyle = '#ffe680';
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(0, 3, 20 + p * 4, 9 + p * 2, 0, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      drawHero(g, t, time);
    } else drawTower(g, t, time, L);
    setTint(0);
    if (t.hero) drawHeroBadge(g, t.heroLevel);

    if (t.buffDamage > 0 || t.buffRate > 0) {
      poly(g, [15, 1, 19, -5, 23, 1], '#ffd24a', 0.9);
    }
    // Status: jinx swirl and silence dots.
    if (t.jinxT > 0) {
      const mid = -hh * 0.5;
      for (let i = 0; i < 6; i++) {
        const a = time * 4 + (i / 6) * TAU;
        const rr = 14 + Math.sin(a * 2) * 2;
        g.globalAlpha = 0.85;
        g.fillStyle = i % 2 ? '#c070ff' : '#7a3ab8';
        g.beginPath();
        g.arc(Math.cos(a) * rr, mid + Math.sin(a) * rr * 0.45 - i * 1.5, 2.2, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (silenced) {
      for (let i = 0; i < 3; i++) circ(g, -6 + i * 6, -hh - 14 + Math.sin(time * 5 + i) * 1.2, 2, '#e8e8f0', 0.8);
    }
    this.base(g);
  }

  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy, alpha: number, time: number): void {
    const def = e.def;
    const x = lerp(e.px, e.x, alpha) + e.ox;
    const y = lerp(e.py, e.y, alpha) + e.oy;
    const dx = e.x - e.px;
    const fi = e.uid & 4095;
    if (dx > 0.02) this.facing[fi] = 1;
    else if (dx < -0.02) this.facing[fi] = -1;
    const face = this.facing[fi];
    const flying = def.flying;
    const hidden = def.stealth && !e.revealed;
    const hgt = ENEMY_H[def.id];
    const ka = this.ka;
    // Ground shadow.
    const sr = def.radius;
    g.setTransform(ka, 0, 0, ka, this.tx + x * ka, this.ty + y * ka);
    if (!hidden) {
      g.globalAlpha = flying ? 0.22 : 0.26;
      g.fillStyle = '#10140a';
      g.beginPath();
      g.ellipse(0, 1, sr * (flying ? 0.7 : 1.05), sr * 0.4, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    const lift = flying ? 20 + Math.sin(time * 3 + e.uid) * 2.5 : 0;
    g.setTransform(ka * face, 0, 0, ka, this.tx + x * ka, this.ty + (y - lift) * ka);
    if (e.smashing) {
      g.translate(Math.sin(time * 14) * 1.5, 0);
      g.rotate(Math.sin(time * 14) * 0.08);
    }
    if (e.flash > 0) setTint(1, '#ffffff');
    drawEnemySprite(g, e, time);
    setTint(0);
    g.globalAlpha = 1;
    if (hidden) { this.base(g); return; }

    // Status overlays, in the unflipped frame.
    g.setTransform(ka, 0, 0, ka, this.tx + x * ka, this.ty + (y - lift) * ka);
    const mid = -hgt * 0.5;
    if (e.slowT > 0) {
      g.globalAlpha = 0.32;
      g.fillStyle = '#5ac0ff';
      g.beginPath();
      g.ellipse(0, mid, sr * 0.95, hgt * 0.52, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 0.9;
      g.fillStyle = '#d8f4ff';
      for (const sx of [-1, 0, 1]) poly(g, [sx * sr * 0.6 - 2, 1, sx * sr * 0.6, -5, sx * sr * 0.6 + 2, 1], '#bfeaff', 0.6);
      g.globalAlpha = 1;
    }
    if (e.burnT > 0) {
      for (let i = 0; i < 3; i++) {
        const fx = (i - 1) * sr * 0.6;
        const fl = 5 + (Math.sin(time * 18 + i * 2 + e.uid) * 0.5 + 0.5) * 6;
        g.fillStyle = i === 1 ? '#ffd24a' : '#ff7a2a';
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(fx - 3, mid - 2);
        g.quadraticCurveTo(fx - 2, mid - fl, fx, mid - fl - 4);
        g.quadraticCurveTo(fx + 2, mid - fl, fx + 3, mid - 2);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 0.2 + 0.1 * Math.sin(time * 25 + e.uid);
      g.fillStyle = '#ff7a2a';
      g.beginPath();
      g.ellipse(0, mid, sr * 0.9, hgt * 0.5, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    if (e.shield > 0) {
      g.globalAlpha = 0.14;
      g.fillStyle = '#bff4ff';
      g.beginPath();
      g.ellipse(0, mid, sr * 1.15, hgt * 0.58, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 0.9;
      g.strokeStyle = '#c8f6ff';
      g.lineWidth = 1.6;
      g.stroke();
      g.globalAlpha = 1;
    }
    if (e.stunT > 0) {
      for (let i = 0; i < 3; i++) {
        const a = time * 6 + (i / 3) * TAU;
        const sx = Math.cos(a) * (sr * 0.7 + 3);
        const sy = -hgt - 4 + Math.sin(a) * 2.2;
        poly(g, [sx, sy - 3, sx + 1, sy - 1, sx + 3, sy, sx + 1, sy + 1, sx, sy + 3, sx - 1, sy + 1, sx - 3, sy, sx - 1, sy - 1], '#ffe040', 0.6);
      }
    }
    this.base(g);
  }

  private drawBars(g: CanvasRenderingContext2D, s: RunState, alpha: number): void {
    const E = s.enemies;
    for (let i = 0; i < E.count; i++) {
      const e = E.items[i];
      if (e.dead || e.hp >= e.maxHp || e.hp <= 0) continue;
      if (e.def.stealth && !e.revealed) continue;
      const boss = e.def.boss;
      const x = lerp(e.px, e.x, alpha) + e.ox;
      const lift = e.def.flying ? 22 : 0;
      const y = lerp(e.py, e.y, alpha) + e.oy - lift - ENEMY_H[e.def.id] - (boss ? 8 : 5);
      const w = boss ? 64 : Math.max(16, e.def.radius * 2);
      const hgt = boss ? 6 : 3.2;
      const f = clamp01(e.hp / e.maxHp);
      g.fillStyle = 'rgba(20,12,8,0.85)';
      g.fillRect(x - w / 2 - 1, y - 1, w + 2, hgt + 2);
      g.fillStyle = '#7a1a14';
      g.fillRect(x - w / 2, y, w, hgt);
      g.fillStyle = f > 0.5 ? '#5ad04a' : f > 0.25 ? '#e0c030' : '#e04a30';
      g.fillRect(x - w / 2, y, w * f, hgt);
      if (e.shield > 0) {
        g.fillStyle = '#bff4ff';
        g.fillRect(x - w / 2, y - 2.2, w * clamp01(e.shield / Math.max(1, e.maxHp)) , 1.6);
      }
    }
    for (const t of s.towers) {
      if (t.hp >= t.maxHp) continue;
      const x = t.x;
      const y = t.y - t.height * LIFT - (t.hero ? 52 : towerHeight(t) + 10);
      const w = 26;
      const f = clamp01(t.hp / t.maxHp);
      g.fillStyle = 'rgba(20,12,8,0.85)';
      g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5.4);
      g.fillStyle = '#b8261c';
      g.fillRect(x - w / 2, y, w, 3.4);
      g.fillStyle = '#4ad04a';
      g.fillRect(x - w / 2, y, w * f, 3.4);
    }
  }

  private drawBeam(g: CanvasRenderingContext2D, t: Tower): void {
    const x1 = t.x;
    const y1 = t.y - t.height * LIFT - towerHeight(t) - 6;
    const ramp = Math.max(1, t.beamRamp);
    for (let pass = 0; pass < 3; pass++) {
      g.globalAlpha = pass === 0 ? 0.25 : pass === 1 ? 0.55 : 1;
      g.strokeStyle = pass === 2 ? '#ffffff' : pass === 1 ? '#d8a8ff' : '#a060ff';
      g.lineWidth = (pass === 0 ? 7 : pass === 1 ? 3.6 : 1.4) * (0.7 + ramp * 0.3);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(t.beamX, t.beamY - 6);
      g.stroke();
    }
    g.globalAlpha = 1;
    glow(g, t.beamX, t.beamY - 6, 6 + ramp * 3, '#d8a8ff', 0.6);
  }

  private drawProjectile(g: CanvasRenderingContext2D, q: { kind: string; x: number; y: number; px: number; py: number; t: number; life: number; owner: Tower | null }, alpha: number, time: number): void {
    const x = lerp(q.px, q.x, alpha);
    const y = lerp(q.py, q.y, alpha);
    const k = clamp01(q.t / Math.max(0.001, q.life));
    if (q.kind === 'lob') {
      const arc = PROJECTILE.lobArc * Math.sin(Math.PI * k);
      const fire = !!q.owner && q.owner.stats.poolDps > 0;
      g.globalAlpha = 0.3;
      g.fillStyle = '#10140a';
      g.beginPath();
      g.ellipse(x, y, 5, 2.4, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      const sy = y - arc;
      if (fire) {
        glow(g, x, sy, 9, '#ff7a2a', 0.5);
        const dx = x - q.px;
        const dy = y - q.py;
        poly(g, [x - dx * 3 - 3, sy - dy * 3 + 2, x - dx * 6, sy - dy * 6 - 5 + Math.sin(time * 20) * 2, x - dx * 3 + 3, sy - dy * 3 - 2], '#ff9a2a', 0.5);
      }
      circ(g, x, sy, 4.2, fire ? '#4a3a34' : '#8d8f94', 1.1);
      circ(g, x - 1.2, sy - 1.2, 1.4, fire ? '#ff7a2a' : '#c8cad0', 0);
      return;
    }
    // Arrow bolt: from the tower top down to the target's body.
    let ang = Math.atan2(q.y - q.py, q.x - q.px);
    if (q.x === q.px && q.y === q.py) ang = 0;
    const oh = q.owner ? q.owner.height * LIFT + 22 : 12;
    const yy = y - 8 - (1 - k) * Math.max(0, oh - 8) * 0.5;
    const c = Math.cos(ang) * this.ka;
    const sn = Math.sin(ang) * this.ka;
    g.setTransform(c, sn, -sn, c, this.tx + x * this.ka, this.ty + yy * this.ka);
    g.strokeStyle = '#2b2218';
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-8, 0);
    g.lineTo(3, 0);
    g.stroke();
    g.strokeStyle = '#d8c8a0';
    g.lineWidth = 1.2;
    g.stroke();
    poly(g, [3, -2, 7, 0, 3, 2], '#c8ccd4', 0.7);
    poly(g, [-8, 0, -11, -2.4, -9, 0, -11, 2.4], '#c8302a', 0.5);
    this.base(g);
  }

  private drawPet(g: CanvasRenderingContext2D, p: Pet, alpha: number, time: number): void {
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    const o = p.owner;
    const fire = !!o && o.stats.burnDps > 0;
    const eagle = !!o && o.type === 'aviary' && o.fork === 'b';
    const dx = p.x - p.px;
    const face = dx < -0.05 ? -1 : 1;
    const sc = eagle ? 1.5 : 1;
    const body = fire ? '#e8602a' : eagle ? '#d9a82b' : '#9a7048';
    const wing = fire ? '#ff9a3a' : eagle ? '#f0c850' : '#c09868';
    const lift = 14 + Math.sin(time * 5 + p.phase) * 2;
    g.globalAlpha = 0.2;
    g.fillStyle = '#10140a';
    g.beginPath();
    g.ellipse(x, y, 4 * sc, 1.8 * sc, 0, 0, TAU);
    g.fill();
    g.globalAlpha = p.temp && p.life < 1 ? Math.max(0.3, p.life) : 1;
    g.setTransform(this.ka * face * sc, 0, 0, this.ka * sc, this.tx + x * this.ka, this.ty + (y - lift) * this.ka);
    const flap = Math.sin(time * 22 + p.phase * 3);
    if (fire) glow(g, 0, 0, 7, '#ff7a2a', 0.35);
    // Far wing, body, near wing, head.
    poly(g, [-1, -1, -4, -6 - flap * 4, 2, -2], wing, 0.8);
    poly(g, [-5, 1, -1, -2.4, 4, -1, 6, 1, 2, 3, -3, 3], body, 1);
    poly(g, [-1, 0, -5, 5 + flap * 4, 3, 1], wing, 0.8);
    circ(g, 5, -1.4, 2.1, body, 0.9);
    poly(g, [6.8, -1.6, 9.6, -0.8, 6.8, -0.2], '#f0c030', 0.6);
    poly(g, [-5, 1, -9, 0, -9, 3.4, -5, 2.6], wing, 0.7);
    this.base(g);
    g.globalAlpha = 1;
  }

  private drawGhost(g: CanvasRenderingContext2D, s: RunState, view: ViewState, time: number): void {
    const hv = view.hoverTile;
    if (!hv || !view.placing) return;
    const terrain = s.terrain;
    const i = hv.row * terrain.cols + hv.col;
    const h = terrain.height[i];
    const c = tileCenter(hv.col, hv.row);
    const type = view.placing;
    const hero = isHeroType(type);
    const baseRange = hero ? HEROES[type].base.range ?? 0 : TOWERS[type].base.range ?? 0;
    const range = baseRange * (1 + (HEIGHT.rangePerLevel + s.mods.heightRangeBonus) * h) * s.mods.rangeMul;
    this.base(g);
    this.rangeCircle(g, c.x, c.y, range, view.placeOk ? '#9dff9d' : '#ff8a80', 1);
    const gh = this.ghost;
    gh.type = type; gh.hero = hero; gh.height = h; gh.x = c.x; gh.y = c.y; gh.tier = 1; gh.fork = 0; gh.forkTier = 0;
    gh.heroLevel = s.mods.heroStartLevel; gh.abilityCd = 1; gh.fired = 1; gh.hurt = 9;
    g.setTransform(this.ka, 0, 0, this.ka, this.tx + c.x * this.ka, this.ty + (c.y - h * LIFT) * this.ka);
    g.globalAlpha = 0.68;
    this.links.n = 0;
    if (hero) drawHero(g, gh, time);
    else drawTower(g, gh, time, this.links);
    g.globalAlpha = 1;
    this.base(g);
  }

  private drawDebug(g: CanvasRenderingContext2D, s: RunState, view: ViewState): void {
    const terrain = s.terrain;
    // Flow field on the road.
    this.base(g);
    g.font = '9px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(40,10,0,0.85)';
    for (let row = 0; row < terrain.rows; row++) {
      for (let col = 0; col < terrain.cols; col++) {
        const i = row * terrain.cols + col;
        const v = s.flow[i];
        if (!Number.isFinite(v) || v > 9999) continue;
        const c = tileCenter(col, row);
        g.fillText(String(Math.round(v)), c.x, c.y + 10);
      }
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const lines = [
      `fps ${view.fps.toFixed(0)}  speed x${view.speed}`,
      `enemies ${s.enemies.count}  projectiles ${s.projectiles.count}  pets ${s.pets.count}  towers ${s.towers.length}`,
      `wave ${s.wave}  t ${s.t.toFixed(1)}  fx ${this.fxCount}`,
    ];
    g.font = '12px monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const y0 = this.ins.top + 6;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(6, y0 - 2, 420, lines.length * 15 + 4);
    g.fillStyle = '#e8ffe0';
    lines.forEach((l, k) => g.fillText(l, 10, y0 + k * 15));
  }
}
