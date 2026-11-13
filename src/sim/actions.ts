// Everything the player can do. Each action returns true if it happened.
import {
  AbilityKind, HERO, HEROES, HeroId, RUN, TowerId, WAVES, WORLD,
} from '../data/balance';
import { hurt, onHitEffects } from './combat';
import {
  buildCost, computeStats, isHeroType, sellValue, skillCode, skillCost, skillState, upgradeOptions,
} from './stats';
import { emit, emptyStats, RunState, TARGET_MODES, tileAt, Tower } from './state';

export const heroSlots = (s: RunState): number => s.cfg.heroes.length;

export type BuildCheck = 'ok' | 'blocked' | 'occupied' | 'gold' | 'heroTaken' | 'heroNotInLoadout' | 'over';

export function canBuild(s: RunState, type: TowerId | HeroId, tx: number, ty: number): BuildCheck {
  if (s.outcome) return 'over';
  const tile = tileAt(s, tx, ty);
  if (tile === 3) return 'occupied';
  if (tile !== 0) return 'blocked';
  if (isHeroType(type)) {
    if (!s.cfg.heroes.includes(type)) return 'heroNotInLoadout';
    if (s.heroesPlaced.includes(type)) return 'heroTaken';
  }
  if (s.gold < buildCost(type, s.mods)) return 'gold';
  return 'ok';
}

export function build(s: RunState, type: TowerId | HeroId, tx: number, ty: number): Tower | null {
  if (canBuild(s, type, tx, ty) !== 'ok') return null;
  const cost = buildCost(type, s.mods);
  const hero = isHeroType(type);
  const T = WORLD.tile;
  const t: Tower = {
    uid: s.nextUid++, type, hero, tx, ty, x: (tx + 0.5) * T, y: (ty + 0.5) * T,
    tier: 1, fork: 0, forkTier: 0, heroLevel: hero ? s.mods.heroStartLevel : 1, heroXp: 0, skills: [],
    stats: emptyStats(), cd: 0.3, abilityCd: 0, target: 'first', angle: -Math.PI / 2,
    invested: cost, kills: 0, dealt: 0, dimT: 0, snuffT: 0, lightNow: 0, buffDamage: 0, buffRate: 0,
    beamUid: 0, beamRamp: 1, beamX: 0, beamY: 0, fired: 1,
  };
  t.heroLevel = Math.min(t.heroLevel, HERO.maxLevel);
  t.stats = computeStats(t, s.mods);
  t.lightNow = t.stats.light;
  if (hero) {
    s.heroesPlaced.push(type);
    // Start with a short wait so the ability isn't spent by accident on placement.
    t.abilityCd = Math.min(10, t.stats.abilityCd);
  }
  s.gold -= cost;
  s.tiles[ty * WORLD.cols + tx] = 3;
  s.towers.push(t);
  emit(s, 'build', t.x, t.y, hero ? 1 : 0);
  return t;
}

export function findTower(s: RunState, uid: number): Tower | undefined {
  return s.towers.find((t) => t.uid === uid);
}

/** Buys the next tier. At the fork, `path` picks 'a' or 'b'. */
export function upgrade(s: RunState, uid: number, path?: 'a' | 'b'): boolean {
  const t = findTower(s, uid);
  if (!t || s.outcome) return false;
  const opts = upgradeOptions(t, s.mods);
  const opt = opts.length === 2 ? opts.find((o) => o.path === path) : opts[0];
  if (!opt || s.gold < opt.cost) return false;
  s.gold -= opt.cost;
  t.invested += opt.cost;
  if (opt.path === 'tier') t.tier++;
  else { t.fork = opt.path; t.forkTier++; }
  t.stats = computeStats(t, s.mods);
  emit(s, 'upgrade', t.x, t.y, t.tier + t.forkTier);
  return true;
}

export function sell(s: RunState, uid: number): boolean {
  const i = s.towers.findIndex((t) => t.uid === uid);
  if (i < 0 || s.outcome) return false;
  const t = s.towers[i];
  const value = sellValue(t, s.mods);
  s.gold += value;
  s.towers.splice(i, 1);
  s.tiles[t.ty * WORLD.cols + t.tx] = 0;
  // Its moths go with it.
  for (let m = s.moths.count - 1; m >= 0; m--) if (s.moths.items[m].owner === t) s.moths.removeAt(m);
  emit(s, 'sell', t.x, t.y, value);
  return true;
}

export function learnSkill(s: RunState, uid: number, branch: number, node: number): boolean {
  const t = findTower(s, uid);
  if (!t || !t.hero || s.outcome) return false;
  if (skillState(s, t, branch, node) !== 'available') return false;
  const cost = skillCost(node, s.mods);
  s.gold -= cost;
  t.invested += cost;
  t.skills.push(skillCode(branch, node));
  t.stats = computeStats(t, s.mods);
  emit(s, 'skill', t.x, t.y, branch, node);
  return true;
}

export function cycleTarget(s: RunState, uid: number): boolean {
  const t = findTower(s, uid);
  if (!t) return false;
  t.target = TARGET_MODES[(TARGET_MODES.indexOf(t.target) + 1) % TARGET_MODES.length];
  return true;
}

/** Starts the next wave now. Calling early pays gold for the time left on the countdown. */
export function callWave(s: RunState): boolean {
  if (s.outcome || s.wave >= RUN.waves) return false;
  // Only while the current wave has finished spawning (or before the first).
  if (!s.waiting && s.spawnIdx < s.spawns.length) return false;
  if (!s.waiting && s.nextIn > 0) {
    const bonus = Math.floor(s.nextIn * RUN.earlyBonusPerSec * s.mods.earlyMul);
    if (bonus > 0) { s.gold += bonus; s.goldEarned += bonus; emit(s, 'gold', 0, 0, bonus); }
  }
  startWave(s);
  return true;
}

export function startWave(s: RunState): void {
  s.waiting = false;
  s.wave++;
  s.waveT = 0;
  s.spawns.length = 0;
  s.spawnIdx = 0;
  const groups = WAVES[s.wave - 1] ?? [];
  let gi = 0;
  for (const [kind, count, gap, delay] of groups) {
    for (let i = 0; i < count; i++) s.spawns.push({ t: delay + i * gap, kind, path: gi + i });
    gi++;
  }
  s.spawns.sort((a, b) => a.t - b.t);
  s.waveLeft[s.wave] = (s.waveLeft[s.wave] ?? 0) + s.spawns.length;
  s.nextIn = RUN.waveGap;
  emit(s, 'wave', 0, 0, s.wave);
}

export const canCallWave = (s: RunState): boolean =>
  !s.outcome && s.wave < RUN.waves && (s.waiting || s.spawnIdx >= s.spawns.length);

// ---------------------------------------------------------------------------------------------
// Hero abilities
// ---------------------------------------------------------------------------------------------

export const ABILITY_INDEX: Record<AbilityKind, number> = { flare: 0, toll: 1, shatter: 2, vigil: 3, swarm: 4 };

export function useAbility(s: RunState, uid: number): boolean {
  const t = findTower(s, uid);
  if (!t || !t.hero || !isHeroType(t.type) || s.outcome || t.abilityCd > 0) return false;
  const kind = HEROES[t.type].ability;
  const st = t.stats;
  const dmgMul = 1 + t.buffDamage;
  const E = s.enemies;
  switch (kind) {
    case 'flare': case 'toll': {
      const r2 = st.abilityRadius * st.abilityRadius;
      const type = kind === 'flare' ? 'fire' : 'sound';
      for (let i = 0; i < E.count; i++) {
        const e = E.items[i];
        if (e.dead || (e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r2) continue;
        if (!e.def.boss) e.stunT = Math.max(e.stunT, st.abilityTime);
        hurt(s, e, st.abilityDamage * dmgMul, type, t);
        if (!e.dead && kind === 'toll') onHitEffects(s, e, t);
      }
      if (kind === 'flare' && st.poolDps > 0) addPool(s, t.x, t.y, st.abilityRadius * 0.6, st.poolDps * 2, st.poolTime, t);
      emit(s, 'ability', t.x, t.y, st.abilityRadius, ABILITY_INDEX[kind]);
      break;
    }
    case 'shatter': {
      const r = st.range * 1.5;
      // Pick the strongest enemies in reach without sorting the whole pool.
      const picked: number[] = [];
      for (let n = 0; n < st.abilityTargets; n++) {
        let best = -1;
        let bestHp = -1;
        for (let i = 0; i < E.count; i++) {
          const e = E.items[i];
          if (e.dead || picked.includes(i) || (e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r * r) continue;
          if (e.hp > bestHp) { bestHp = e.hp; best = i; }
        }
        if (best < 0) break;
        picked.push(best);
      }
      for (const i of picked) {
        const e = E.items[i];
        emit(s, 'chain', t.x, t.y, e.x, e.y, 1);
        hurt(s, e, st.abilityDamage * dmgMul, 'pierce', t);
      }
      emit(s, 'ability', t.x, t.y, r, ABILITY_INDEX[kind]);
      break;
    }
    case 'vigil':
      s.vigilT = st.abilityTime;
      s.vigilPower = st.abilityPower;
      emit(s, 'ability', t.x, t.y, 0, ABILITY_INDEX[kind]);
      break;
    case 'swarm':
      for (let i = 0; i < st.abilityTargets; i++) {
        const m = s.moths.add();
        if (!m) break;
        m.owner = t; m.ownerUid = t.uid; m.x = m.px = t.x; m.y = m.py = t.y;
        m.target = null; m.targetUid = 0; m.cd = 0; m.phase = (i / st.abilityTargets) * Math.PI * 2;
        m.life = st.abilityTime; m.temp = true;
      }
      emit(s, 'ability', t.x, t.y, 0, ABILITY_INDEX[kind]);
      break;
  }
  t.abilityCd = st.abilityCd;
  return true;
}

export function addPool(s: RunState, x: number, y: number, r: number, dps: number, life: number, owner: Tower | null): void {
  const p = s.pools.add();
  if (!p) return;
  p.x = x; p.y = y; p.r = r; p.dps = dps; p.life = life; p.t = 0; p.owner = owner;
}

/** Debug: jump to a later wave with gold to match. */
export function debugSkipTo(s: RunState, wave: number): void {
  s.wave = Math.max(0, Math.min(RUN.waves - 1, wave - 1));
  for (let i = 0; i <= s.wave; i++) s.waveLeft[i] = 0;
  s.gold += s.wave * 120;
  s.waiting = true;
}
