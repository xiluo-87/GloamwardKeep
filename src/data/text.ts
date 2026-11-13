// Names and descriptions. No balance numbers here: upgrade text is built from the stat changes
// in balance.ts by describeMod(), so the two can't drift apart.
import type { AbilityKind, BuildGroup, EnemyId, HeroId, MapId, PerkId, StatKey, StatMod, TowerId } from './balance';

export const GAME_NAME = 'Gloamward Keep';
export const GAME_TAG = 'Hold the keep through thirty waves.';

export interface TowerText { name: string; blurb: string; tiers: [string, string, string]; forks: { a: ForkText; b: ForkText } }
export interface ForkText { name: string; blurb: string; tiers: [string, string] }

export const TOWER_TEXT: Record<TowerId, TowerText> = {
  palisade: {
    name: 'Palisade', blurb: 'Cheap blocker. Upgrade it into walls and build mazes on the road: enemies walk around walls and only smash them if every route is sealed.',
    tiers: ['Palisade', 'Stone Wall', 'Fortified Wall'],
    forks: {
      a: { name: 'Spiked Wall', blurb: 'Its jabs slow enemies, and its spikes hurt whatever smashes it.', tiers: ['Spiked Wall', 'Thorn Rampart'] },
      b: { name: 'Guard Wall', blurb: 'Archers on the battlements. Hits flyers.', tiers: ['Guard Wall', 'Battlements'] },
    },
  },
  archer: {
    name: 'Archer Tower', blurb: 'Quick arrows at one target. Hits flyers.',
    tiers: ['Archer Tower', 'Bowmen', 'Marksmen'],
    forks: {
      a: { name: 'Longbow', blurb: 'A sniper with huge reach and deadly crits. Best on high ground.', tiers: ['Longbow', 'Eagle Eye'] },
      b: { name: 'Volley', blurb: 'Two, then three arrows at once.', tiers: ['Volley', 'Arrow Storm'] },
    },
  },
  catapult: {
    name: 'Catapult', blurb: 'Lobs burning stones that burst on the ground. Cannot hit flyers.',
    tiers: ['Catapult', 'Heavy Catapult', 'Siege Catapult'],
    forks: {
      a: { name: 'Fire Pot', blurb: 'Huge bursts that leave the ground burning.', tiers: ['Fire Pot', 'Inferno'] },
      b: { name: 'Scatter Shot', blurb: 'Each stone splits into smaller bursts.', tiers: ['Scatter Shot', 'Hailstorm'] },
    },
  },
  frost: {
    name: 'Frost Tower', blurb: 'Pulses cold around itself and slows everything nearby. Cannot hit flyers.',
    tiers: ['Frost Tower', 'Ice Spire', 'Winter Spire'],
    forks: {
      a: { name: 'Deep Freeze', blurb: 'Pulses can freeze enemies solid.', tiers: ['Deep Freeze', 'Glacier'] },
      b: { name: 'Shatter', blurb: 'Hard pulses that break armour.', tiers: ['Shatter', 'Frostbite'] },
    },
  },
  mage: {
    name: 'Mage Tower', blurb: 'Lightning that jumps between enemies. Hits flyers.',
    tiers: ['Mage Tower', 'Adept Tower', 'Wizard Tower'],
    forks: {
      a: { name: 'Storm Spire', blurb: 'Longer chains that lose less on each jump.', tiers: ['Storm Spire', 'Tempest'] },
      b: { name: 'Arcane Beam', blurb: 'A held beam that grows stronger the longer it stays on one target.', tiers: ['Arcane Beam', 'Sunfire'] },
    },
  },
  aviary: {
    name: 'Aviary', blurb: 'Sends hawks that chase and claw. Hits flyers.',
    tiers: ['Aviary', 'Hawk Roost', 'Falconry'],
    forks: {
      a: { name: 'Fire Hawks', blurb: 'Claws set enemies alight.', tiers: ['Fire Hawks', 'Phoenix Roost'] },
      b: { name: 'War Eagles', blurb: 'Fewer strikes, but heavy ones that break armour.', tiers: ['War Eagles', 'Royal Eagles'] },
    },
  },
  shrine: {
    name: 'Shrine', blurb: 'No attack. Towers in its range deal more damage.',
    tiers: ['Shrine', 'Blessed Shrine', 'Watch Shrine'],
    forks: {
      a: { name: 'War Banner', blurb: 'A wide blessing of damage and speed.', tiers: ['War Banner', 'Royal Standard'] },
      b: { name: 'Treasury', blurb: 'Brings in gold after every wave.', tiers: ['Treasury', 'Royal Mint'] },
    },
  },
};

export const GROUP_TEXT: Record<BuildGroup | 'heroes', { name: string; blurb: string }> = {
  physical: { name: 'Physical', blurb: 'Arrows, stones and claws. Strong against unarmoured foes.' },
  magic: { name: 'Magical', blurb: 'Lightning and arcane beams. Ignores armour; trolls resist it.' },
  support: { name: 'Support', blurb: 'Control and blessings: slow and freeze enemies, strengthen nearby towers or earn gold.' },
  heroes: { name: 'Heroes', blurb: 'Unique champions that level up and learn skills.' },
};

export interface HeroText { name: string; title: string; blurb: string; ability: string; abilityDesc: string; branches: [BranchText, BranchText, BranchText] }
export interface BranchText { name: string; nodes: [string, string, string, string] }

export const HERO_TEXT: Record<HeroId, HeroText> = {
  knight: {
    name: 'The Knight', title: 'Sworn shield of the keep', blurb: 'Cleaves the closest enemies with a greatsword and spots Shadow Stalkers.',
    ability: 'Charge', abilityDesc: 'Slams into everything nearby, dealing damage and stunning.',
    branches: [
      { name: 'Blade', nodes: ['Sharp Edge', 'Bleeding Cuts', 'Wide Swing', 'Earthshaker'] },
      { name: 'Banner', nodes: ['Long Reach', 'Inspire', 'Battle Cry', 'Lord Commander'] },
      { name: 'Spoils', nodes: ['Loot', 'Tribute', 'Plunder', 'Golden Crown'] },
    ],
  },
  cleric: {
    name: 'The Cleric', title: 'Keeper of the chapel', blurb: 'Holy pulses that slow, and hit flyers too.',
    ability: 'Sanctify', abilityDesc: 'Stuns every enemy in a wide circle.',
    branches: [
      { name: 'Stillness', nodes: ['Heavy Air', 'Hush', 'Long Silence', 'Requiem'] },
      { name: 'Wrath', nodes: ['Smite', 'Judgement', 'Zeal', 'Divine Wrath'] },
      { name: 'Sanctuary', nodes: ['Mending', 'Blessing', 'Kept Walls', 'Sanctuary'] },
    ],
  },
  sorcerer: {
    name: 'The Sorcerer', title: 'Student of the storm', blurb: 'Lightning that jumps between many enemies.',
    ability: 'Arcane Barrage', abilityDesc: 'Strikes the strongest enemies in a wide range.',
    branches: [
      { name: 'Storm', nodes: ['Extra Arc', 'Conduction', 'Forked Bolt', 'Thunderhead'] },
      { name: 'Focus', nodes: ['Keen Mind', 'Overload', 'Precision', 'Archmage'] },
      { name: 'Echo', nodes: ['Far Sight', 'Quick Casting', 'Twin Bolt', 'Hall of Echoes'] },
    ],
  },
  ranger: {
    name: 'The Ranger', title: 'Warden of the wild roads', blurb: 'Rapid arrows, and nearby towers attack faster.',
    ability: 'Rally', abilityDesc: 'Every tower attacks faster for a while.',
    branches: [
      { name: 'Bow', nodes: ['Quick Draw', 'Second Arrow', 'Heavy Draw', 'Rain of Arrows'] },
      { name: 'Captain', nodes: ['Drill', 'Watchful', 'Discipline', 'Call to Arms'] },
      { name: 'Hunter', nodes: ['Pelts', 'Trade Route', 'Bounty Hunter', 'Hunting Lodge'] },
    ],
  },
  druid: {
    name: 'The Druid', title: 'Voice of the old forest', blurb: 'Spirit hawks follow them and strike anything in reach.',
    ability: 'Wild Hunt', abilityDesc: 'Releases a large flock of spirit hawks for a while.',
    branches: [
      { name: 'Flock', nodes: ['More Wings', 'Swift Wings', 'Great Flock', 'Sky Cloud'] },
      { name: 'Flame', nodes: ['Ember Feathers', 'Burning Talons', 'Far Flight', 'Phoenix'] },
      { name: 'Talon', nodes: ['Sharp Talons', 'Rend', 'Hunters', 'Roc'] },
    ],
  },
};

export const ABILITY_TEXT: Record<AbilityKind, string> = {
  charge: 'Charge', sanctify: 'Sanctify', barrage: 'Arcane Barrage', rally: 'Rally', wildhunt: 'Wild Hunt',
};

export const ENEMY_TEXT: Record<EnemyId, { name: string; blurb: string }> = {
  goblin: { name: 'Goblin', blurb: 'Small and many.' },
  hexer: { name: 'Goblin Hexer', blurb: 'Fast. Jinxes towers it runs past so they attack slower.' },
  orc: { name: 'Orc Warrior', blurb: 'Slow and armoured. Fire and magic work best.' },
  stalker: { name: 'Shadow Stalker', blurb: 'Fast and unseen. Only a Watch Shrine or the Knight can detect it.' },
  bat: { name: 'Giant Bat', blurb: 'Flies straight over the hills to the keep. Catapults and frost cannot hit it.' },
  troll: { name: 'Troll', blurb: 'Huge and resistant to fire and magic. Arrows work best.' },
  wagon: { name: 'War Wagon', blurb: 'Spills goblins when destroyed.' },
  shaman: { name: 'Orc Shaman', blurb: 'Wraps nearby enemies in shields.' },
  ogreking: { name: 'The Ogre King', blurb: 'Sheds goblins as it is wounded.' },
  lich: { name: 'The Lich', blurb: 'Silences towers around it and raises stalkers.' },
};

export const CLEAR_TEXT = {
  forest: { name: 'Forest', action: 'Clear forest' },
  rocks: { name: 'Rocks', action: 'Clear rocks' },
  hint: 'Clear it for gold to build here.',
};

export const MAP_TEXT: Record<MapId, { name: string; blurb: string }> = {
  meadow: { name: 'Meadow', blurb: 'Gentle hills, a long road and roomy bends for mazes.' },
  highlands: { name: 'Highlands', blurb: 'A winding road between high cliffs.' },
  canyon: { name: 'Canyon', blurb: 'Two gates, rocky heights and tougher enemies.' },
};

export const PERK_TEXT: Record<PerkId, { name: string; desc: string }> = {
  purse: { name: 'Full Purse', desc: 'More starting gold.' },
  walls: { name: 'Thick Walls', desc: 'More lives.' },
  thrift: { name: 'Thrift', desc: 'Towers, upgrades, skills and heroes cost less.' },
  salvage: { name: 'Salvage', desc: 'Selling returns more gold.' },
  eagle: { name: 'Eagle Eye', desc: 'All towers reach further.' },
  veteran: { name: 'Veterans', desc: 'Heroes start at a higher level.' },
  bounty: { name: 'Bounty', desc: 'Kills give more gold.' },
  haste: { name: 'Eager', desc: 'Calling a wave early pays much more.' },
  sharpened: { name: 'Whetstone', desc: 'All towers and heroes deal more damage.' },
  tutor: { name: 'Tutor', desc: 'Heroes gain more experience.' },
  interest: { name: 'Interest', desc: 'Earn a share of your banked gold after each wave, up to a cap.' },
  highground: { name: 'High Ground', desc: 'Height gives towers even more range.' },
};

/** How each stat reads in upgrade descriptions. `pct` shows the value as a percentage. */
export const STAT_TEXT: Record<StatKey, { label: string; pct?: boolean; flag?: string; unit?: string }> = {
  damage: { label: 'damage' }, rate: { label: 'attacks/s' }, range: { label: 'range' },
  splash: { label: 'splash' }, burnDps: { label: 'burn/s' }, burnTime: { label: 'burn time', unit: 's' },
  poolDps: { label: 'burning ground/s' }, poolTime: { label: 'ground burn time', unit: 's' },
  slow: { label: 'slow', pct: true }, slowTime: { label: 'slow time', unit: 's' },
  stunChance: { label: 'stun chance', pct: true }, stun: { label: 'stun', unit: 's' },
  chains: { label: 'bounces' }, chainRange: { label: 'bounce range' }, chainFalloff: { label: 'bounce strength', pct: true },
  shots: { label: 'shots' }, crit: { label: 'crit chance', pct: true }, critMul: { label: 'crit damage', pct: true },
  shred: { label: 'armour break per hit', pct: true }, beam: { label: 'beam', flag: 'Fires a held beam' },
  ramp: { label: 'beam heat/s', pct: true }, rampMax: { label: 'max beam heat', pct: true },
  cluster: { label: 'cluster bursts' }, pets: { label: 'hawks' }, petSpeed: { label: 'hawk speed' },
  cleave: { label: 'targets per swing' }, reveal: { label: 'detection', flag: 'Detects Shadow Stalkers in range' },
  buffDamage: { label: 'damage to towers in range', pct: true }, buffRate: { label: 'attack speed to towers in range', pct: true },
  income: { label: 'gold per wave' }, bounty: { label: 'kill gold', pct: true },
  hitsFlying: { label: 'flyers', flag: 'Can hit flyers' }, jinxImmune: { label: 'jinx', flag: 'Hexers can no longer jinx it' },
  lifeRegen: { label: 'lives per wave' },
  hp: { label: 'hit points' }, thorns: { label: 'damage/s to attackers' },
  abilityDamage: { label: 'ability damage' }, abilityRadius: { label: 'ability radius' },
  abilityCd: { label: 'ability cooldown', unit: 's' }, abilityTime: { label: 'ability duration', unit: 's' },
  abilityTargets: { label: 'ability targets' }, abilityPower: { label: 'ability strength', pct: true },
};

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** Turns a stat change into readable text, e.g. "+6 damage, +10 range". */
export function describeMod(mod: StatMod): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(mod) as [StatKey, number][]) {
    if (!v) continue;
    const t = STAT_TEXT[k];
    if (t.flag) { parts.push(t.flag); continue; }
    const sign = v > 0 ? '+' : '−';
    const abs = Math.abs(v);
    const value = t.pct ? `${fmt(Math.round(abs * 100))}%` : `${fmt(abs)}${t.unit ?? ''}`;
    parts.push(`${sign}${value} ${t.label}`);
  }
  return parts.join(', ');
}
