// Damage, kills, spawning and hero experience. Shared by the step and by abilities.
import {
  DamageType, ENEMIES, EnemyId, HERO, heroXpNeed, MAP_BALANCE, RESIST_CAP, SHRED_CAP, SPECIAL, waveHpScale,
} from '../data/balance';
import { computeStats, isHeroType } from './stats';
import { Enemy, emit, pointAt, RunState, Tower } from './state';

const tmp = new Float64Array(3);

export function spawnEnemy(s: RunState, kind: EnemyId, path: number, wave: number, dist = 0): Enemy | null {
  const e = s.enemies.add();
  if (!e) return null;
  const def = ENEMIES[kind];
  const hpMul = (def.boss ? 1 : waveHpScale(wave)) * MAP_BALANCE[s.cfg.map].hpMul;
  e.uid = s.nextUid++;
  e.def = def;
  e.wave = wave;
  e.path = path % s.paths.length;
  e.dist = dist;
  e.lane = def.boss ? 0 : s.rng.range(-SPECIAL.laneSpread, SPECIAL.laneSpread);
  e.maxHp = e.hp = def.hp * hpMul;
  e.shield = 0;
  e.speed = def.speed * s.rng.range(0.95, 1.05);
  e.slow = 0; e.slowT = 0; e.stunT = 0; e.burnDps = 0; e.burnT = 0; e.shred = 0;
  e.flash = 0; e.dead = false; e.lit = false; e.revealed = false;
  e.cdA = kind === 'weaver' ? SPECIAL.weaver.every * 0.5 : kind === 'longnight' ? SPECIAL.longnight.snuffEvery : 0;
  e.cdB = kind === 'longnight' ? SPECIAL.longnight.spawnEvery : 0;
  e.nextShed = 1 - SPECIAL.tallow.shedEvery;
  placeEnemy(s, e);
  e.px = e.x; e.py = e.y;
  s.waveLeft[wave] = (s.waveLeft[wave] ?? 0) + 1;
  if (def.boss) emit(s, 'boss', e.x, e.y, ENEMIES[kind].radius);
  return e;
}

export function placeEnemy(s: RunState, e: Enemy): void {
  pointAt(s.paths[e.path], e.dist, tmp);
  const a = tmp[2];
  e.x = tmp[0] - Math.sin(a) * e.lane;
  e.y = tmp[1] + Math.cos(a) * e.lane;
  e.angle = a;
}

export function resistOf(e: Enemy, type: DamageType): number {
  const r = type === 'pierce' ? e.def.armour - e.shred : e.def.ward;
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
  if (e.def.id === 'tallow') tallowShed(s, e);
  if (e.hp <= 0) kill(s, e, src);
  return d;
}

function tallowShed(s: RunState, e: Enemy): void {
  while (e.hp > 0 && e.hp / e.maxHp <= e.nextShed) {
    e.nextShed -= SPECIAL.tallow.shedEvery;
    for (let i = 0; i < SPECIAL.tallow.shedCount; i++) {
      spawnEnemy(s, SPECIAL.tallow.shed, e.path, e.wave, Math.max(0, e.dist - s.rng.range(0, 30)));
    }
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
  if (e.def.id === 'brood') {
    for (let i = 0; i < SPECIAL.brood.count; i++) {
      spawnEnemy(s, SPECIAL.brood.spawn, e.path, e.wave, Math.max(0, e.dist + s.rng.range(-SPECIAL.brood.spread, SPECIAL.brood.spread)));
    }
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
    if (isHeroType(t.type)) t.stats = computeStats(t, s.mods);
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
