// A simple player for balance tests: plugs shortcut gaps, builds near the road (preferring high
// ground), upgrades, learns skills, and calls waves.
import { HEROES, HeroId, TowerId } from '../data/balance';
import { build, callWave, canBuild, canCallWave, learnSkill, upgrade, upgradeKeep, useAbility } from './actions';
import { hexDistance } from './hex';
import { FEATURE } from './mapgen';
import { buildCost, keepForTower, skillState, upgradeOptions } from './stats';
import { RunState } from './state';

export interface BotPlan {
  /** Towers to build, in rotation. */
  mix: TowerId[];
  /** Fork choice per tower type. */
  forks: Partial<Record<TowerId, 'a' | 'b'>>;
  /** Upgrade when the cheapest upgrade costs at most this × the next tower's price. */
  upgradeBias: number;
  /** Skill branch the hero follows first. */
  heroBranch: number;
  /** Plug the map's shortcut gaps with palisades. */
  plugGaps: boolean;
  /** Raise the keep once this many attacking towers stand (walls and heroes don't count), per level. */
  keepAt: [number, number];
  /** Learn hero skills only once this many attacking towers stand. */
  skillsAt: number;
}

export const DEFAULT_PLAN: BotPlan = {
  mix: ['archer', 'frost', 'catapult', 'archer', 'mage', 'shrine', 'aviary', 'catapult', 'archer', 'mage'],
  forks: { palisade: 'b', archer: 'b', catapult: 'a', frost: 'a', mage: 'a', aviary: 'a', shrine: 'a' },
  upgradeBias: 0.5,
  heroBranch: 0,
  plugGaps: true,
  keepAt: [5, 12],
  skillsAt: 7,
};

/** Buildable tiles off the road, ranked by how much road lies within 2.5 hexes, then by height. */
export function rankSpots(s: RunState): [number, number][] {
  const { cols, rows, height, feature } = s.terrain;
  const road: [number, number][] = [];
  for (let i = 0; i < height.length; i++) if (height[i] === 0) road.push([i % cols, Math.floor(i / cols)]);
  const spots: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (height[i] === 0 || feature[i] !== FEATURE.none) continue;
      let v = 0;
      for (const [rx, ry] of road) {
        if (Math.abs(ry - y) > 3) continue;
        const d = hexDistance(x, y, rx, ry);
        if (d <= 3) v += d <= 2 ? 1 : 0.4;
      }
      if (v > 0) spots.push({ x, y, v: v * (1 + 0.15 * height[i]) });
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
    // One palisade in the middle of each shortcut gap forces the long road.
    if (this.plan.plugGaps) {
      for (const gap of s.terrain.gaps) {
        const i = gap[Math.floor(gap.length / 2)];
        const x = i % s.terrain.cols;
        const y = Math.floor(i / s.terrain.cols);
        if (!s.occ[i] && canBuild(s, 'palisade', x, y) === 'ok') build(s, 'palisade', x, y);
      }
    }
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
        // Skills only once the defence stands; before that, gold goes to towers.
        if (this.defenders() < this.plan.skillsAt) continue;
        for (let n = 0; n < 4; n++) if (skillState(s, t, branch, n) === 'available') learnSkill(s, t.uid, branch, n);
      }
    }
    // Save for the keep once the defence has a few towers.
    const keepGoal = s.keep < 3 ? this.plan.keepAt[s.keep - 1] : Infinity;
    if (this.defenders() >= keepGoal) {
      if (!upgradeKeep(s)) { if (canCallWave(s) && (s.waiting || s.enemies.count === 0)) callWave(s); return; }
    }
    // Detection for Shadow Stalkers: one Watch Shrine (shrine tier 3) as soon as the keep allows it.
    if (keepForTower('shrine') <= s.keep && !s.towers.some((t) => !t.hero && t.stats.reveal > 0)) {
      const shrine = s.towers.find((t) => t.type === 'shrine');
      if (!shrine) {
        const spot = this.freeSpot('shrine');
        if (spot && !build(s, 'shrine', spot[0], spot[1])) return;
      } else if (!upgrade(s, shrine.uid)) {
        return;
      }
    }
    for (let guard = 0; guard < 8; guard++) {
      // Skip tower types the keep hasn't unlocked yet.
      let type = this.plan.mix[this.next % this.plan.mix.length];
      for (let k = 0; k < this.plan.mix.length && keepForTower(type) > s.keep; k++) type = this.plan.mix[++this.next % this.plan.mix.length];
      if (keepForTower(type) > s.keep) break;
      const cost = buildCost(type, s.mods);
      const up = this.cheapestUpgrade();
      const wantUpgrade = up && s.towers.length >= 4 && (up.cost <= cost * (1 + this.plan.upgradeBias) || !this.freeSpot(type));
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

  /** Towers that attack: not walls, not heroes. */
  private defenders(): number {
    return this.s.towers.filter((t) => !t.hero && t.type !== 'palisade').length;
  }

  private freeSpot(type: TowerId | HeroId): [number, number] | null {
    for (const [x, y] of this.spots) {
      const c = canBuild(this.s, type, x, y);
      if (c === 'ok' || c === 'gold') return [x, y];
    }
    return null;
  }

  private cheapestUpgrade(): { uid: number; cost: number; path?: 'a' | 'b' } | null {
    let best: { uid: number; cost: number; path?: 'a' | 'b' } | null = null;
    for (const t of this.s.towers) {
      if (t.type in HEROES || t.type === 'palisade') continue;
      const opts = upgradeOptions(t, this.s.mods);
      if (opts.length === 0 || opts[0].keep > this.s.keep) continue;
      const pick = opts.length === 2 ? opts.find((o) => o.path === (this.plan.forks[t.type as TowerId] ?? 'a')) ?? opts[0] : opts[0];
      if (!best || pick.cost < best.cost) best = { uid: t.uid, cost: pick.cost, path: pick.path === 'tier' ? undefined : pick.path };
    }
    return best;
  }
}

