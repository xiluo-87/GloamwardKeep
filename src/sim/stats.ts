// Pure helpers for tower stats, prices and the hero skill tree. No state changes here.
import {
  AttackKind, DamageType, HEIGHT, HERO, KEEP, HEROES, HeroId, heroXpNeed, StatMod, Stats, STAT_KEYS, TOWER_HP, TOWERS, TowerId, Upgrade,
} from '../data/balance';
import { emptyStats, Mods, RunState, Tower } from './state';

export const isHeroType = (type: string): type is HeroId => type in HEROES;
export const kindOf = (t: Pick<Tower, 'type'>): AttackKind => (isHeroType(t.type) ? HEROES[t.type].kind : TOWERS[t.type].kind);
export const dmgTypeOf = (t: Pick<Tower, 'type'>): DamageType => (isHeroType(t.type) ? HEROES[t.type].dmgType : TOWERS[t.type].dmgType);

function addMod(out: Stats, mod: StatMod, times = 1): void {
  for (const k of STAT_KEYS) {
    const v = mod[k];
    if (v) out[k] += v * times;
  }
}

/** Every stat change a tower has received, in order. Used for stats and for the UI. */
export function appliedMods(t: Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier' | 'heroLevel' | 'skills'>): StatMod[] {
  if (isHeroType(t.type)) {
    const h = HEROES[t.type];
    const out: StatMod[] = [h.base];
    for (const code of t.skills) out.push(h.branches[Math.floor(code / 4)][code % 4].add);
    return out;
  }
  const d = TOWERS[t.type];
  const out: StatMod[] = [d.base];
  for (let i = 0; i < t.tier - 1; i++) out.push(d.tiers[i].add);
  if (t.fork) for (let i = 0; i < t.forkTier; i++) out.push(d.forks[t.fork][i].add);
  return out;
}

export function computeStats(t: Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier' | 'heroLevel' | 'skills' | 'height'>, mods: Mods): Stats {
  const s = emptyStats();
  for (const m of appliedMods(t)) addMod(s, m);
  if (isHeroType(t.type)) addMod(s, HEROES[t.type].perLevel, t.heroLevel - 1);
  s.damage *= mods.damageMul;
  s.abilityDamage *= mods.damageMul;
  // Higher ground reaches further.
  s.range *= mods.rangeMul * (1 + (HEIGHT.rangePerLevel + mods.heightRangeBonus) * t.height);
  s.pets = Math.floor(s.pets);
  s.shots = Math.max(1, Math.floor(s.shots));
  s.rate = Math.max(0.1, s.rate);
  s.chainFalloff = Math.min(1, s.chainFalloff);
  s.abilityCd = Math.max(5, s.abilityCd);
  return s;
}

/** Hit points from gold invested (or hero level) plus the tower's hp stat. */
export function maxHpOf(t: Pick<Tower, 'hero' | 'heroLevel' | 'invested' | 'stats'>): number {
  const base = t.hero
    ? TOWER_HP.heroBase + TOWER_HP.heroPerLevel * (t.heroLevel - 1)
    : TOWER_HP.base + TOWER_HP.perGold * t.invested;
  return Math.round(base + t.stats.hp);
}

/** Recomputes stats and hit points after an upgrade, level or skill, keeping damage taken. */
export function refreshStats(t: Tower, mods: Mods): void {
  t.stats = computeStats(t, mods);
  const lost = t.maxHp - t.hp;
  t.maxHp = maxHpOf(t);
  t.hp = Math.max(1, t.maxHp - lost);
}

export const price = (base: number, mods: Mods): number => Math.round(base * mods.costMul);
export const buildCost = (type: TowerId | HeroId, mods: Mods): number =>
  price(isHeroType(type) ? HEROES[type].cost : TOWERS[type].cost, mods);

/** Keep level a base tower type needs before it can be built. */
export const keepForTower = (type: TowerId): number => KEEP.tower[type] ?? 1;

export interface UpgradeOption {
  /** 'tier' for the linear tiers, otherwise the fork the option buys into or along. */
  path: 'tier' | 'a' | 'b';
  /** Level the tower reaches: tier 2..3, or fork tier 1..2. */
  level: number;
  cost: number;
  upgrade: Upgrade;
  /** Keep level this upgrade needs. */
  keep: number;
}

/** What the tower can buy next. Two options at the fork, one otherwise, none when finished or for heroes. */
export function upgradeOptions(t: Tower, mods: Mods): UpgradeOption[] {
  if (isHeroType(t.type)) return [];
  const d = TOWERS[t.type];
  if (t.tier < 3) {
    const u = d.tiers[t.tier - 1];
    return [{ path: 'tier', level: t.tier + 1, cost: price(u.cost, mods), upgrade: u, keep: KEEP.tier[t.tier] }];
  }
  if (!t.fork) {
    return (['a', 'b'] as const).map((f) => ({ path: f, level: 1, cost: price(d.forks[f][0].cost, mods), upgrade: d.forks[f][0], keep: KEEP.forkTier[0] }));
  }
  if (t.forkTier < 2) {
    const u = d.forks[t.fork][t.forkTier];
    return [{ path: t.fork, level: t.forkTier + 1, cost: price(u.cost, mods), upgrade: u, keep: KEEP.forkTier[t.forkTier] }];
  }
  return [];
}

/** Gold spent since the current wave started comes back in full (an undo); the rest at the sell rate. */
export const sellValue = (t: Tower, mods: Mods): number => t.fresh + Math.floor((t.invested - t.fresh) * mods.sellRefund);

// ---------------------------------------------------------------------------------------------
// Skill tree
// ---------------------------------------------------------------------------------------------

export type SkillState = 'learned' | 'available' | 'needsLevel' | 'needsKeep' | 'needsPrevious' | 'capstoneTaken' | 'tooExpensive';

export const skillCode = (branch: number, node: number): number => branch * 4 + node;
export const skillCost = (node: number, mods: Mods): number => price(HERO.nodeCost[node], mods);

export function skillState(s: RunState, t: Tower, branch: number, node: number): SkillState {
  if (t.skills.includes(skillCode(branch, node))) return 'learned';
  if (node > 0 && !t.skills.includes(skillCode(branch, node - 1))) return 'needsPrevious';
  if (node === 3 && t.skills.some((c) => c % 4 === 3)) return 'capstoneTaken';
  if (t.heroLevel < HERO.nodeLevel[node]) return 'needsLevel';
  if (s.keep < KEEP.skillNode[node]) return 'needsKeep';
  if (s.gold < skillCost(node, s.mods)) return 'tooExpensive';
  return 'available';
}

/** Gold to raise the keep one level, or 0 at the top. */
export const keepCost = (s: RunState): number => (s.keep >= KEEP.max ? 0 : price(KEEP.cost[s.keep], s.mods));

/** XP progress of a hero toward its next level, from 0 to 1. 1 at max level. */
export function heroProgress(t: Tower): number {
  if (t.heroLevel >= HERO.maxLevel) return 1;
  return Math.min(1, t.heroXp / heroXpNeed(t.heroLevel));
}
