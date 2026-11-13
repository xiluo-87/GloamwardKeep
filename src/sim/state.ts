import {
  EnemyDef, ENEMIES, HeroId, MapId, PERKS, PerkId, RUN, Stats, STAT_KEYS, TowerId, WORLD,
} from '../data/balance';
import { MAPS } from '../data/maps';
import { Rng } from './rng';

export class Pool<T> {
  items: T[] = [];
  count = 0;
  constructor(public readonly cap: number, make: () => T) {
    for (let i = 0; i < cap; i++) this.items.push(make());
  }
  /** Returns a recycled object, or null when the pool is full. */
  add(): T | null {
    return this.count < this.cap ? this.items[this.count++] : null;
  }
  /** Swap-remove. Iterate backwards when removing during a loop. */
  removeAt(i: number): void {
    const last = --this.count;
    const t = this.items[i];
    this.items[i] = this.items[last];
    this.items[last] = t;
  }
}

export const emptyStats = (): Stats => {
  const s = {} as Stats;
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
};

// ---------------------------------------------------------------------------------------------

export interface Enemy {
  uid: number; def: EnemyDef; wave: number;
  path: number; dist: number; lane: number;
  x: number; y: number; px: number; py: number; angle: number;
  hp: number; maxHp: number; shield: number; speed: number;
  slow: number; slowT: number; stunT: number; burnDps: number; burnT: number; shred: number;
  flash: number; dead: boolean;
  /** Inside any tower's light this step. */
  lit: boolean;
  /** Inside a revealing light this step (only matters for stealthy enemies). */
  revealed: boolean;
  /** Ability timers for specials (weaver shield, boss snuff and spawns). */
  cdA: number; cdB: number;
  /** Tallow King: next HP fraction at which it sheds. */
  nextShed: number;
}

export type TargetMode = 'first' | 'last' | 'strong' | 'close';
export const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'close'];

export interface Tower {
  uid: number;
  type: TowerId | HeroId;
  hero: boolean;
  tx: number; ty: number; x: number; y: number;
  /** Base towers: linear tier 1..3. Heroes: always 1. */
  tier: number;
  /** 0 before the fork, then 'a' or 'b'. */
  fork: 0 | 'a' | 'b';
  /** 0..2 tiers bought along the fork. */
  forkTier: number;
  heroLevel: number; heroXp: number;
  /** Learned skill nodes as [branch, node] pairs encoded branch * 4 + node. */
  skills: number[];
  stats: Stats;
  cd: number; abilityCd: number;
  target: TargetMode; angle: number;
  /** Gold spent on this tower, for selling. */
  invested: number;
  kills: number; dealt: number;
  /** Seconds left of Snuffer dimming and Long Night snuffing. */
  dimT: number; snuffT: number;
  /** Light radius after dimming and perks, refreshed each step. */
  lightNow: number;
  /** Buffs from auras this step, as fractions. */
  buffDamage: number; buffRate: number;
  /** Burning Lens state. */
  beamUid: number; beamRamp: number; beamX: number; beamY: number;
  /** Seconds since the last attack, for render recoil. */
  fired: number;
}

export interface Projectile {
  kind: 'bolt' | 'lob';
  x: number; y: number; px: number; py: number;
  sx: number; sy: number; tx: number; ty: number;
  t: number; life: number;
  target: Enemy | null; targetUid: number;
  owner: Tower | null; damage: number;
}

export interface Moth {
  owner: Tower | null; ownerUid: number;
  x: number; y: number; px: number; py: number;
  target: Enemy | null; targetUid: number;
  cd: number; phase: number;
  /** Seconds left for temporary swarm moths; 0 means permanent. */
  life: number; temp: boolean;
}

export interface BurnPool { x: number; y: number; r: number; t: number; life: number; dps: number; owner: Tower | null }

export type GameEventType =
  | 'shot' | 'hit' | 'kill' | 'leak' | 'splash' | 'cluster' | 'pulse' | 'chain' | 'lash' | 'bite'
  | 'build' | 'upgrade' | 'sell' | 'skill' | 'wave' | 'waveClear' | 'heroLevel' | 'ability'
  | 'shield' | 'snuff' | 'dim' | 'boss' | 'win' | 'lose' | 'gold' | 'shed';
/**
 * Fields by type:
 * shot: x,y from, a angle, b tower uid · hit: x,y · kill: x,y, a gold, b radius · leak: a lives lost, b index in ENEMY_IDS
 * splash/pulse: x,y, a radius · cluster: x,y, a radius · chain: x,y → a,b · lash: x,y, a angle, b range
 * bite: x,y · gold: x,y, a amount · wave: a wave number · waveClear: a wave, b gold
 * heroLevel: x,y, a level · ability: x,y, a radius, b ability index · shield: x,y · snuff: x,y, a radius
 */
export interface GameEvent { type: GameEventType; x: number; y: number; a: number; b: number; c: number }
export const EVENT_CAP = 512;

export interface RunConfig {
  seed: number;
  map: MapId;
  heroes: HeroId[];
  perks: PerkId[];
  /** Debug: start at this wave with extra gold. */
  startWave?: number;
}

/** Perk effects folded into plain multipliers. */
export interface Mods {
  startGold: number; lives: number; costMul: number; sellRefund: number; lightMul: number; rangeMul: number;
  heroStartLevel: number; goldMul: number; earlyMul: number; damageMul: number; heroXpMul: number;
  interest: number; interestCap: number;
}

export function perkMods(perks: PerkId[]): Mods {
  const m: Mods = {
    startGold: RUN.startGold, lives: RUN.lives, costMul: 1, sellRefund: RUN.sellRefund, lightMul: 1, rangeMul: 1,
    heroStartLevel: 1, goldMul: 1, earlyMul: 1, damageMul: 1, heroXpMul: 1, interest: 0, interestCap: 0,
  };
  for (const id of perks) {
    const p = PERKS[id];
    if (!p) continue;
    m.startGold += p.startGold ?? 0;
    m.lives += p.lives ?? 0;
    m.costMul *= p.costMul ?? 1;
    m.sellRefund = Math.max(m.sellRefund, p.sellRefund ?? 0);
    m.lightMul *= p.lightMul ?? 1;
    m.rangeMul *= p.rangeMul ?? 1;
    m.heroStartLevel = Math.max(m.heroStartLevel, p.heroStartLevel ?? 1);
    m.goldMul *= p.goldMul ?? 1;
    m.earlyMul *= p.earlyMul ?? 1;
    m.damageMul *= p.damageMul ?? 1;
    m.heroXpMul *= p.heroXpMul ?? 1;
    m.interest += p.interest ?? 0;
    m.interestCap += p.interestCap ?? 0;
  }
  return m;
}

/** A path baked into points and cumulative lengths in world pixels. */
export interface BakedPath { xs: number[]; ys: number[]; cum: number[]; length: number }

export interface SpawnEntry { t: number; kind: EnemyDef['id']; path: number }

export interface RunState {
  cfg: RunConfig; mods: Mods; rng: Rng; t: number;
  gold: number; lives: number;
  /** Waves started so far. 0 before the first call. */
  wave: number;
  /** True until the player calls the first wave. */
  waiting: boolean;
  /** Seconds until the next wave starts on its own; only counts once the current wave has finished spawning. */
  nextIn: number;
  spawns: SpawnEntry[]; spawnIdx: number; waveT: number;
  /** Enemies alive (or still to spawn) per wave, so clears pay out exactly once. */
  waveLeft: number[];
  outcome: 'won' | 'lost' | null;
  paths: BakedPath[];
  /** Per tile: 0 free, 1 path, 2 scenery, 3 tower. */
  tiles: Uint8Array;
  towers: Tower[];
  enemies: Pool<Enemy>; projectiles: Pool<Projectile>; moths: Pool<Moth>; pools: Pool<BurnPool>;
  nextUid: number;
  /** Chandler's Vigil: seconds left and attack-speed bonus. */
  vigilT: number; vigilPower: number;
  kills: number; leaked: number; goldEarned: number;
  /** Waves fully cleared so far. Profile XP is paid per cleared wave. */
  cleared: number;
  events: GameEvent[]; eventCount: number;
  /** Heroes placed so far this run (a hero can't be placed twice, even after selling). */
  heroesPlaced: HeroId[];
}

export function createEnemy(): Enemy {
  return {
    uid: 0, def: ENEMIES.mite, wave: 0, path: 0, dist: 0, lane: 0, x: 0, y: 0, px: 0, py: 0, angle: 0,
    hp: 0, maxHp: 0, shield: 0, speed: 0, slow: 0, slowT: 0, stunT: 0, burnDps: 0, burnT: 0, shred: 0,
    flash: 0, dead: false, lit: false, revealed: false, cdA: 0, cdB: 0, nextShed: 1,
  };
}

export function bakePath(points: [number, number][]): BakedPath {
  const T = WORLD.tile;
  const xs = points.map((p) => (p[0] + 0.5) * T);
  const ys = points.map((p) => (p[1] + 0.5) * T);
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  return { xs, ys, cum, length: cum[cum.length - 1] };
}

/** Writes the point at `dist` along a path into out[0..2] as x, y, angle. */
export function pointAt(p: BakedPath, dist: number, out: Float64Array): void {
  const n = p.xs.length;
  if (dist <= 0) { out[0] = p.xs[0]; out[1] = p.ys[0]; out[2] = Math.atan2(p.ys[1] - p.ys[0], p.xs[1] - p.xs[0]); return; }
  let i = 1;
  while (i < n - 1 && p.cum[i] < dist) i++;
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const k = Math.min(1, (dist - p.cum[i - 1]) / seg);
  out[0] = p.xs[i - 1] + (p.xs[i] - p.xs[i - 1]) * k;
  out[1] = p.ys[i - 1] + (p.ys[i] - p.ys[i - 1]) * k;
  out[2] = Math.atan2(p.ys[i] - p.ys[i - 1], p.xs[i] - p.xs[i - 1]);
}

/** Marks every tile a path crosses, plus scenery, so towers can't be built there. */
export function buildTiles(mapId: MapId): Uint8Array {
  const { cols, rows } = WORLD;
  const tiles = new Uint8Array(cols * rows);
  const map = MAPS[mapId];
  const mark = (x: number, y: number, v: number): void => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) tiles[y * cols + x] = v;
  };
  for (const path of map.paths) {
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= steps; k++) {
        mark(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps), 1);
      }
    }
  }
  for (const [x, y] of map.blocked) if (tiles[y * cols + x] === 0) mark(x, y, 2);
  return tiles;
}

export function createRun(cfg: RunConfig): RunState {
  const mods = perkMods(cfg.perks);
  const s: RunState = {
    cfg, mods, rng: new Rng(cfg.seed), t: 0,
    gold: mods.startGold, lives: mods.lives,
    wave: 0, waiting: true, nextIn: 0, spawns: [], spawnIdx: 0, waveT: 0, waveLeft: [0],
    outcome: null,
    paths: MAPS[cfg.map].paths.map(bakePath),
    tiles: buildTiles(cfg.map),
    towers: [],
    enemies: new Pool(RUN.enemyCap, createEnemy),
    projectiles: new Pool(RUN.projectileCap, (): Projectile => ({
      kind: 'bolt', x: 0, y: 0, px: 0, py: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, life: 0, target: null, targetUid: 0, owner: null, damage: 0,
    })),
    moths: new Pool(RUN.mothCap, (): Moth => ({
      owner: null, ownerUid: 0, x: 0, y: 0, px: 0, py: 0, target: null, targetUid: 0, cd: 0, phase: 0, life: 0, temp: false,
    })),
    pools: new Pool(RUN.poolCap, (): BurnPool => ({ x: 0, y: 0, r: 0, t: 0, life: 0, dps: 0, owner: null })),
    nextUid: 1, vigilT: 0, vigilPower: 0,
    kills: 0, leaked: 0, goldEarned: 0, cleared: 0,
    events: [], eventCount: 0, heroesPlaced: [],
  };
  for (let i = 0; i < EVENT_CAP; i++) s.events.push({ type: 'hit', x: 0, y: 0, a: 0, b: 0, c: 0 });
  return s;
}

export function emit(s: RunState, type: GameEventType, x = 0, y = 0, a = 0, b = 0, c = 0): void {
  if (s.eventCount >= EVENT_CAP) return;
  const e = s.events[s.eventCount++];
  e.type = type; e.x = x; e.y = y; e.a = a; e.b = b; e.c = c;
}

export const tileAt = (s: RunState, tx: number, ty: number): number =>
  tx < 0 || ty < 0 || tx >= WORLD.cols || ty >= WORLD.rows ? 255 : s.tiles[ty * WORLD.cols + tx];

export const towerAt = (s: RunState, tx: number, ty: number): Tower | undefined =>
  s.towers.find((t) => t.tx === tx && t.ty === ty);
