// Damage, kills, spawning and hero experience. Shared by the step and by abilities.
import {
  DamageType, ENEMIES, EnemyId, HERO, heroXpNeed, MAP_BALANCE, RESIST_CAP, SHRED_CAP, SPECIAL, waveHpScale,
} from '../data/balance';
import { HEX_W, tileCenter } from './hex';
import { isHeroType, refreshStats } from './stats';
import { Enemy, emit, RunState, Tower } from './state';

function initEnemy(s: RunState, e: Enemy, kind: EnemyId, wave: number): void {
  const def = ENEMIES[kind];
  const hpMul = (def.boss ? 1 : waveHpScale(wave)) * MAP_BALANCE[s.cfg.map].hpMul;
  e.uid = s.nextUid++;
  e.def = def;
  e.wave = wave;
  e.maxHp = e.hp = def.hp * hpMul;
  e.shield = 0;
  e.speed = def.speed * s.rng.range(0.95, 1.05);
  e.slow = 0; e.slowT = 0; e.stunT = 0; e.burnDps = 0; e.burnT = 0; e.shred = 0;
  e.flash = 0; e.dead = false; e.revealed = false; e.smashing = 0;
  e.vx = 0; e.vy = 0;
  const spread = def.boss ? 0 : SPECIAL.laneSpread;
  e.ox = s.rng.range(-spread, spread);
  e.oy = s.rng.range(-spread, spread) * 0.6;
  e.cdA = kind === 'shaman' ? SPECIAL.shaman.every * 0.5 : kind === 'lich' ? SPECIAL.lich.silenceEvery : 0;
  e.cdB = kind === 'lich' ? SPECIAL.lich.spawnEvery : 0;
  e.nextShed = 1 - SPECIAL.ogreking.shedEvery;
  s.waveLeft[wave] = (s.waveLeft[wave] ?? 0) + 1;
  if (def.boss) emit(s, 'boss', e.x, e.y, def.radius);
}

/** Spawns an enemy just outside a gate, walking onto the board. */
export function spawnAtGate(s: RunState, kind: EnemyId, gate: number, wave: number): Enemy | null {
  const e = s.enemies.add();
  if (!e) return null;
  const [gx, gy] = s.terrain.spawns[gate % s.terrain.spawns.length];
  const c = tileCenter(gx, gy);
  e.x = e.px = c.x - HEX_W;
  e.y = e.py = c.y;
  e.next = gy * s.terrain.cols + gx;
  e.flowVersion = s.flowVersion;
  e.dist = s.flow[e.next] + 1;
  initEnemy(s, e, kind, wave);
  return e;
}

/** Spawns an enemy at a point, heading where `from` was heading (wagons, ogre sheds, lich summons). */
export function spawnNear(s: RunState, kind: EnemyId, from: Enemy, spread: number): Enemy | null {
  const e = s.enemies.add();
  if (!e) return null;
  e.x = e.px = from.x + s.rng.range(-spread, spread);
  e.y = e.py = from.y + s.rng.range(-spread, spread);
  e.next = from.next;
  e.flowVersion = -1;
  e.dist = from.dist;
  initEnemy(s, e, kind, from.wave);
  return e;
}

export function resistOf(e: Enemy, type: DamageType): number {
  const r = type === 'physical' ? e.def.armour - e.shred : e.def.ward;
  return r < 0 ? 0 : r > RESIST_CAP ? RESIST_CAP : r;
}

/** Deals damage after resistances and shields. Returns damage dealt to HP. */
export function hurt(s: RunState, e: Enemy, amount: number, type: DamageType, src: Tower | null): number {
  if (e.dead || amount <= 0) return 0;
  let d = amount * (1 - resistOf(e, type));
  if (e.shield > 0) {
    const absorbed = Math.min(e.shield, d);
    e.shield -= absorbed;
    d -= absorbed;
  }
  if (d <= 0) return 0;
  e.hp -= d;
  e.flash = 0.08;
  if (src) src.dealt += d;
  if (e.def.id === 'ogreking') ogreShed(s, e);
  if (e.hp <= 0) kill(s, e, src);
  return d;
}

function ogreShed(s: RunState, e: Enemy): void {
  const O = SPECIAL.ogreking;
  while (e.hp > 0 && e.hp / e.maxHp <= e.nextShed) {
    e.nextShed -= O.shedEvery;
    for (let i = 0; i < O.shedCount; i++) spawnNear(s, O.shed, e, 14);
    emit(s, 'shed', e.x, e.y);
  }
}

export function kill(s: RunState, e: Enemy, src: Tower | null): void {
  if (e.dead) return;
  e.dead = true;
  e.hp = 0;
  s.kills++;
  let bounty = 0;
  for (const t of s.towers) bounty += t.stats.bounty;
  const gold = Math.round(e.def.gold * s.mods.goldMul * (1 + bounty));
  s.gold += gold;
  s.goldEarned += gold;
  emit(s, 'kill', e.x, e.y, gold, e.def.radius, e.def.boss ? 1 : 0);
  if (src) src.kills++;
  giveXp(s, e.def.xp, src);
  if (e.def.id === 'wagon') {
    for (let i = 0; i < SPECIAL.wagon.count; i++) spawnNear(s, SPECIAL.wagon.spawn, e, SPECIAL.wagon.spread);
  }
}

export function giveXp(s: RunState, xp: number, src: Tower | null): void {
  for (const t of s.towers) {
    if (!t.hero) continue;
    const share = t === src ? 1 : HERO.share;
    addHeroXp(s, t, xp * share * s.mods.heroXpMul);
  }
}

export function addHeroXp(s: RunState, t: Tower, xp: number): void {
  if (t.heroLevel >= HERO.maxLevel) return;
  t.heroXp += xp;
  while (t.heroLevel < HERO.maxLevel && t.heroXp >= heroXpNeed(t.heroLevel)) {
    t.heroXp -= heroXpNeed(t.heroLevel);
    t.heroLevel++;
    if (isHeroType(t.type)) refreshStats(t, s.mods);
    emit(s, 'heroLevel', t.x, t.y, t.heroLevel);
  }
  if (t.heroLevel >= HERO.maxLevel) t.heroXp = 0;
}

/** Applies a tower's on-hit effects (slow, stun, burn, shred) after damage. */
export function onHitEffects(s: RunState, e: Enemy, t: Tower): void {
  if (e.dead) return;
  const st = t.stats;
  if (st.slow > 0 && !e.def.boss) {
    if (st.slow >= e.slow || e.slowT <= 0) { e.slow = st.slow; e.slowT = Math.max(e.slowT, st.slowTime); }
  }
  if (st.stunChance > 0 && !e.def.boss && s.rng.chance(st.stunChance)) e.stunT = Math.max(e.stunT, st.stun);
  if (st.burnDps > 0) {
    e.burnDps = Math.max(e.burnDps, st.burnDps * (1 + t.buffDamage));
    e.burnT = Math.max(e.burnT, st.burnTime);
  }
  if (st.shred > 0) e.shred = Math.min(SHRED_CAP, e.shred + st.shred);
}
