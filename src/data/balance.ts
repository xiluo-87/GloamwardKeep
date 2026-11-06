// Core balance values. Mirrors docs/DESIGN.md; change both together.

export const STEP = 1 / 60;

export const PLAYER = {
  hp: 100,
  speed: 150,
  maxOil: 100,
  startOil: 70,
  pickupRange: 60,
  radius: 12,
};

export const FLAME = {
  burning: { radius: 220, burn: 1.0, damage: 1.0, spawn: 1.0 },
  dimmed: { radius: 90, burn: 0.2, damage: 0.7, spawn: 0.8 },
  guttering: { radius: 50, burn: 0, damage: 0.5, spawn: 1.0 },
  gutterHpLoss: 4,
  easeTime: 0.25,
};

export const WICK = { radius: 30, damage: 0.08, burn: 0.35, spawn: 0.08 };

export const DARK_DAMAGE = 0.4;

export const OIL = { droplet: 4, dropletChance: 0.12, flask: 25, crateEvery: 90 };

export const POST = {
  spacing: 700,
  cost: 10,
  lightDist: 40,
  lightTime: 1,
  radius: 180,
  life: 45,
  snufferLife: 5,
};

export const RUN = {
  length: 15 * 60,
  budgetStart: 2,
  budgetEnd: 40,
  budgetEndAt: 13 * 60 + 59,
  enemyCap: 1000,
  projectileCap: 500,
  pickupCap: 1000,
  bossAt: 14 * 60,
  bossSpawnScale: 0.3,
  firstElite: 4 * 60,
  eliteEvery: 2 * 60,
  ringFrom: 11 * 60,
  ringEvery: 30,
  ringSize: 56,
  leash: 1500,
};

export const ELITE = { hp: 12, speed: 0.8, damage: 2, embers: 25, radius: 1.8 };

export const BOSS = {
  hp: 6000,
  radius: 44,
  damage: 20,
  phase2At: 0.6,
  phase3At: 0.25,
  speed: [32, 40, 26],
  waveEvery: 9,
  waveSize: 18,
  eclipseRate: 8,
  eclipseMin: 70,
  blowOutDist: 130,
  invBurn: 0.1,
  invDim: 2,
  sweepEvery: 3.6,
  sweepTelegraph: 1.4,
  sweepLength: 540,
  sweepHalfArc: 0.5,
  sweepDamage: 22,
  dawnTime: 4,
  dimFlicker: 0.45,
};

export const WAX = { perMinute: 5, killsPerWax: 100, dawn: 50, chandler: 1.3, newMoon: 1.5, newMoonCap: 120 };

export const emberNeed = (level: number): number => Math.floor(5 + 4 * level + 0.4 * level * level);
export const budgetRate = (t: number): number =>
  RUN.budgetStart + (RUN.budgetEnd - RUN.budgetStart) * Math.min(1, t / RUN.budgetEndAt);
export const hpScale = (t: number): number => 1 + t / 60 / 6;
