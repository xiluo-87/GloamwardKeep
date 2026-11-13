// A simple player for balance tests: builds near the path, upgrades, and calls waves.
import { HEROES, HeroId, TowerId, WORLD } from '../data/balance';
import { build, callWave, canBuild, canCallWave, learnSkill, upgrade, useAbility } from './actions';
import { buildCost, skillState, upgradeOptions } from './stats';
import { RunState, tileAt } from './state';

export interface BotPlan {
  /** Towers to build, in rotation. */
  mix: TowerId[];
  /** Fork choice per tower type. */
  forks: Partial<Record<TowerId, 'a' | 'b'>>;
  /** Fraction of spare gold spent on upgrades rather than new towers. */
  upgradeBias: number;
  /** Skill branch the hero follows first. */
  heroBranch: number;
}

export const DEFAULT_PLAN: BotPlan = {
  mix: ['wick', 'bell', 'kiln', 'wick', 'prism', 'lamp', 'moth', 'kiln', 'wick', 'prism'],
  forks: { wick: 'b', kiln: 'a', bell: 'a', prism: 'a', moth: 'a', lamp: 'a' },
  upgradeBias: 0.5,
  heroBranch: 0,
};

/** Free tiles ranked by how much path lies within 2.5 tiles of them. */
export function rankSpots(s: RunState): [number, number][] {
  const spots: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < WORLD.rows; y++) {
    for (let x = 0; x < WORLD.cols; x++) {
      if (tileAt(s, x, y) !== 0) continue;
      let v = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 6.25) continue;
        if (tileAt(s, x + dx, y + dy) === 1) v++;
      }
      if (v > 0) spots.push({ x, y, v });
    }
  }
  spots.sort((a, b) => b.v - a.v || a.y - b.y || a.x - b.x);
  return spots.map((p) => [p.x, p.y]);
}

export class Bot {
  private spots: [number, number][];
  private next = 0;
  private think = 0;
  constructor(private s: RunState, private plan: BotPlan = DEFAULT_PLAN) {
    this.spots = rankSpots(s);
  }

  update(dt: number): void {
    const s = this.s;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.5;
    // Heroes first, on the best spots.
    for (const h of s.cfg.heroes) {
      if (s.heroesPlaced.includes(h)) continue;
      const spot = this.freeSpot(h);
      if (spot) build(s, h, spot[0], spot[1]);
    }
    for (const t of s.towers) {
      if (!t.hero) continue;
      if (t.abilityCd <= 0 && s.enemies.count > 6) useAbility(s, t.uid);
      for (let b = 0; b < 3; b++) {
        const branch = (this.plan.heroBranch + b) % 3;
        for (let n = 0; n < 4; n++) if (skillState(s, t, branch, n) === 'available') learnSkill(s, t.uid, branch, n);
      }
    }
    // Alternate between upgrading the cheapest option and building the next tower in the mix.
    for (let guard = 0; guard < 8; guard++) {
      const type = this.plan.mix[this.next % this.plan.mix.length];
      const cost = buildCost(type, s.mods);
      const up = this.cheapestUpgrade();
      const wantUpgrade = up && (s.towers.length >= 4) && (up.cost <= cost * (1 + this.plan.upgradeBias) || this.spotsLeft() === 0);
      if (wantUpgrade && up && s.gold >= up.cost) {
        upgrade(s, up.uid, up.path);
        continue;
      }
      if (!wantUpgrade && s.gold >= cost) {
        const spot = this.freeSpot(type);
        if (spot && build(s, type, spot[0], spot[1])) { this.next++; continue; }
      }
      break;
    }
    if (canCallWave(s) && (s.waiting || s.enemies.count === 0)) callWave(s);
  }

  private spotsLeft(): number {
    return this.spots.filter(([x, y]) => tileAt(this.s, x, y) === 0).length;
  }

  private freeSpot(type: TowerId | HeroId): [number, number] | null {
    for (const [x, y] of this.spots) {
      const c = canBuild(this.s, type, x, y);
      if (c === 'ok' || c === 'gold') return c === 'ok' ? [x, y] : null;
    }
    return null;
  }

  private cheapestUpgrade(): { uid: number; cost: number; path?: 'a' | 'b' } | null {
    let best: { uid: number; cost: number; path?: 'a' | 'b' } | null = null;
    for (const t of this.s.towers) {
      if (t.type in HEROES) continue;
      const opts = upgradeOptions(t, this.s.mods);
      if (opts.length === 0) continue;
      const pick = opts.length === 2 ? opts.find((o) => o.path === (this.plan.forks[t.type as TowerId] ?? 'a')) ?? opts[0] : opts[0];
      if (!best || pick.cost < best.cost) best = { uid: t.uid, cost: pick.cost, path: pick.path === 'tier' ? undefined : pick.path };
    }
    return best;
  }
}
