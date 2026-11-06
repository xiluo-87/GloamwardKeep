import { FLAME, PLAYER, emberNeed } from '../data/balance';
import { CharacterId, CHARACTERS, EnemyDef, ENEMIES, EnemyId, PassiveId, ShopId, WeaponId } from '../data/content';
import { Grid } from './grid';
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

export interface Enemy {
  uid: number; def: EnemyDef; x: number; y: number; px: number; py: number; kbx: number; kby: number;
  hp: number; maxHp: number; speed: number; damage: number; embers: number; r: number;
  elite: boolean; boss: boolean; hitCd: number; mothUntil: number; flash: number;
  inLight: boolean; inPost: boolean; noDrops: boolean;
}

export type ProjectileKind = 'cinder' | 'shard' | 'bolt' | 'stained';
export interface Projectile {
  kind: ProjectileKind; x: number; y: number; px: number; py: number; vx: number; vy: number;
  sx: number; sy: number; tx: number; ty: number; t: number; life: number; damage: number;
  bounces: number; target: Enemy | null; targetUid: number; lastUid: number; pool: number; hue: number;
}

export interface BurnPool { x: number; y: number; r: number; t: number; life: number; dps: number; tick: number }
export interface Ring { x: number; y: number; prev: number; r: number; max: number; speed: number; damage: number; push: number; pull: boolean; age: number }
export interface Sentry { x: number; y: number; t: number; life: number; cd: number; toll: number; light: boolean; bell: boolean; px: number; py: number }
export type PickupKind = 'ember' | 'droplet' | 'flask';
export interface Pickup { kind: PickupKind; value: number; x: number; y: number; px: number; py: number; pulled: boolean; speed: number; age: number }
export interface Post { x: number; y: number; life: number; progress: number }
export interface Crate { x: number; y: number }
export interface Moth { x: number; y: number; px: number; py: number; diving: boolean; tx: number; ty: number; cd: number; trail: number; returning: boolean }
export interface OwnedWeapon { id: WeaponId; rank: number; cd: number }

export type GameEventType = 'hit' | 'kill' | 'pickup' | 'oil' | 'hurt' | 'level' | 'bell' | 'lash' | 'stainedlash' | 'post' | 'crate' | 'elite' | 'boss' | 'inversion' | 'dawn' | 'sweep' | 'gutter' | 'shard';
export interface GameEvent { type: GameEventType; x: number; y: number; a: number; b: number; c: number }

export type Flame = 'burning' | 'dimmed' | 'guttering';
export interface Input { mx: number; my: number; dim: boolean }

export interface Choice {
  kind: 'weapon' | 'passive' | 'combo' | 'hp' | 'oil';
  id: string; name: string; desc: string; rank: number; colour: string; glyph: string;
}

export interface RunConfig {
  seed: number;
  character: CharacterId;
  newMoon: boolean;
  shop: Partial<Record<ShopId, number>>;
  viewHalfW: number;
  viewHalfH: number;
  startAt?: number;
}

export interface BossState {
  phase: 1 | 2 | 3; waveCd: number; sweepCd: number; sweepT: number; sweepAngle: number; sweepFlash: number;
  stutter: number; dimFlicker: number;
}

export const EVENT_CAP = 256;

export function createEnemy(): Enemy {
  return { uid: 0, def: ENEMIES.mite, x: 0, y: 0, px: 0, py: 0, kbx: 0, kby: 0, hp: 0, maxHp: 0, speed: 0, damage: 0, embers: 0, r: 8, elite: false, boss: false, hitCd: 0, mothUntil: 0, flash: 0, inLight: false, inPost: false, noDrops: false };
}

export interface RunState {
  cfg: RunConfig; rng: Rng; t: number; over: boolean; outcome: 'death' | 'dawn' | null;
  player: {
    x: number; y: number; px: number; py: number; hp: number; maxHp: number; oil: number; maxOil: number;
    speed: number; pickupRange: number; facing: number; armor: number; regen: number; burnMul: number;
    level: number; embers: number; emberMul: number; hurt: number; grace: number; moving: boolean;
  };
  flame: Flame; radius: number; lightBonus: number; lightCap: number; gutterSeen: boolean;
  weapons: OwnedWeapon[]; passives: { id: PassiveId; rank: number }[];
  enemies: Pool<Enemy>; projectiles: Pool<Projectile>; pickups: Pool<Pickup>;
  pools: Pool<BurnPool>; rings: Pool<Ring>; sentries: Pool<Sentry>; crates: Pool<Crate>;
  moths: Moth[]; posts: Map<number, Post>; litPosts: Post[]; litSentries: Sentry[]; activePost: Post | null;
  grid: Grid; nextUid: number; budget: number; nextKind: EnemyId | null; crateCd: number; eliteNext: number; ringNext: number;
  bossEnemy: Enemy | null; boss: BossState | null; bossDead: boolean; dawnT: number;
  pendingLevels: number; choices: Choice[] | null; rerolls: number;
  kills: number; events: GameEvent[]; eventCount: number; hitBudget: number;
  stats: { oilMin: number; oilSum: number; oilSamples: number; gutterTime: number; damageDealt: number; peakEnemies: number };
  characterMoths: number; postCostMul: number; sextonPull: boolean; dmgMul: number;
}

export function createRun(cfg: RunConfig): RunState {
  const shop = cfg.shop;
  const char = CHARACTERS.find((c) => c.id === cfg.character) ?? CHARACTERS[0];
  const moth = cfg.character === 'mothchild';
  const lightBonus = (shop.glass ?? 0) * 10 + (moth ? -40 : 0);
  const maxHp = PLAYER.hp + (shop.frame ?? 0) * 10;
  const start = cfg.startAt ?? 0;
  const s: RunState = {
    cfg, rng: new Rng(cfg.seed), t: start, over: false, outcome: null,
    player: {
      x: 0, y: 0, px: 0, py: 0, hp: maxHp, maxHp, oil: Math.min(PLAYER.maxOil, PLAYER.startOil + (shop.flask ?? 0) * 5),
      maxOil: PLAYER.maxOil, speed: PLAYER.speed * (moth ? 1.15 : 1), pickupRange: PLAYER.pickupRange, facing: 0,
      armor: 0, regen: 0, burnMul: 1, level: 1, embers: 0, emberMul: 1 + (shop.memory ?? 0) * 0.04, hurt: 0, grace: 0, moving: false,
    },
    flame: 'burning', radius: FLAME.burning.radius + lightBonus, lightBonus,
    lightCap: cfg.newMoon ? 120 : Infinity, gutterSeen: false,
    weapons: [{ id: char.weapon, rank: 1, cd: 0.4 }], passives: [],
    enemies: new Pool(1000, createEnemy),
    projectiles: new Pool(500, (): Projectile => ({ kind: 'bolt', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, life: 0, damage: 0, bounces: 0, target: null, targetUid: 0, lastUid: 0, pool: 0, hue: 0 })),
    pickups: new Pool(1000, (): Pickup => ({ kind: 'ember', value: 1, x: 0, y: 0, px: 0, py: 0, pulled: false, speed: 0, age: 0 })),
    pools: new Pool(160, (): BurnPool => ({ x: 0, y: 0, r: 0, t: 0, life: 0, dps: 0, tick: 0 })),
    rings: new Pool(32, (): Ring => ({ x: 0, y: 0, prev: 0, r: 0, max: 0, speed: 0, damage: 0, push: 0, pull: false, age: 0 })),
    sentries: new Pool(8, (): Sentry => ({ x: 0, y: 0, t: 0, life: 0, cd: 0, toll: 0, light: false, bell: false, px: 0, py: 0 })),
    crates: new Pool(8, (): Crate => ({ x: 0, y: 0 })),
    moths: [], posts: new Map(), litPosts: [], litSentries: [], activePost: null,
    grid: new Grid(1000), nextUid: 1, budget: 0, nextKind: null, crateCd: 90, eliteNext: 0, ringNext: 0,
    bossEnemy: null, boss: null, bossDead: false, dawnT: 0,
    pendingLevels: 0, choices: null, rerolls: 1 + (shop.thought ?? 0),
    kills: 0, events: [], eventCount: 0, hitBudget: 0,
    stats: { oilMin: 100, oilSum: 0, oilSamples: 0, gutterTime: 0, damageDealt: 0, peakEnemies: 0 },
    characterMoths: moth ? 2 : 0, postCostMul: cfg.character === 'lamplighter' ? 0.5 : 1,
    sextonPull: cfg.character === 'sexton', dmgMul: 1,
  };
  for (let i = 0; i < EVENT_CAP; i++) s.events.push({ type: 'hit', x: 0, y: 0, a: 0, b: 0, c: 0 });
  return s;
}

export function emit(s: RunState, type: GameEventType, x = 0, y = 0, a = 0, b = 0, c = 0): void {
  if (s.eventCount >= EVENT_CAP) return;
  const e = s.events[s.eventCount++];
  e.type = type; e.x = x; e.y = y; e.a = a; e.b = b; e.c = c;
}

export const passiveRank = (s: RunState, id: PassiveId): number => s.passives.find((p) => p.id === id)?.rank ?? 0;
export const weaponOf = (s: RunState, id: WeaponId): OwnedWeapon | undefined => s.weapons.find((w) => w.id === id);
export const emberTarget = (s: RunState): number => emberNeed(s.player.level);
