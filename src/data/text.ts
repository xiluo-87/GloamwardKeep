// Names and descriptions. No balance numbers here: upgrade text is built from the stat changes
// in balance.ts by describeMod(), so the two can't drift apart.
import type { AbilityKind, EnemyId, HeroId, MapId, PerkId, StatKey, StatMod, TowerId } from './balance';

export const GAME_NAME = 'Lampwatch';
export const GAME_TAG = 'Keep the hearth lit through thirty nights of dark.';

export interface TowerText { name: string; blurb: string; tiers: [string, string, string]; forks: { a: ForkText; b: ForkText } }
export interface ForkText { name: string; blurb: string; tiers: [string, string] }

export const TOWER_TEXT: Record<TowerId, TowerText> = {
  palisade: {
    name: 'Palisade', blurb: 'Cheap and weak. Build it to plug gaps and steer enemies into longer paths.',
    tiers: ['Palisade', 'Braced Palisade', 'Tall Palisade'],
    forks: {
      a: { name: 'Spiked Palisade', blurb: 'Hurts enemies that try to smash through it.', tiers: ['Spiked Palisade', 'Thorn Wall'] },
      b: { name: 'Stone Wall', blurb: 'Very sturdy. For maze walls that must hold.', tiers: ['Stone Wall', 'Rampart'] },
    },
  },
  wick: {
    name: 'Wick Post', blurb: 'Fires quick bolts of flame at one target. Hits flyers.',
    tiers: ['Wick Post', 'Trimmed Wick', 'Steady Wick'],
    forks: {
      a: { name: 'Long Wick', blurb: 'A sniper. Reaches far past its own light, so pair it with a lamppost.', tiers: ['Long Wick', 'Far Flame'] },
      b: { name: 'Twin Wick', blurb: 'Two, then three bolts at once.', tiers: ['Twin Wick', 'Triple Wick'] },
    },
  },
  kiln: {
    name: 'Cinder Kiln', blurb: 'Lobs coals that burst on the ground. Cannot hit flyers.',
    tiers: ['Cinder Kiln', 'Hot Kiln', 'Blast Kiln'],
    forks: {
      a: { name: 'Ember Mortar', blurb: 'Huge bursts that leave the ground burning.', tiers: ['Ember Mortar', 'Furnace Mortar'] },
      b: { name: 'Cluster Coals', blurb: 'Each coal splits into smaller bursts.', tiers: ['Cluster Coals', 'Coal Storm'] },
    },
  },
  bell: {
    name: 'Bell Tower', blurb: 'Rings around itself and slows everything nearby, lit or not. Cannot hit flyers.',
    tiers: ['Bell Tower', 'Bronze Bell', 'Great Bell'],
    forks: {
      a: { name: 'Toll of Stillness', blurb: 'Rings can stop enemies dead.', tiers: ['Stillness', 'Deep Stillness'] },
      b: { name: 'Resonance', blurb: 'Hard rings that crack armour.', tiers: ['Resonance', 'Shattering Peal'] },
    },
  },
  prism: {
    name: 'Glass Prism', blurb: 'A shard that bounces between enemies. Hits flyers.',
    tiers: ['Glass Prism', 'Cut Prism', 'Clear Prism'],
    forks: {
      a: { name: 'Stained Prism', blurb: 'Longer chains that lose less on each bounce.', tiers: ['Stained Prism', 'Rose Window'] },
      b: { name: 'Burning Lens', blurb: 'A held beam that grows hotter the longer it stays on one target.', tiers: ['Burning Lens', 'Sunglass'] },
    },
  },
  moth: {
    name: 'Moth Cote', blurb: 'Sends moths that chase and bite. Hits flyers.',
    tiers: ['Moth Cote', 'Busy Cote', 'Swift Cote'],
    forks: {
      a: { name: 'Firemoths', blurb: 'Bites set enemies alight.', tiers: ['Firemoths', 'Pyre Moths'] },
      b: { name: "Death's-heads", blurb: 'Fewer bites, but heavy ones that crack armour.', tiers: ["Death's-heads", 'Grave Moths'] },
    },
  },
  lamp: {
    name: 'Lamppost', blurb: 'No attack. A big light, and towers inside it deal more damage.',
    tiers: ['Lamppost', 'Bright Lamp', 'Seeing Lamp'],
    forks: {
      a: { name: 'Beacon', blurb: 'A huge light that strengthens every tower inside it.', tiers: ['Beacon', 'Lighthouse'] },
      b: { name: 'Oil Still', blurb: 'Brings in gold after every wave.', tiers: ['Oil Still', 'Oil Works'] },
    },
  },
};

export interface HeroText { name: string; title: string; blurb: string; ability: string; abilityDesc: string; branches: [BranchText, BranchText, BranchText] }
export interface BranchText { name: string; nodes: [string, string, string, string] }

export const HERO_TEXT: Record<HeroId, HeroText> = {
  lamplighter: {
    name: 'The Lamplighter', title: 'Keeper of the lane', blurb: 'Whips the closest enemies with fire. Carries a light that reveals Shade Hounds.',
    ability: 'Flare', abilityDesc: 'A blast of light that burns and stuns everything nearby.',
    branches: [
      { name: 'Flame', nodes: ['Hot Lash', 'Clinging Fire', 'Wide Arc', 'Bonfire'] },
      { name: 'Wick', nodes: ['Long Wick', 'Warm Company', 'Big Flare', 'Midsummer'] },
      { name: 'Oil', nodes: ['Small Change', 'Oil Trade', 'Good Business', 'Golden Flame'] },
    ],
  },
  sexton: {
    name: 'The Sexton', title: 'Ringer of the dead bell', blurb: 'Rings a heavy bell that slows, and hits flyers too.',
    ability: 'Great Toll', abilityDesc: 'Stuns every enemy in a wide circle.',
    branches: [
      { name: 'Stillness', nodes: ['Heavy Air', 'Hush', 'Long Silence', 'Requiem'] },
      { name: 'Peal', nodes: ['Loud Bell', 'Cracked Bronze', 'Fast Peal', 'Doom Peal'] },
      { name: 'Sanctuary', nodes: ['Mending', 'Steady Hands', 'Kept Hearth', 'Sanctuary'] },
    ],
  },
  glazier: {
    name: 'The Glazier', title: 'Cutter of sharp light', blurb: 'Throws glass that bounces between many enemies.',
    ability: 'Shatter', abilityDesc: 'Hits the strongest enemies in a wide range with heavy glass.',
    branches: [
      { name: 'Facets', nodes: ['Extra Facet', 'True Angle', 'Many Faces', 'Kaleidoscope'] },
      { name: 'Edge', nodes: ['Keen Edge', 'Deep Cut', 'Razor', 'Diamond'] },
      { name: 'Mirror', nodes: ['Polish', 'Quick Hands', 'Twin Pane', 'Hall of Mirrors'] },
    ],
  },
  chandler: {
    name: 'The Chandler', title: 'Maker of candles', blurb: 'Fires quick candle bolts and speeds up nearby towers.',
    ability: 'Vigil', abilityDesc: 'Every tower attacks faster for a while.',
    branches: [
      { name: 'Wax', nodes: ['Soft Wax', 'Second Wick', 'Hard Wax', 'Candelabra'] },
      { name: 'Wick', nodes: ['Shared Flame', 'Tall Candle', 'Good Light', 'All-Night Vigil'] },
      { name: 'Tallow', nodes: ['Penny Candles', 'Trade Route', 'Guild Price', 'Candle Guild'] },
    ],
  },
  mothchild: {
    name: 'The Moth Child', title: 'Friend of the night wings', blurb: 'A cloud of moths follows them and bites anything in reach.',
    ability: 'Swarm', abilityDesc: 'Releases a large swarm of moths for a while.',
    branches: [
      { name: 'Brood', nodes: ['More Wings', 'Quick Wings', 'Big Brood', 'Cloud'] },
      { name: 'Flame', nodes: ['Ember Wings', 'Hot Wings', 'Bright Wings', 'Phoenix Moths'] },
      { name: "Death's-head", nodes: ['Sharp Mouths', 'Gnaw', 'Hunters', 'Skull Moths'] },
    ],
  },
};

export const ABILITY_TEXT: Record<AbilityKind, string> = {
  flare: 'Flare', toll: 'Great Toll', shatter: 'Shatter', vigil: 'Vigil', swarm: 'Swarm',
};

export const ENEMY_TEXT: Record<EnemyId, { name: string; blurb: string }> = {
  mite: { name: 'Soot Mite', blurb: 'Small and many.' },
  snuffer: { name: 'Snuffer', blurb: 'Fast. Dims the lights of towers it runs past.' },
  hollow: { name: 'Hollow One', blurb: 'Slow and armoured. Fire and bells work best.' },
  hound: { name: 'Shade Hound', blurb: 'Fast and unseen. Only a Seeing Lamp or the Lamplighter can reveal it.' },
  bat: { name: 'Gloom Bat', blurb: 'Flies. Kilns and bells cannot hit it.' },
  brute: { name: 'Tallow Brute', blurb: 'Huge and warded against fire and sound. Bolts and glass work best.' },
  brood: { name: 'Brood Mother', blurb: 'Bursts into Soot Mites when killed.' },
  weaver: { name: 'Veil Weaver', blurb: 'Wraps nearby enemies in shields.' },
  tallow: { name: 'The Tallow King', blurb: 'Sheds mites as it melts.' },
  longnight: { name: 'The Long Night', blurb: 'Snuffs out lights around it and calls hounds.' },
};

export const MAP_TEXT: Record<MapId, { name: string; blurb: string }> = {
  meadow: { name: 'Meadow', blurb: 'Gentle hills, a long road and roomy bends for mazes.' },
  highlands: { name: 'Highlands', blurb: 'A winding road between high cliffs.' },
  canyon: { name: 'Canyon', blurb: 'Two gates, rocky heights and tougher enemies.' },
};

export const PERK_TEXT: Record<PerkId, { name: string; desc: string }> = {
  purse: { name: 'Full Purse', desc: 'More starting gold.' },
  hearth: { name: 'Banked Hearth', desc: 'More lives.' },
  thrift: { name: 'Thrift', desc: 'Towers, upgrades and heroes cost less.' },
  salvage: { name: 'Salvage', desc: 'Selling returns more gold.' },
  glass: { name: 'Clear Glass', desc: 'All lights reach further.' },
  veteran: { name: 'Veterans', desc: 'Heroes start at a higher level.' },
  bounty: { name: 'Bounty', desc: 'Kills give more gold.' },
  haste: { name: 'Eager', desc: 'Calling a wave early pays much more.' },
  sharpened: { name: 'Sharpened', desc: 'All towers and heroes deal more damage.' },
  tutor: { name: 'Tutor', desc: 'Heroes gain more experience.' },
  interest: { name: 'Interest', desc: 'Earn a share of your banked gold after each wave, up to a cap.' },
  deepwick: { name: 'Deep Wick', desc: 'All towers reach further, and lights grow a little.' },
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
  shred: { label: 'armour crack per hit', pct: true }, beam: { label: 'beam', flag: 'Fires a held beam' },
  ramp: { label: 'beam heat/s', pct: true }, rampMax: { label: 'max beam heat', pct: true },
  cluster: { label: 'cluster bursts' }, moths: { label: 'moths' }, mothSpeed: { label: 'moth speed' },
  cleave: { label: 'targets per lash' }, reveal: { label: 'reveal', flag: 'Reveals Shade Hounds in its light' },
  buffDamage: { label: 'damage to towers in light', pct: true }, buffRate: { label: 'attack speed to towers in light', pct: true },
  income: { label: 'gold per wave' }, bounty: { label: 'kill gold', pct: true },
  hitsFlying: { label: 'flyers', flag: 'Can hit flyers' }, dimImmune: { label: 'dim', flag: 'Snuffers can no longer dim it' },
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
