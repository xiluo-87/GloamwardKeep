import {
  EnemyDef, ENEMIES, EnemyId, HeroId, MapId, PERKS, PerkId, RUN, Stats, STAT_KEYS, TowerId,
} from '../data/balance';
import { generateMap, Terrain } from './mapgen';
import { buildAirFlow, rebuildFlow } from './path';
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
  x: number; y: number; px: number; py: number;
  /** Velocity this step, for leading shots. */
  vx: number; vy: number;
  /** Render-only offset so crowds don't stack on the tile centres. */
  ox: number; oy: number;
  /** Tile index the enemy is walking toward (ground only), and the flow version it was chosen with. */
  next: number; flowVersion: number;
  /** Remaining distance to the keep in hexes, for "first"/"last" targeting. */
  dist: number;
  hp: number; maxHp: number; shield: number; speed: number;
  slow: number; slowT: number; stunT: number; burnDps: number; burnT: number; shred: number;
  flash: number; dead: boolean;
  /** Seen by a detecting tower this step (only matters for stealthy enemies). */
  revealed: boolean;
  /** uid of the tower it is smashing, or 0. */
  smashing: number;
  /** Timers for specials (shaman shield, lich silence and summons). */
  cdA: number; cdB: number;
  /** Ogre King: next HP fraction at which it sheds goblins. */
  nextShed: number;
}

export type TargetMode = 'first' | 'last' | 'strong' | 'close';
export const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'close'];

export interface Tower {
  uid: number;
  type: TowerId | HeroId;
  hero: boolean;
  /** Tile column and row, and the terrain height there (0..4). */
  tx: number; ty: number; height: number;
  x: number; y: number;
  /** Base towers: linear tier 1..3. Heroes: always 1. */
  tier: number;
  /** 0 before the fork, then 'a' or 'b'. */
  fork: 0 | 'a' | 'b';
  /** 0..2 tiers bought along the fork. */
  forkTier: number;
  heroLevel: number; heroXp: number;
  /** Learned skill nodes, encoded branch * 4 + node. */
  skills: number[];
  stats: Stats;
  hp: number; maxHp: number;
  cd: number; abilityCd: number;
  target: TargetMode; angle: number;
  /** Gold spent on this tower, for selling and for its hit points. */
  invested: number;
  /** Gold spent on it since the current wave started: refunded in full when sold before the next wave. */
  fresh: number;
  kills: number; dealt: number;
  /** Seconds left of a Hexer's jinx (slower attacks) and the Lich's silence (no attacks). */
  jinxT: number; silenceT: number;
  /** Buffs from auras this step, as fractions. */
  buffDamage: number; buffRate: number;
  /** Arcane Beam state. */
  beamUid: number; beamRamp: number; beamX: number; beamY: number;
  /** Seconds since the last attack, for render recoil. */
  fired: number;
  /** Seconds since it was last hit by an enemy, for render. */
  hurt: number;
}

export interface Projectile {
  kind: 'bolt' | 'lob';
  x: number; y: number; px: number; py: number;
  sx: number; sy: number; tx: number; ty: number;
  t: number; life: number;
  target: Enemy | null; targetUid: number;
  owner: Tower | null; damage: number;
}

/** Hawks from aviaries and the Druid. */
export interface Pet {
  owner: Tower | null;
  x: number; y: number; px: number; py: number;
  target: Enemy | null; targetUid: number;
  cd: number; phase: number;
  /** Seconds left for temporary Wild Hunt hawks. */
  life: number; temp: boolean;
}

export interface BurnPool { x: number; y: number; r: number; t: number; life: number; dps: number; owner: Tower | null }

export type GameEventType =
  | 'shot' | 'hit' | 'kill' | 'leak' | 'splash' | 'cluster' | 'pulse' | 'chain' | 'cleave' | 'bite'
  | 'build' | 'upgrade' | 'sell' | 'skill' | 'wave' | 'waveClear' | 'heroLevel' | 'ability'
  | 'shield' | 'silence' | 'jinx' | 'boss' | 'win' | 'lose' | 'gold' | 'shed' | 'smash' | 'destroyed' | 'clear' | 'keep';
/**
 * Fields by type:
 * shot: x,y from, a angle, b tower uid · hit: x,y · kill: x,y, a gold, b radius, c 1 if boss
 * leak: x,y, a lives lost, b index in ENEMY_IDS · splash/pulse/cluster: x,y, a radius
 * chain: x,y → a,b · cleave: x,y, a angle, b range · bite: x,y · gold: a amount
 * wave: a wave number · waveClear: a wave, b gold · heroLevel: x,y, a level
 * ability: x,y, a radius, b ability index · shield: x,y, a radius · silence: x,y, a radius · jinx: x,y (tower)
 * smash: x,y of the tower being hit (throttled) · destroyed: x,y, a 1 if hero · build: x,y, a 1 if hero
 * clear: x,y of the cleared tile, a FEATURE that was removed, b gold spent · keep: x,y of the keep, a new keep level
 */
export interface GameEvent { type: GameEventType; x: number; y: number; a: number; b: number; c: number }
export const EVENT_CAP = 512;

export interface RunConfig {
  /** Seed for gameplay randomness. */
  seed: number;
  map: MapId;
  /** Seed for the map generator. */
  mapSeed: number;
  heroes: HeroId[];
  perks: PerkId[];
}

/** Perk effects folded into plain multipliers. */
export interface Mods {
  startGold: number; lives: number; costMul: number; sellRefund: number; rangeMul: number; heightRangeBonus: number;
  heroStartLevel: number; goldMul: number; earlyMul: number; damageMul: number; heroXpMul: number;
  interest: number; interestCap: number;
}

export function perkMods(perks: PerkId[]): Mods {
  const m: Mods = {
    startGold: RUN.startGold, lives: RUN.lives, costMul: 1, sellRefund: RUN.sellRefund, rangeMul: 1, heightRangeBonus: 0,
    heroStartLevel: 1, goldMul: 1, earlyMul: 1, damageMul: 1, heroXpMul: 1, interest: 0, interestCap: 0,
  };
  for (const id of perks) {
    const p = PERKS[id];
    if (!p) continue;
    m.startGold += p.startGold ?? 0;
    m.lives += p.lives ?? 0;
    m.costMul *= p.costMul ?? 1;
    m.sellRefund = Math.max(m.sellRefund, p.sellRefund ?? 0);
    m.rangeMul *= p.rangeMul ?? 1;
    m.heightRangeBonus += p.heightRangeBonus ?? 0;
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

export interface SpawnEntry { t: number; kind: EnemyId; gate: number }

export interface RunState {
  cfg: RunConfig; mods: Mods; rng: Rng; t: number;
  gold: number; lives: number;
  /** Keep level this run (1..KEEP.max): unlocks tower types and deeper upgrades. */
  keep: number;
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
  terrain: Terrain;
  /** Bumped whenever the terrain changes during a run (cleared forest or rocks), so renderers can redraw it. */
  terrainVersion: number;
  /** Tower uid standing on each tile, or 0. */
  occ: Int32Array;
  /** Walking cost from each tile to the keep (Infinity off the road). Rebuilt when level-0 towers change. */
  flow: Float32Array;
  flowVersion: number;
  /** Flyers' field: the same road with towers ignored, so flyers follow the road but pass over walls. */
  airFlow: Float32Array;
  towers: Tower[];
  enemies: Pool<Enemy>; projectiles: Pool<Projectile>; pets: Pool<Pet>; pools: Pool<BurnPool>;
  nextUid: number;
  /** Ranger's Rally: seconds left and attack-speed bonus. */
  rallyT: number; rallyPower: number;
  kills: number; leaked: number; goldEarned: number;
  /** Waves fully cleared so far. Profile XP is paid per cleared wave. */
  cleared: number;
  events: GameEvent[]; eventCount: number;
  /** Heroes standing on the board right now. A destroyed or sold hero can be placed again. */
  heroesPlaced: HeroId[];
}

export function createEnemy(): Enemy {
  return {
    uid: 0, def: ENEMIES.goblin, wave: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, ox: 0, oy: 0,
    next: -1, flowVersion: -1, dist: 0,
    hp: 0, maxHp: 0, shield: 0, speed: 0, slow: 0, slowT: 0, stunT: 0, burnDps: 0, burnT: 0, shred: 0,
    flash: 0, dead: false, revealed: false, smashing: 0, cdA: 0, cdB: 0, nextShed: 1,
  };
}

export function createRun(cfg: RunConfig): RunState {
  const mods = perkMods(cfg.perks);
  const terrain = generateMap(cfg.map, cfg.mapSeed);
  const n = terrain.cols * terrain.rows;
  const s: RunState = {
    cfg, mods, rng: new Rng(cfg.seed), t: 0,
    gold: mods.startGold, lives: mods.lives, keep: 1,
    wave: 0, waiting: true, nextIn: 0, spawns: [], spawnIdx: 0, waveT: 0, waveLeft: [0],
    outcome: null,
    terrain, terrainVersion: 0, occ: new Int32Array(n), flow: new Float32Array(n), flowVersion: 0, airFlow: new Float32Array(n),
    towers: [],
    enemies: new Pool(RUN.enemyCap, createEnemy),
    projectiles: new Pool(RUN.projectileCap, (): Projectile => ({
      kind: 'bolt', x: 0, y: 0, px: 0, py: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, life: 0, target: null, targetUid: 0, owner: null, damage: 0,
    })),
    pets: new Pool(RUN.petCap, (): Pet => ({
      owner: null, x: 0, y: 0, px: 0, py: 0, target: null, targetUid: 0, cd: 0, phase: 0, life: 0, temp: false,
    })),
    pools: new Pool(RUN.poolCap, (): BurnPool => ({ x: 0, y: 0, r: 0, t: 0, life: 0, dps: 0, owner: null })),
    nextUid: 1, rallyT: 0, rallyPower: 0,
    kills: 0, leaked: 0, goldEarned: 0, cleared: 0,
    events: [], eventCount: 0, heroesPlaced: [],
  };
  for (let i = 0; i < EVENT_CAP; i++) s.events.push({ type: 'hit', x: 0, y: 0, a: 0, b: 0, c: 0 });
  rebuildFlow(s);
  buildAirFlow(s);
  return s;
}

export function emit(s: RunState, type: GameEventType, x = 0, y = 0, a = 0, b = 0, c = 0): void {
  if (s.eventCount >= EVENT_CAP) return;
  const e = s.events[s.eventCount++];
  e.type = type; e.x = x; e.y = y; e.a = a; e.b = b; e.c = c;
}

export const tileIndex = (s: RunState, col: number, row: number): number => row * s.terrain.cols + col;
export const inBoard = (s: RunState, col: number, row: number): boolean =>
  col >= 0 && row >= 0 && col < s.terrain.cols && row < s.terrain.rows;
export const towerAt = (s: RunState, col: number, row: number): Tower | undefined => {
  if (!inBoard(s, col, row)) return undefined;
  const uid = s.occ[tileIndex(s, col, row)];
  return uid ? s.towers.find((t) => t.uid === uid) : undefined;
};
