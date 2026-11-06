// Enemies, waves, weapons and passives as plain data.

export type EnemyId = 'mite' | 'hollow' | 'snuffer' | 'hound' | 'boss';

export interface EnemyDef {
  id: EnemyId; name: string; hp: number; speed: number; damage: number; embers: number;
  radius: number; cost: number; pushResist: number; toughness: number;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  mite: { id: 'mite', name: 'Soot Mite', hp: 8, speed: 70, damage: 4, embers: 1, radius: 8, cost: 1, pushResist: 0, toughness: 0 },
  snuffer: { id: 'snuffer', name: 'Snuffer', hp: 20, speed: 110, damage: 3, embers: 1, radius: 9, cost: 2, pushResist: 0, toughness: 1 },
  hollow: { id: 'hollow', name: 'Hollow One', hp: 45, speed: 40, damage: 10, embers: 5, radius: 14, cost: 4, pushResist: 0.5, toughness: 2 },
  hound: { id: 'hound', name: 'Shade Hound', hp: 30, speed: 170, damage: 8, embers: 5, radius: 11, cost: 3, pushResist: 0, toughness: 3 },
  boss: { id: 'boss', name: 'The Long Night', hp: 6000, speed: 32, damage: 20, embers: 0, radius: 44, cost: 0, pushResist: 1, toughness: 9 },
};

export const HOUND_PACK = 6;
export const SNUFFER_DRAIN = 5;

export interface Wave { from: number; name: string; weights: Partial<Record<EnemyId, number>> }

export const WAVES: Wave[] = [
  { from: 0, name: 'Dusk', weights: { mite: 1 } },
  { from: 120, name: 'Early night', weights: { mite: 0.8, hollow: 0.2 } },
  { from: 300, name: 'Night', weights: { mite: 0.6, hollow: 0.2, snuffer: 0.2 } },
  { from: 480, name: 'Deep night', weights: { mite: 0.5, hollow: 0.2, snuffer: 0.15, hound: 0.15 } },
  { from: 660, name: 'The small hours', weights: { mite: 0.35, hollow: 0.25, snuffer: 0.2, hound: 0.2 } },
  { from: 840, name: 'Last dark', weights: { mite: 0.5, hollow: 0.2, snuffer: 0.15, hound: 0.15 } },
];

export function waveAt(t: number): Wave {
  let w = WAVES[0];
  for (const c of WAVES) if (t >= c.from) w = c;
  return w;
}

export type WeaponId = 'moth' | 'cinder' | 'lash' | 'shard' | 'bell' | 'sentry' | 'firemoth' | 'stained' | 'vigil';

export interface WeaponDef {
  id: WeaponId; name: string; desc: string; damage: number; cooldown: number; maxRank: number;
  colour: string; glyph: string; rank3?: string; rank5?: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  moth: { id: 'moth', name: 'Moth Swarm', desc: 'Moths orbit you and bite what they touch.', damage: 6, cooldown: 0.5, maxRank: 5, colour: '#e8dcae', glyph: 'Mo', rank3: '+1 moth', rank5: '+2 moths' },
  cinder: { id: 'cinder', name: 'Cinder Toss', desc: 'Lobs a coal that burns the ground for 3 s.', damage: 14, cooldown: 1.8, maxRank: 5, colour: '#ff7a2f', glyph: 'Ci', rank3: '+1 throw', rank5: 'Larger pool' },
  lash: { id: 'lash', name: 'Wick Lash', desc: 'A wide whip in the direction you move.', damage: 18, cooldown: 1.0, maxRank: 5, colour: '#ffb347', glyph: 'La', rank3: 'Hits behind too', rank5: '+40% length' },
  shard: { id: 'shard', name: 'Glass Shards', desc: 'A shard bounces between enemies.', damage: 9, cooldown: 1.4, maxRank: 5, colour: '#9fd8ff', glyph: 'Gl', rank3: '+2 bounces', rank5: '+1 shard' },
  bell: { id: 'bell', name: 'Bell Toll', desc: 'An expanding ring that damages and pushes back.', damage: 10, cooldown: 4, maxRank: 5, colour: '#d9d2f0', glyph: 'Be', rank3: '+30% push', rank5: '+25% radius' },
  sentry: { id: 'sentry', name: 'Candle Sentry', desc: 'Sets down a turret that lasts 12 s.', damage: 7, cooldown: 8, maxRank: 5, colour: '#f7e3b0', glyph: 'Se', rank3: '+1 sentry', rank5: 'Sentries give a small light' },
  firemoth: { id: 'firemoth', name: 'Firemoths', desc: 'Moths leave burning trails and dive at distant enemies.', damage: 13, cooldown: 0.5, maxRank: 1, colour: '#ff9a4a', glyph: 'Fi' },
  stained: { id: 'stained', name: 'Stained Lash', desc: 'The whip throws coloured shards along its whole length.', damage: 36, cooldown: 1.0, maxRank: 1, colour: '#d97ae0', glyph: 'St' },
  vigil: { id: 'vigil', name: 'The Vigil', desc: 'Sentries toll bells, and each toll adds lifetime to nearby lit lampposts.', damage: 13, cooldown: 7, maxRank: 1, colour: '#cfe0ff', glyph: 'Vi' },
};

export const BASE_WEAPONS: WeaponId[] = ['moth', 'cinder', 'lash', 'shard', 'bell', 'sentry'];
export const COMBOS: { a: WeaponId; b: WeaponId; result: WeaponId }[] = [
  { a: 'moth', b: 'cinder', result: 'firemoth' },
  { a: 'lash', b: 'shard', result: 'stained' },
  { a: 'bell', b: 'sentry', result: 'vigil' },
];

// Behaviour numbers the design leaves open.
export const TUNING = {
  moth: { orbit: 70, count: 3, spin: 2.6, radius: 8 },
  firemoth: { diveEvery: 2.4, diveSpeed: 430, range: 380, trailEvery: 0.28, trailLife: 1.4, trailRadius: 20, trailDps: 10 },
  cinder: { range: 460, flight: 0.6, hitRadius: 40, pool: 46, poolLarge: 72, burn: 5, life: 3 },
  lash: { length: 135, halfArc: 1.2, stainedShards: 9, shardSpeed: 420, shardDamage: 9, shardLife: 0.65 },
  shard: { range: 420, bounceRange: 190, speed: 500, bounces: 4 },
  bell: { radius: 200, time: 0.6, push: 240 },
  sentry: { life: 12, range: 340, rate: 2, shotSpeed: 460, light: 80, cap: 8 },
  vigil: { tollEvery: 3, tollRadius: 150, addLife: 2.5, postRange: 320 },
};

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;
export const rankMul = (rank: number): number => 1 + 0.2 * (rank - 1);

export type PassiveId = 'wick' | 'reservoir' | 'trim' | 'boots' | 'coat' | 'hook' | 'heart';

export const PASSIVES: Record<PassiveId, { id: PassiveId; name: string; desc: string; glyph: string; colour: string }> = {
  wick: { id: 'wick', name: 'Turn Up the Wick', desc: '+30 light, +8% damage. Burns 0.35 oil/s faster and draws 8% more enemies.', glyph: 'Wk', colour: '#ffb347' },
  reservoir: { id: 'reservoir', name: 'Deep Reservoir', desc: '+20 max oil, and +10 oil once.', glyph: 'Re', colour: '#7ad7c2' },
  trim: { id: 'trim', name: 'Trimmed Wick', desc: '-8% oil burn.', glyph: 'Tr', colour: '#a9e0c9' },
  boots: { id: 'boots', name: 'Good Boots', desc: '+7% move speed.', glyph: 'Bo', colour: '#c9b18a' },
  coat: { id: 'coat', name: 'Waxed Coat', desc: '-1 damage taken, minimum 1.', glyph: 'Co', colour: '#b7c0d8' },
  hook: { id: 'hook', name: 'Ember Hook', desc: '+25% pickup range.', glyph: 'Ho', colour: '#ff7a2f' },
  heart: { id: 'heart', name: 'Warm Heart', desc: '+20 max HP, and 0.2 HP/s regeneration.', glyph: 'He', colour: '#d94f6a' },
};
export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];

export type ShopId = 'glass' | 'flask' | 'frame' | 'thought' | 'memory';
export const SHOP: { id: ShopId; name: string; desc: string; ranks: number; cost: (rank: number) => number }[] = [
  { id: 'glass', name: 'Better Glass', desc: '+10 starting light radius', ranks: 5, cost: (r) => 40 + 30 * r },
  { id: 'flask', name: 'Full Flask', desc: '+5 starting oil', ranks: 5, cost: (r) => 30 + 25 * r },
  { id: 'frame', name: 'Sturdy Frame', desc: '+10 max HP', ranks: 5, cost: (r) => 30 + 25 * r },
  { id: 'thought', name: 'Second Thought', desc: '+1 reroll per run', ranks: 3, cost: (r) => 60 + 50 * r },
  { id: 'memory', name: 'Long Memory', desc: '+4% embers', ranks: 5, cost: (r) => 50 + 35 * r },
];

export type CharacterId = 'lamplighter' | 'chandler' | 'sexton' | 'mothchild';
export const CHARACTERS: { id: CharacterId; name: string; weapon: WeaponId; trait: string; unlock: string }[] = [
  { id: 'lamplighter', name: 'The Lamplighter', weapon: 'lash', trait: 'Lampposts cost half the oil.', unlock: 'Always here.' },
  { id: 'chandler', name: 'The Chandler', weapon: 'sentry', trait: '+30% wax earned.', unlock: 'Earn 300 wax in total.' },
  { id: 'sexton', name: 'The Sexton', weapon: 'bell', trait: 'The bell pushes oil and embers toward you.', unlock: 'Reach 10:00.' },
  { id: 'mothchild', name: 'The Moth Child', weapon: 'moth', trait: 'Radius -40, speed +15%, always 2 extra moths.', unlock: 'Reach dawn once.' },
];
