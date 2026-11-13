// Everything the player can do. Each action returns true (or the new tower) if it happened.
import { AbilityKind, CLEAR, HERO, HEROES, HeroId, RUN, TowerId, WAVES } from '../data/balance';
import { hurt, onHitEffects } from './combat';
import { pixelToTile, tileCenter } from './hex';
import { FEATURE } from './mapgen';
import { rebuildFlow } from './path';
import {
  buildCost, computeStats, isHeroType, maxHpOf, refreshStats, sellValue, skillCode, skillCost, skillState, upgradeOptions,
} from './stats';
import { emit, emptyStats, inBoard, RunState, TARGET_MODES, tileIndex, Tower } from './state';

export type BuildCheck = 'ok' | 'offBoard' | 'blocked' | 'gate' | 'occupied' | 'enemy' | 'gold' | 'heroTaken' | 'heroNotInLoadout' | 'over';

/** Why a tower can or can't go on a tile. Forest, rocks, gates and the keep can't be built on. */
export function canBuild(s: RunState, type: TowerId | HeroId, col: number, row: number): BuildCheck {
  if (s.outcome) return 'over';
  if (!inBoard(s, col, row)) return 'offBoard';
  const i = tileIndex(s, col, row);
  if (s.occ[i]) return 'occupied';
  if (s.terrain.feature[i] !== FEATURE.none) return 'blocked';
  const { spawns, goal } = s.terrain;
  if ((goal[0] === col && goal[1] === row) || spawns.some(([x, y]) => x === col && y === row)) return 'gate';
  if (isHeroType(type)) {
    if (!s.cfg.heroes.includes(type)) return 'heroNotInLoadout';
    if (s.heroesPlaced.includes(type)) return 'heroTaken';
  }
  if (s.terrain.height[i] === 0 && enemyOnTile(s, col, row)) return 'enemy';
  if (s.gold < buildCost(type, s.mods)) return 'gold';
  return 'ok';
}

function enemyOnTile(s: RunState, col: number, row: number): boolean {
  const E = s.enemies;
  const { cols, rows } = s.terrain;
  for (let k = 0; k < E.count; k++) {
    const e = E.items[k];
    if (e.dead || e.def.flying) continue;
    const t = pixelToTile(e.x, e.y, cols, rows);
    if (t && t.col === col && t.row === row) return true;
  }
  return false;
}

export function build(s: RunState, type: TowerId | HeroId, col: number, row: number): Tower | null {
  if (canBuild(s, type, col, row) !== 'ok') return null;
  const cost = buildCost(type, s.mods);
  const hero = isHeroType(type);
  const c = tileCenter(col, row);
  const i = tileIndex(s, col, row);
  const t: Tower = {
    uid: s.nextUid++, type, hero, tx: col, ty: row, height: s.terrain.height[i], x: c.x, y: c.y,
    tier: 1, fork: 0, forkTier: 0, heroLevel: hero ? Math.min(HERO.maxLevel, s.mods.heroStartLevel) : 1, heroXp: 0, skills: [],
    stats: emptyStats(), hp: 1, maxHp: 1, cd: 0.3, abilityCd: 0, target: 'first', angle: -Math.PI / 2,
    invested: cost, kills: 0, dealt: 0, jinxT: 0, silenceT: 0, buffDamage: 0, buffRate: 0,
    beamUid: 0, beamRamp: 1, beamX: 0, beamY: 0, fired: 1, hurt: 9,
  };
  t.stats = computeStats(t, s.mods);
  t.hp = t.maxHp = maxHpOf(t);
  if (hero) {
    s.heroesPlaced.push(type);
    // A short wait so the ability isn't spent by accident on placement.
    t.abilityCd = Math.min(10, t.stats.abilityCd);
  }
  s.gold -= cost;
  s.occ[i] = t.uid;
  s.towers.push(t);
  if (t.height === 0) rebuildFlow(s);
  emit(s, 'build', t.x, t.y, hero ? 1 : 0);
  return t;
}

/** Gold to clear the forest or rocks on a tile, or 0 if there's nothing to clear. */
export function clearCost(s: RunState, col: number, row: number): number {
  if (!inBoard(s, col, row)) return 0;
  const i = tileIndex(s, col, row);
  const f = s.terrain.feature[i];
  if (f === FEATURE.none) return 0;
  const base = f === FEATURE.forest ? CLEAR.forest : CLEAR.rocks;
  return Math.round(base * (1 + CLEAR.perHeight * s.terrain.height[i]) * s.mods.costMul);
}

export type ClearCheck = 'ok' | 'nothing' | 'gold' | 'over';

export function canClear(s: RunState, col: number, row: number): ClearCheck {
  if (s.outcome) return 'over';
  const cost = clearCost(s, col, row);
  if (cost === 0) return 'nothing';
  return s.gold >= cost ? 'ok' : 'gold';
}

/** Pays to remove forest or rocks from a tile so a tower can be built there. */
export function clearTile(s: RunState, col: number, row: number): boolean {
  if (canClear(s, col, row) !== 'ok') return false;
  const cost = clearCost(s, col, row);
  const i = tileIndex(s, col, row);
  const f = s.terrain.feature[i];
  s.gold -= cost;
  s.terrain.feature[i] = FEATURE.none;
  s.terrainVersion++;
  const c = tileCenter(col, row);
  emit(s, 'clear', c.x, c.y, f, cost);
  return true;
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
  refreshStats(t, s.mods);
  emit(s, 'upgrade', t.x, t.y, t.tier + t.forkTier);
  return true;
}

/** Removes a tower from the board, with no refund. Used for selling and for smashed towers. */
function removeTower(s: RunState, t: Tower): void {
  const i = s.towers.indexOf(t);
  if (i < 0) return;
  s.towers.splice(i, 1);
  s.occ[tileIndex(s, t.tx, t.ty)] = 0;
  if (t.hero) s.heroesPlaced = s.heroesPlaced.filter((h) => h !== t.type);
  for (let m = s.pets.count - 1; m >= 0; m--) if (s.pets.items[m].owner === t) s.pets.removeAt(m);
  if (t.height === 0) rebuildFlow(s);
}

export function sell(s: RunState, uid: number): boolean {
  const t = findTower(s, uid);
  if (!t || s.outcome) return false;
  const value = sellValue(t, s.mods);
  s.gold += value;
  removeTower(s, t);
  emit(s, 'sell', t.x, t.y, value);
  return true;
}

/** A tower smashed by enemies. Heroes can be placed again, from level 1 of their start level. */
export function destroyTower(s: RunState, t: Tower): void {
  removeTower(s, t);
  emit(s, 'destroyed', t.x, t.y, t.hero ? 1 : 0);
}

export function learnSkill(s: RunState, uid: number, branch: number, node: number): boolean {
  const t = findTower(s, uid);
  if (!t || !t.hero || s.outcome) return false;
  if (skillState(s, t, branch, node) !== 'available') return false;
  const cost = skillCost(node, s.mods);
  s.gold -= cost;
  t.invested += cost;
  t.skills.push(skillCode(branch, node));
  refreshStats(t, s.mods);
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
  if (!canCallWave(s)) return false;
  if (!s.waiting && s.nextIn > 0) {
    const bonus = earlyBonus(s);
    if (bonus > 0) { s.gold += bonus; s.goldEarned += bonus; emit(s, 'gold', 0, 0, bonus); }
  }
  startWave(s);
  return true;
}

/** Gold for calling the next wave now; 0 when a call isn't possible or pays nothing. */
export const earlyBonus = (s: RunState): number =>
  s.waiting || !canCallWave(s) ? 0 : Math.floor(Math.max(0, s.nextIn) * RUN.earlyBonusPerSec * s.mods.earlyMul);

export const canCallWave = (s: RunState): boolean =>
  !s.outcome && s.wave < RUN.waves && (s.waiting || s.spawnIdx >= s.spawns.length);

export function startWave(s: RunState): void {
  s.waiting = false;
  s.wave++;
  s.waveT = 0;
  s.spawns.length = 0;
  s.spawnIdx = 0;
  const groups = WAVES[s.wave - 1] ?? [];
  let gi = 0;
  for (const [kind, count, gap, delay] of groups) {
    for (let i = 0; i < count; i++) s.spawns.push({ t: delay + i * gap, kind, gate: gi + i });
    gi++;
  }
  s.spawns.sort((a, b) => a.t - b.t);
  s.waveLeft[s.wave] = (s.waveLeft[s.wave] ?? 0) + s.spawns.length;
  s.nextIn = RUN.waveGap;
  emit(s, 'wave', 0, 0, s.wave);
}

// ---------------------------------------------------------------------------------------------
// Hero abilities
// ---------------------------------------------------------------------------------------------

export const ABILITY_INDEX: Record<AbilityKind, number> = { charge: 0, sanctify: 1, barrage: 2, rally: 3, wildhunt: 4 };

export function useAbility(s: RunState, uid: number): boolean {
  const t = findTower(s, uid);
  if (!t || !t.hero || !isHeroType(t.type) || s.outcome || t.abilityCd > 0) return false;
  const kind = HEROES[t.type].ability;
  const st = t.stats;
  const dmgMul = 1 + t.buffDamage;
  const E = s.enemies;
  switch (kind) {
    case 'charge': case 'sanctify': {
      const r2 = st.abilityRadius * st.abilityRadius;
      const type = kind === 'charge' ? 'physical' : 'magic';
      const n = E.count;
      for (let i = 0; i < n; i++) {
        const e = E.items[i];
        if (e.dead || (e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r2) continue;
        if (!e.def.boss) e.stunT = Math.max(e.stunT, st.abilityTime);
        hurt(s, e, st.abilityDamage * dmgMul, type, t);
        if (!e.dead && kind === 'sanctify') onHitEffects(s, e, t);
      }
      if (kind === 'charge' && st.poolDps > 0) addPool(s, t.x, t.y, st.abilityRadius * 0.6, st.poolDps * 2, st.poolTime, t);
      emit(s, 'ability', t.x, t.y, st.abilityRadius, ABILITY_INDEX[kind]);
      break;
    }
    case 'barrage': {
      const r = st.range * 1.5;
      // Pick the strongest enemies in reach without sorting the whole pool.
      const picked: number[] = [];
      for (let k = 0; k < st.abilityTargets; k++) {
        let best = -1;
        let bestHp = -1;
        for (let i = 0; i < E.count; i++) {
          const e = E.items[i];
          if (e.dead || picked.includes(i) || (e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r * r) continue;
          if (e.def.stealth && !e.revealed) continue;
          if (e.hp > bestHp) { bestHp = e.hp; best = i; }
        }
        if (best < 0) break;
        picked.push(best);
      }
      for (const i of picked) {
        const e = E.items[i];
        emit(s, 'chain', t.x, t.y, e.x, e.y, 1);
        hurt(s, e, st.abilityDamage * dmgMul, 'magic', t);
      }
      emit(s, 'ability', t.x, t.y, r, ABILITY_INDEX[kind]);
      break;
    }
    case 'rally':
      s.rallyT = st.abilityTime;
      s.rallyPower = st.abilityPower;
      emit(s, 'ability', t.x, t.y, 0, ABILITY_INDEX[kind]);
      break;
    case 'wildhunt':
      for (let i = 0; i < st.abilityTargets; i++) {
        const m = s.pets.add();
        if (!m) break;
        m.owner = t; m.x = m.px = t.x; m.y = m.py = t.y;
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
  s.gold += s.wave * 150;
  s.waiting = true;
}
