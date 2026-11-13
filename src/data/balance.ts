// Every tunable number in Lampwatch lives in this file. Names and descriptions live in text.ts,
// map layouts in maps.ts. If you change a value on purpose, update docs/DESIGN.md too.

export const STEP = 1 / 60;

// ---------------------------------------------------------------------------------------------
// World and run
// ---------------------------------------------------------------------------------------------

/** Hex board: `hex` is the hex radius (centre to corner) in world pixels. */
export const WORLD = { hex: 28, cols: 24, rows: 14 };

export const RUN = {
  startGold: 300,
  lives: 20,
  waves: 30,
  /** Seconds between the end of one wave's spawning and the next wave starting on its own. */
  waveGap: 14,
  /** Gold per second left on the countdown when the player calls a wave early. */
  earlyBonusPerSec: 2,
  sellRefund: 0.7,
  heroSlots: 1,
  /** A second hero slot opens at this profile level. */
  secondHeroSlotLevel: 12,
  enemyCap: 600,
  projectileCap: 400,
  mothCap: 160,
  poolCap: 80,
};

/** Gold paid when a wave is cleared. */
export const waveBonus = (wave: number): number => 35 + 5 * wave;

/** Enemy HP multiplier for a wave, bosses excluded. */
export const waveHpScale = (wave: number): number => 1 + 0.08 * (wave - 1) + 0.005 * (wave - 1) ** 2;

export const PROJECTILE = {
  boltSpeed: 560,
  lobFlight: 0.75,
  lobArc: 70,
  clusterSpread: 46,
  clusterSplash: 30,
  clusterDamage: 0.45,
  mothBiteRange: 12,
  mothOrbit: 26,
};

/** Resistances above this are clamped so nothing is ever immune. */
export const RESIST_CAP = 0.8;
/** Armour shred stacks per enemy up to this total. */
export const SHRED_CAP = 0.5;
/** How long a Lens beam must stay on one target to reach full ramp is rampMax / ramp seconds. */
export const BEAM = { dpsPerDamage: 2.0 };

// ---------------------------------------------------------------------------------------------
// Stats shared by towers and heroes. Upgrades and skills add to these.
// ---------------------------------------------------------------------------------------------

export const STAT_KEYS = [
  'damage', 'rate', 'range', 'splash', 'burnDps', 'burnTime', 'poolDps', 'poolTime',
  'slow', 'slowTime', 'stunChance', 'stun', 'chains', 'chainRange', 'chainFalloff', 'shots',
  'crit', 'critMul', 'shred', 'beam', 'ramp', 'rampMax', 'cluster', 'moths', 'mothSpeed',
  'cleave', 'reveal', 'buffDamage', 'buffRate', 'income', 'bounty', 'hitsFlying', 'dimImmune',
  'lifeRegen', 'abilityDamage', 'abilityRadius', 'abilityCd', 'abilityTime', 'abilityTargets', 'abilityPower',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;
export type StatMod = Partial<Stats>;

export type DamageType = 'pierce' | 'fire' | 'sound';
export type AttackKind = 'bolt' | 'lob' | 'pulse' | 'chain' | 'summon' | 'aura' | 'lash';

// ---------------------------------------------------------------------------------------------
// Base towers: build, two linear tiers, then a fork into A or B with two tiers each.
// ---------------------------------------------------------------------------------------------

export type TowerId = 'wick' | 'kiln' | 'bell' | 'prism' | 'moth' | 'lamp';
export interface Upgrade { cost: number; add: StatMod }
export interface TowerDef {
  id: TowerId; kind: AttackKind; dmgType: DamageType; cost: number; base: StatMod;
  tiers: [Upgrade, Upgrade];
  forks: { a: [Upgrade, Upgrade]; b: [Upgrade, Upgrade] };
}

export const TOWERS: Record<TowerId, TowerDef> = {
  wick: {
    id: 'wick', kind: 'bolt', dmgType: 'pierce', cost: 70,
    base: { damage: 13, rate: 1.25, range: 150, shots: 1, critMul: 2, hitsFlying: 1 },
    tiers: [
      { cost: 75, add: { damage: 7, rate: 0.25, range: 10 } },
      { cost: 130, add: { damage: 10, rate: 0.3 } },
    ],
    forks: {
      // Long Wick: reaches past its own light, so it wants a lamppost nearby.
      a: [
        { cost: 240, add: { range: 120, damage: 40, rate: -0.55, crit: 0.15, critMul: 0.5 } },
        { cost: 400, add: { damage: 50, crit: 0.1, critMul: 0.5, shred: 0.08 } },
      ],
      b: [
        { cost: 230, add: { shots: 1, rate: 0.1 } },
        { cost: 380, add: { shots: 1, damage: 5, rate: 0.2 } },
      ],
    },
  },
  kiln: {
    id: 'kiln', kind: 'lob', dmgType: 'fire', cost: 110,
    base: { damage: 22, rate: 0.5, range: 170, splash: 46 },
    tiers: [
      { cost: 110, add: { damage: 14, rate: 0.05, splash: 6 } },
      { cost: 170, add: { damage: 18, rate: 0.1, range: 15 } },
    ],
    forks: {
      a: [
        { cost: 300, add: { splash: 28, poolDps: 18, poolTime: 3 } },
        { cost: 460, add: { damage: 40, poolDps: 22, splash: 10 } },
      ],
      b: [
        { cost: 290, add: { cluster: 4, rate: 0.15 } },
        { cost: 440, add: { cluster: 3, damage: 22 } },
      ],
    },
  },
  bell: {
    id: 'bell', kind: 'pulse', dmgType: 'sound', cost: 90,
    base: { damage: 10, rate: 0.45, range: 105, slow: 0.35, slowTime: 1.6 },
    tiers: [
      { cost: 100, add: { damage: 8, slow: 0.1 } },
      { cost: 150, add: { damage: 6, range: 15, rate: 0.1 } },
    ],
    forks: {
      a: [
        { cost: 270, add: { stunChance: 0.25, stun: 0.8 } },
        { cost: 410, add: { stunChance: 0.15, stun: 0.4, slowTime: 1 } },
      ],
      b: [
        { cost: 250, add: { damage: 18, shred: 0.06 } },
        { cost: 400, add: { damage: 30, shred: 0.04, rate: 0.1 } },
      ],
    },
  },
  prism: {
    id: 'prism', kind: 'chain', dmgType: 'pierce', cost: 120,
    base: { damage: 16, rate: 0.8, range: 140, chains: 2, chainRange: 95, chainFalloff: 0.8, shots: 1, critMul: 2, hitsFlying: 1 },
    tiers: [
      { cost: 140, add: { damage: 8, chains: 1 } },
      { cost: 210, add: { rate: 0.2, damage: 8 } },
    ],
    forks: {
      a: [
        { cost: 310, add: { chains: 3, chainFalloff: 0.1 } },
        { cost: 470, add: { damage: 20, shots: 1 } },
      ],
      // Burning Lens: a held beam whose damage climbs while it stays on one target.
      b: [
        { cost: 330, add: { beam: 1, damage: 10, ramp: 0.6, rampMax: 3 } },
        { cost: 500, add: { damage: 24, rampMax: 2, range: 20 } },
      ],
    },
  },
  moth: {
    id: 'moth', kind: 'summon', dmgType: 'pierce', cost: 100,
    base: { damage: 9, rate: 1.3, range: 160, moths: 2, mothSpeed: 220, critMul: 2, hitsFlying: 1 },
    tiers: [
      { cost: 100, add: { moths: 1 } },
      { cost: 170, add: { damage: 6, rate: 0.2, mothSpeed: 40 } },
    ],
    forks: {
      a: [
        { cost: 290, add: { burnDps: 14, burnTime: 2.5 } },
        { cost: 450, add: { moths: 2, burnDps: 12 } },
      ],
      b: [
        { cost: 310, add: { damage: 20, shred: 0.05, rate: -0.3 } },
        { cost: 470, add: { damage: 30, stunChance: 0.12, stun: 0.5 } },
      ],
    },
  },
  lamp: {
    id: 'lamp', kind: 'aura', dmgType: 'fire', cost: 80,
    base: { range: 150, buffDamage: 0.1 },
    tiers: [
      { cost: 100, add: { range: 25, buffDamage: 0.05 } },
      { cost: 150, add: { reveal: 1, range: 15 } },
    ],
    forks: {
      a: [
        { cost: 260, add: { range: 50, buffDamage: 0.1, buffRate: 0.1 } },
        { cost: 400, add: { buffDamage: 0.1, buffRate: 0.05, range: 20, dimImmune: 1 } },
      ],
      b: [
        { cost: 240, add: { income: 40 } },
        { cost: 380, add: { income: 65 } },
      ],
    },
  },
};

export const TOWER_IDS = Object.keys(TOWERS) as TowerId[];

// ---------------------------------------------------------------------------------------------
// Heroes: one of each at most. They level from kills and learn skills for gold.
// ---------------------------------------------------------------------------------------------

export type HeroId = 'lamplighter' | 'sexton' | 'glazier' | 'chandler' | 'mothchild';
export type AbilityKind = 'flare' | 'toll' | 'shatter' | 'vigil' | 'swarm';

export interface SkillNode { add: StatMod }
export interface HeroDef {
  id: HeroId; kind: AttackKind; dmgType: DamageType; cost: number; ability: AbilityKind;
  base: StatMod; perLevel: StatMod;
  /** Three branches of four nodes. Node 4 of each branch is a capstone; only one capstone may be learned. */
  branches: [SkillNode[], SkillNode[], SkillNode[]];
  /** Profile level that unlocks the hero. */
  unlock: number;
}

export const HERO = {
  maxLevel: 10,
  /** Share of every kill's XP that each placed hero receives, on top of full XP for its own kills. */
  share: 0.3,
  /** Hero level needed for skill node 1..4 of a branch. */
  nodeLevel: [1, 3, 5, 8],
  /** Gold cost of skill node 1..4 of a branch. */
  nodeCost: [90, 170, 280, 450],
};
export const heroXpNeed = (level: number): number => Math.floor(12 + 12 * level + 3 * level * level);

export const HEROES: Record<HeroId, HeroDef> = {
  lamplighter: {
    id: 'lamplighter', kind: 'lash', dmgType: 'fire', cost: 120, ability: 'flare', unlock: 1,
    base: { damage: 24, rate: 0.9, range: 115, cleave: 3, reveal: 1, hitsFlying: 1, abilityDamage: 120, abilityRadius: 160, abilityCd: 40, abilityTime: 1.5 },
    perLevel: { damage: 4, range: 1 },
    branches: [
      [{ add: { damage: 10 } }, { add: { burnDps: 14, burnTime: 3 } }, { add: { cleave: 3, damage: 14 } }, { add: { abilityDamage: 260, poolDps: 40, poolTime: 4 } }],
      [{ add: { range: 25 } }, { add: { buffDamage: 0.12 } }, { add: { abilityRadius: 80, abilityCd: -10 } }, { add: { range: 40, buffDamage: 0.15, dimImmune: 1 } }],
      [{ add: { bounty: 0.1 } }, { add: { income: 45 } }, { add: { bounty: 0.12 } }, { add: { income: 110, abilityCd: -12 } }],
    ],
  },
  sexton: {
    id: 'sexton', kind: 'pulse', dmgType: 'sound', cost: 130, ability: 'toll', unlock: 3,
    base: { damage: 18, rate: 0.5, range: 130, slow: 0.4, slowTime: 2, hitsFlying: 1, abilityDamage: 60, abilityRadius: 220, abilityCd: 45, abilityTime: 2.5 },
    perLevel: { damage: 3, range: 3 },
    branches: [
      [{ add: { slow: 0.1 } }, { add: { stunChance: 0.15, stun: 0.6 } }, { add: { slowTime: 1.5, stunChance: 0.1 } }, { add: { abilityTime: 2, abilityRadius: 120, abilityCd: -10 } }],
      [{ add: { damage: 10 } }, { add: { shred: 0.06 } }, { add: { damage: 20, rate: 0.15 } }, { add: { damage: 45, shred: 0.08, abilityDamage: 300 } }],
      [{ add: { lifeRegen: 1 } }, { add: { buffRate: 0.1 } }, { add: { lifeRegen: 1, range: 20 } }, { add: { buffRate: 0.15, buffDamage: 0.1, lifeRegen: 2 } }],
    ],
  },
  glazier: {
    id: 'glazier', kind: 'chain', dmgType: 'pierce', cost: 140, ability: 'shatter', unlock: 6,
    base: { damage: 30, rate: 0.9, range: 160, chains: 3, chainRange: 110, chainFalloff: 0.85, shots: 1, critMul: 2, hitsFlying: 1, abilityDamage: 320, abilityTargets: 8, abilityCd: 35 },
    perLevel: { damage: 5 },
    branches: [
      [{ add: { chains: 1 } }, { add: { chainFalloff: 0.08, chainRange: 30 } }, { add: { chains: 2 } }, { add: { chains: 4, chainFalloff: 0.05, abilityTargets: 8 } }],
      [{ add: { crit: 0.1 } }, { add: { critMul: 0.75 } }, { add: { crit: 0.1, damage: 15 } }, { add: { crit: 0.15, critMul: 1.5, abilityDamage: 500 } }],
      [{ add: { range: 30 } }, { add: { rate: 0.25 } }, { add: { shots: 1 } }, { add: { shots: 1, rate: 0.3, abilityCd: -12 } }],
    ],
  },
  chandler: {
    id: 'chandler', kind: 'bolt', dmgType: 'fire', cost: 130, ability: 'vigil', unlock: 10,
    base: { damage: 15, rate: 2.2, range: 170, shots: 1, critMul: 2, buffRate: 0.08, hitsFlying: 1, abilityTime: 8, abilityPower: 0.5, abilityCd: 50 },
    perLevel: { damage: 2, rate: 0.05 },
    branches: [
      [{ add: { rate: 0.4 } }, { add: { shots: 1 } }, { add: { damage: 8, rate: 0.4 } }, { add: { shots: 2, burnDps: 12, burnTime: 2 } }],
      [{ add: { buffRate: 0.06 } }, { add: { range: 30 } }, { add: { buffDamage: 0.1 } }, { add: { abilityPower: 0.5, abilityTime: 4, buffRate: 0.1 } }],
      [{ add: { bounty: 0.08 } }, { add: { income: 40 } }, { add: { bounty: 0.1, income: 30 } }, { add: { income: 120, abilityCd: -15 } }],
    ],
  },
  mothchild: {
    id: 'mothchild', kind: 'summon', dmgType: 'pierce', cost: 140, ability: 'swarm', unlock: 15,
    base: { damage: 12, rate: 1.5, range: 200, moths: 4, mothSpeed: 280, critMul: 2, hitsFlying: 1, abilityTargets: 16, abilityTime: 10, abilityCd: 45 },
    perLevel: { damage: 2, moths: 0.25 },
    branches: [
      [{ add: { moths: 1 } }, { add: { mothSpeed: 60 } }, { add: { moths: 2 } }, { add: { moths: 3, abilityTargets: 16 } }],
      [{ add: { burnDps: 12, burnTime: 2.5 } }, { add: { burnDps: 10 } }, { add: { range: 30 } }, { add: { burnDps: 30, burnTime: 1.5, abilityTime: 5 } }],
      [{ add: { damage: 8 } }, { add: { shred: 0.05 } }, { add: { damage: 14, crit: 0.1 } }, { add: { damage: 30, stunChance: 0.12, stun: 0.6 } }],
    ],
  },
};

export const HERO_IDS = Object.keys(HEROES) as HeroId[];

// ---------------------------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------------------------

export type EnemyId = 'mite' | 'snuffer' | 'hollow' | 'hound' | 'bat' | 'brute' | 'brood' | 'weaver' | 'tallow' | 'longnight';

export interface EnemyDef {
  id: EnemyId; hp: number; speed: number; armour: number; ward: number; gold: number; lives: number;
  radius: number; xp: number; flying: boolean;
  /** Damage per second dealt to a tower blocking the road. */
  attack: number; stealth: boolean; boss: boolean;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  mite: { id: 'mite', hp: 34, speed: 52, armour: 0, ward: 0, gold: 5, lives: 1, radius: 9, xp: 1, attack: 10, flying: false, stealth: false, boss: false },
  snuffer: { id: 'snuffer', hp: 55, speed: 84, armour: 0, ward: 0.2, gold: 7, lives: 1, radius: 9, xp: 2, attack: 12, flying: false, stealth: false, boss: false },
  hollow: { id: 'hollow', hp: 190, speed: 36, armour: 0.35, ward: 0, gold: 15, lives: 2, radius: 14, xp: 4, attack: 30, flying: false, stealth: false, boss: false },
  hound: { id: 'hound', hp: 95, speed: 108, armour: 0, ward: 0, gold: 11, lives: 1, radius: 11, xp: 3, attack: 18, flying: false, stealth: true, boss: false },
  bat: { id: 'bat', hp: 62, speed: 74, armour: 0, ward: 0, gold: 7, lives: 1, radius: 10, xp: 2, attack: 8, flying: true, stealth: false, boss: false },
  brute: { id: 'brute', hp: 540, speed: 26, armour: 0.2, ward: 0.45, gold: 32, lives: 3, radius: 17, xp: 8, attack: 70, flying: false, stealth: false, boss: false },
  brood: { id: 'brood', hp: 270, speed: 34, armour: 0.1, ward: 0, gold: 18, lives: 2, radius: 16, xp: 6, attack: 30, flying: false, stealth: false, boss: false },
  weaver: { id: 'weaver', hp: 140, speed: 44, armour: 0, ward: 0.3, gold: 17, lives: 1, radius: 12, xp: 4, attack: 14, flying: false, stealth: false, boss: false },
  tallow: { id: 'tallow', hp: 6500, speed: 20, armour: 0.3, ward: 0.3, gold: 300, lives: 15, radius: 30, xp: 120, attack: 250, flying: false, stealth: false, boss: true },
  longnight: { id: 'longnight', hp: 17000, speed: 18, armour: 0.25, ward: 0.25, gold: 0, lives: 20, radius: 40, xp: 300, attack: 400, flying: false, stealth: false, boss: true },
};

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];

export const SPECIAL = {
  /** Snuffers jinx towers they pass: attack speed × (1 − dimAmount) for dimTime seconds. */
  snuffer: { dimRadius: 64, dimAmount: 0.4, dimTime: 2.5 },
  brood: { count: 5, spawn: 'mite' as EnemyId, spread: 18 },
  weaver: { every: 4, radius: 95, shield: 45, shieldCap: 0.6 },
  tallow: { shedEvery: 0.1, shedCount: 6, shed: 'mite' as EnemyId },
  longnight: { snuffEvery: 9, snuffRadius: 230, snuffTime: 3.5, spawnEvery: 6, spawnCount: 4, spawn: 'hound' as EnemyId },
  /** Sideways spread of walkers, in pixels, so crowds don't stack (render only). */
  laneSpread: 9,
};

// ---------------------------------------------------------------------------------------------
// Waves. Each group is [enemy, count, seconds between spawns, start delay]. Groups run in parallel.
// ---------------------------------------------------------------------------------------------

export type WaveGroup = [EnemyId, number, number, number];

export const WAVES: WaveGroup[][] = [
  /* 1 */ [['mite', 10, 1.1, 0]],
  /* 2 */ [['mite', 16, 0.8, 0]],
  /* 3 */ [['mite', 12, 0.8, 0], ['snuffer', 4, 2, 4]],
  /* 4 */ [['mite', 14, 0.7, 0], ['hollow', 2, 4, 6]],
  /* 5 */ [['snuffer', 12, 0.9, 0], ['mite', 10, 0.6, 3]],
  /* 6 */ [['hollow', 5, 2.5, 0], ['mite', 16, 0.5, 2]],
  /* 7 */ [['bat', 10, 1, 0], ['mite', 12, 0.6, 4]],
  /* 8 */ [['hound', 6, 1.4, 0], ['mite', 18, 0.5, 2]],
  /* 9 */ [['weaver', 3, 3, 0], ['hollow', 6, 2, 1], ['snuffer', 10, 0.8, 3]],
  /* 10 */ [['brood', 4, 4, 0], ['bat', 12, 0.8, 3], ['mite', 20, 0.4, 5]],
  /* 11 */ [['hollow', 10, 1.4, 0], ['weaver', 3, 4, 2], ['hound', 6, 1.2, 8]],
  /* 12 */ [['brute', 2, 6, 0], ['mite', 30, 0.35, 2], ['snuffer', 10, 0.8, 6]],
  /* 13 */ [['bat', 20, 0.6, 0], ['hound', 10, 1, 4]],
  /* 14 */ [['brood', 6, 3, 0], ['weaver', 4, 3, 2], ['hollow', 8, 1.5, 4]],
  /* 15 */ [['tallow', 1, 1, 0], ['mite', 30, 0.5, 3], ['snuffer', 12, 1, 8]],
  /* 16 */ [['hound', 16, 0.8, 0], ['bat', 14, 0.7, 4]],
  /* 17 */ [['brute', 5, 3.5, 0], ['weaver', 5, 3, 2], ['snuffer', 16, 0.6, 4]],
  /* 18 */ [['hollow', 16, 0.9, 0], ['brood', 6, 2.5, 3], ['bat', 16, 0.6, 6]],
  /* 19 */ [['hound', 20, 0.6, 0], ['snuffer', 20, 0.5, 2], ['weaver', 4, 3, 5]],
  /* 20 */ [['brute', 8, 2.5, 0], ['brood', 6, 2.5, 4], ['bat', 20, 0.5, 6]],
  /* 21 */ [['mite', 60, 0.2, 0], ['hollow', 14, 1, 3], ['weaver', 6, 2.5, 5]],
  /* 22 */ [['bat', 30, 0.4, 0], ['hound', 18, 0.6, 3], ['snuffer', 16, 0.6, 6]],
  /* 23 */ [['brute', 10, 2, 0], ['weaver', 8, 2, 2], ['brood', 6, 2.5, 6]],
  /* 24 */ [['hollow', 24, 0.6, 0], ['hound', 20, 0.6, 4], ['bat', 20, 0.5, 8]],
  /* 25 */ [['brood', 12, 1.5, 0], ['brute', 8, 2, 4], ['snuffer', 24, 0.4, 6]],
  /* 26 */ [['hound', 30, 0.4, 0], ['weaver', 10, 1.6, 2], ['bat', 26, 0.4, 5]],
  /* 27 */ [['brute', 14, 1.5, 0], ['hollow', 24, 0.6, 3], ['weaver', 8, 2, 6]],
  /* 28 */ [['bat', 40, 0.3, 0], ['hound', 30, 0.4, 3], ['brood', 10, 1.5, 6]],
  /* 29 */ [['brute', 16, 1.2, 0], ['brood', 12, 1.4, 2], ['weaver', 12, 1.4, 4], ['snuffer', 30, 0.35, 6]],
  /* 30 */ [['longnight', 1, 1, 0], ['hound', 30, 0.8, 4], ['brute', 10, 3, 10], ['bat', 30, 0.8, 14]],
];

// ---------------------------------------------------------------------------------------------
// Maps are generated from a seed (src/sim/mapgen.ts). Each preset tunes the generator.
// Heights run 0..4. Enemies walk on height 0 only; towers can stand on any height.
// ---------------------------------------------------------------------------------------------

export const HEIGHT = {
  max: 4,
  /** Tower range multiplier per height level: range × (1 + rangePerLevel × height). */
  rangePerLevel: 0.12,
};

export type MapId = 'meadow' | 'highlands' | 'canyon';

export interface MapGenParams {
  /**
   * Share of off-road tiles at heights 1..4. Sums to 1. Level 0 comes only from the carved road
   * and its clearings, so every level-0 tile belongs to the road network.
   */
  heightShare: [number, number, number, number];
  /** Value-noise cell sizes in tiles, coarse to fine, and their weights. */
  noiseScales: number[];
  noiseWeights: number[];
  /** Number of spawn gates on the left edge. */
  spawns: number;
  /** Number of road legs sweeping between the top and bottom of the board, spread from left to right. */
  legs: [number, number];
  /** How far from the top or bottom edge a leg may turn, as a share of the board height. */
  bendBand: number;
  /** Half-width of the carved valley in hexes (0 = one hex wide). */
  valleyRadius: number;
  /** Level-0 clearings at the road's turns, for building mazes. */
  clearings: [number, number];
  clearingRadius: [number, number];
  /** Largest height difference between neighbouring tiles. 1 gives gentle terraces, 2 allows cliffs. */
  maxStep: number;
  /**
   * Forest and rocks only ever cover heights 1..4, never the level-0 road and fields. Covered tiles
   * can't be built on. Forest grows in groves on low hills; rocks sit on high ground and cliff edges.
   */
  forest: { share: number; heights: [number, number]; scale: number };
  rocks: { share: number; heights: [number, number]; cliffBonus: number };
  /**
   * Reject maps where fewer than minReach of all tiles lie within reachRadius hexes of the enemy route,
   * so the road winds through most of the board.
   */
  reachRadius: number;
  minReach: number;
  /** Reject maps whose shortest walk is shorter than this, in tiles. */
  minPathTiles: number;
}

export const MAP_BALANCE: Record<MapId, { hpMul: number; xpMul: number; unlock: number; gen: MapGenParams }> = {
  meadow: {
    hpMul: 1, xpMul: 1, unlock: 1,
    gen: {
      heightShare: [0.38, 0.28, 0.2, 0.14], noiseScales: [7, 3.5], noiseWeights: [0.75, 0.25], maxStep: 1,
      spawns: 1, legs: [3, 4], bendBand: 0.15, reachRadius: 2, minReach: 0.67, valleyRadius: 0, clearings: [4, 6], clearingRadius: [2, 2], minPathTiles: 22,
      forest: { share: 0.22, heights: [1, 2], scale: 3 }, rocks: { share: 0.06, heights: [2, 4], cliffBonus: 0.15 },
    },
  },
  highlands: {
    hpMul: 1.1, xpMul: 1.3, unlock: 4,
    gen: {
      heightShare: [0.22, 0.28, 0.27, 0.23], noiseScales: [6, 3], noiseWeights: [0.7, 0.3], maxStep: 2,
      spawns: 1, legs: [4, 5], bendBand: 0.15, reachRadius: 2, minReach: 0.67, valleyRadius: 0, clearings: [1, 2], clearingRadius: [1, 2], minPathTiles: 26,
      forest: { share: 0.16, heights: [1, 3], scale: 3 }, rocks: { share: 0.12, heights: [2, 4], cliffBonus: 0.25 },
    },
  },
  canyon: {
    hpMul: 1.2, xpMul: 1.6, unlock: 8,
    gen: {
      heightShare: [0.16, 0.22, 0.3, 0.32], noiseScales: [5, 2.5], noiseWeights: [0.65, 0.35], maxStep: 2,
      spawns: 2, legs: [3, 4], bendBand: 0.15, reachRadius: 2, minReach: 0.67, valleyRadius: 0, clearings: [1, 2], clearingRadius: [1, 2], minPathTiles: 22,
      forest: { share: 0.1, heights: [1, 2], scale: 2.5 }, rocks: { share: 0.18, heights: [2, 4], cliffBonus: 0.35 },
    },
  },
};

/** Pathing costs, in tiles. Towers on the road can be walked "through" by smashing them. */
export const PATHING = {
  /** Extra cost of a tile holding a tower, so enemies only smash through when no open road exists. */
  towerCost: 60,
};

/** Tower hit points, for when enemies have to smash a way through: base + perGold × gold invested. */
export const TOWER_HP = { base: 120, perGold: 1.2, heroBase: 500, heroPerLevel: 60 };

// ---------------------------------------------------------------------------------------------
// Profile XP, levels and perks
// ---------------------------------------------------------------------------------------------

export const PROFILE = {
  maxLevel: 25,
  /** XP for clearing wave w is xpPerWave + xpPerWaveGrowth * w. */
  xpPerWave: 6,
  xpPerWaveGrowth: 1,
  victoryXp: 150,
  /** Perk slots open at these profile levels. */
  perkSlotLevels: [2, 5, 9, 14],
};
/** XP needed to go from `level` to `level + 1`. */
export const profileXpNeed = (level: number): number => Math.floor(80 + 40 * level + 6 * level * level);

export type PerkId =
  | 'purse' | 'hearth' | 'thrift' | 'salvage' | 'glass' | 'veteran' | 'bounty'
  | 'haste' | 'sharpened' | 'tutor' | 'interest' | 'deepwick';

export interface PerkDef {
  unlock: number;
  startGold?: number; lives?: number; costMul?: number; sellRefund?: number; lightMul?: number;
  heroStartLevel?: number; goldMul?: number; earlyMul?: number; damageMul?: number; heroXpMul?: number;
  interest?: number; interestCap?: number; rangeMul?: number;
}

export const PERKS: Record<PerkId, PerkDef> = {
  purse: { unlock: 2, startGold: 70 },
  hearth: { unlock: 3, lives: 6 },
  thrift: { unlock: 4, costMul: 0.92 },
  salvage: { unlock: 5, sellRefund: 0.9 },
  glass: { unlock: 6, lightMul: 1.15 },
  veteran: { unlock: 7, heroStartLevel: 3 },
  bounty: { unlock: 9, goldMul: 1.12 },
  haste: { unlock: 11, earlyMul: 2.5 },
  sharpened: { unlock: 13, damageMul: 1.08 },
  tutor: { unlock: 16, heroXpMul: 1.35 },
  interest: { unlock: 18, interest: 0.05, interestCap: 60 },
  deepwick: { unlock: 21, rangeMul: 1.08, lightMul: 1.05 },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

// ---------------------------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------------------------

export const DEBUG = { speeds: [0.5, 1, 2, 4, 8] };
