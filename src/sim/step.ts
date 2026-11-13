// One fixed simulation step. No DOM or canvas here, so it runs in tests.
import {
  BEAM, MAP_BALANCE, PROFILE, PROJECTILE, RUN, SPECIAL, STEP, waveBonus, waveHpScale,
} from '../data/balance';
import { addPool, startWave } from './actions';
import { hurt, onHitEffects, placeEnemy, spawnEnemy } from './combat';
import { dmgTypeOf, kindOf } from './stats';
import { emit, Enemy, pointAt, RunState, Tower } from './state';

const tmp = new Float64Array(3);
const chosen: Enemy[] = [];
const hitList: Enemy[] = [];

export function clearEvents(s: RunState): void {
  s.eventCount = 0;
}

export function stepRun(s: RunState, dt = STEP): void {
  if (s.outcome) return;
  s.t += dt;
  waves(s, dt);
  lights(s, dt);
  moveEnemies(s, dt);
  towersAct(s, dt);
  projectiles(s, dt);
  moths(s, dt);
  burnPools(s, dt);
  sweep(s);
  if (s.lives <= 0) {
    s.lives = 0;
    s.outcome = 'lost';
    emit(s, 'lose');
  } else if (s.wave >= RUN.waves && s.spawnIdx >= s.spawns.length && s.enemies.count === 0) {
    s.outcome = 'won';
    emit(s, 'win');
  }
}

// ---------------------------------------------------------------------------------------------

function waves(s: RunState, dt: number): void {
  if (s.waiting || s.wave === 0) return;
  s.waveT += dt;
  while (s.spawnIdx < s.spawns.length && s.spawns[s.spawnIdx].t <= s.waveT) {
    const sp = s.spawns[s.spawnIdx++];
    spawnEnemy(s, sp.kind, sp.path, s.wave);
    // startWave already counted this spawn, so the wave can't read as clear before it finishes.
    s.waveLeft[s.wave]--;
  }
  if (s.spawnIdx >= s.spawns.length && s.wave < RUN.waves) {
    s.nextIn -= dt;
    if (s.nextIn <= 0) startWave(s);
  }
}

function waveCleared(s: RunState, wave: number): void {
  s.cleared++;
  let income = 0;
  let regen = 0;
  for (const t of s.towers) { income += t.stats.income; regen += t.stats.lifeRegen; }
  const interest = Math.min(s.mods.interestCap, Math.floor(s.gold * s.mods.interest));
  const gold = waveBonus(wave) + Math.round(income) + interest;
  s.gold += gold;
  s.goldEarned += gold;
  if (regen > 0) s.lives = Math.min(s.mods.lives, s.lives + regen);
  emit(s, 'waveClear', 0, 0, wave, gold);
}

/** Profile XP the run has earned so far. */
export function runXp(s: RunState): number {
  let xp = 0;
  for (let w = 1; w <= s.cleared; w++) xp += PROFILE.xpPerWave + PROFILE.xpPerWaveGrowth * w;
  if (s.outcome === 'won') xp += PROFILE.victoryXp;
  return Math.round(xp * MAP_BALANCE[s.cfg.map].xpMul);
}

// ---------------------------------------------------------------------------------------------

function lights(s: RunState, dt: number): void {
  const T = s.towers;
  if (s.vigilT > 0) s.vigilT -= dt;
  for (const t of T) {
    t.dimT -= dt;
    t.snuffT -= dt;
    t.fired += dt;
    if (t.hero) t.abilityCd = Math.max(0, t.abilityCd - dt);
    let light = t.stats.light;
    if (t.snuffT > 0) light = 0;
    else if (t.dimT > 0 && !t.stats.dimImmune) light *= 1 - SPECIAL.snuffer.dimAmount;
    t.lightNow = light;
    t.buffDamage = 0;
    t.buffRate = s.vigilT > 0 ? s.vigilPower : 0;
  }
  for (const src of T) {
    const st = src.stats;
    if (st.buffDamage <= 0 && st.buffRate <= 0) continue;
    const r2 = src.lightNow * src.lightNow;
    for (const t of T) {
      if (t === src || (t.x - src.x) ** 2 + (t.y - src.y) ** 2 > r2) continue;
      t.buffDamage += st.buffDamage;
      t.buffRate += st.buffRate;
    }
  }
  const E = s.enemies;
  for (let i = 0; i < E.count; i++) {
    const e = E.items[i];
    e.lit = false;
    e.revealed = false;
    for (const t of T) {
      const r = t.lightNow + e.def.radius * 0.5;
      if ((e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r * r) continue;
      e.lit = true;
      if (t.stats.reveal > 0) { e.revealed = true; break; }
    }
  }
}

function moveEnemies(s: RunState, dt: number): void {
  const E = s.enemies;
  // Spawns during the loop (brood, sheds) land at the end and move next step.
  const n = E.count;
  for (let i = 0; i < n; i++) {
    const e = E.items[i];
    if (e.dead) continue;
    e.px = e.x;
    e.py = e.y;
    if (e.flash > 0) e.flash -= dt;
    if (e.burnT > 0) {
      e.burnT -= dt;
      hurt(s, e, e.burnDps * dt, 'fire', null);
      if (e.burnT <= 0) e.burnDps = 0;
      if (e.dead) continue;
    }
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
    if (e.stunT > 0) e.stunT -= dt;
    else e.dist += e.speed * (1 - e.slow) * dt;
    const path = s.paths[e.path];
    if (e.dist >= path.length) {
      e.dead = true;
      s.lives -= e.def.lives;
      s.leaked += e.def.lives;
      emit(s, 'leak', e.x, e.y, e.def.lives);
      continue;
    }
    placeEnemy(s, e);
    special(s, e, dt);
  }
}

function special(s: RunState, e: Enemy, dt: number): void {
  switch (e.def.id) {
    case 'snuffer': {
      const { dimRadius, dimTime } = SPECIAL.snuffer;
      for (const t of s.towers) {
        if (t.stats.dimImmune || (t.x - e.x) ** 2 + (t.y - e.y) ** 2 > dimRadius * dimRadius) continue;
        if (t.dimT <= 0) emit(s, 'dim', t.x, t.y);
        t.dimT = dimTime;
      }
      break;
    }
    case 'weaver': {
      e.cdA -= dt;
      if (e.cdA > 0) break;
      const W = SPECIAL.weaver;
      e.cdA = W.every;
      const amount = W.shield * waveHpScale(e.wave) * MAP_BALANCE[s.cfg.map].hpMul;
      const E = s.enemies;
      for (let j = 0; j < E.count; j++) {
        const o = E.items[j];
        if (o === e || o.dead || o.def.boss || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > W.radius * W.radius) continue;
        o.shield = Math.min(o.maxHp * W.shieldCap, o.shield + amount);
      }
      emit(s, 'shield', e.x, e.y, W.radius);
      break;
    }
    case 'longnight': {
      const L = SPECIAL.longnight;
      e.cdA -= dt;
      e.cdB -= dt;
      if (e.cdA <= 0) {
        e.cdA = L.snuffEvery;
        for (const t of s.towers) {
          if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= L.snuffRadius * L.snuffRadius) t.snuffT = L.snuffTime;
        }
        emit(s, 'snuff', e.x, e.y, L.snuffRadius);
      }
      if (e.cdB <= 0) {
        e.cdB = L.spawnEvery;
        for (let k = 0; k < L.spawnCount; k++) spawnEnemy(s, L.spawn, e.path, e.wave, Math.max(0, e.dist - 20 - k * 12));
      }
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------------------------

function canSee(e: Enemy, t: Tower): boolean {
  return !e.dead && e.lit && (!e.def.stealth || e.revealed) && (!e.def.flying || t.stats.hitsFlying > 0);
}

/** Best target for a tower within `range` of (x, y), skipping enemies already in `skip`. */
function pickTarget(s: RunState, t: Tower, x: number, y: number, range: number, skip: Enemy[] | null): Enemy | null {
  const E = s.enemies;
  let best: Enemy | null = null;
  let score = -Infinity;
  for (let i = 0; i < E.count; i++) {
    const e = E.items[i];
    if (!canSee(e, t)) continue;
    const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
    const r = range + e.def.radius;
    if (d2 > r * r) continue;
    if (skip && skip.includes(e)) continue;
    let v: number;
    switch (t.target) {
      case 'first': v = e.dist; break;
      case 'last': v = -e.dist; break;
      case 'strong': v = e.hp + e.shield; break;
      default: v = -d2; break;
    }
    if (v > score) { score = v; best = e; }
  }
  return best;
}

const critOf = (s: RunState, t: Tower): number => (t.stats.crit > 0 && s.rng.chance(t.stats.crit) ? Math.max(1, t.stats.critMul) : 1);

function towersAct(s: RunState, dt: number): void {
  for (const t of s.towers) {
    const st = t.stats;
    const kind = kindOf(t);
    if (kind === 'aura') continue;
    if (kind === 'summon') { keepMoths(s, t); continue; }
    if (kind === 'chain' && st.beam > 0) { beam(s, t, dt); continue; }
    t.cd -= dt;
    if (t.cd > 0) continue;
    const dmg = st.damage * (1 + t.buffDamage);
    let fired = false;
    switch (kind) {
      case 'bolt': fired = bolt(s, t, dmg); break;
      case 'lob': fired = lob(s, t, dmg); break;
      case 'pulse': fired = pulse(s, t, dmg); break;
      case 'chain': fired = chain(s, t, dmg); break;
      case 'lash': fired = lash(s, t, dmg); break;
      default: break;
    }
    if (fired) {
      t.cd = 1 / (st.rate * (1 + t.buffRate));
      t.fired = 0;
    } else {
      t.cd = 0;
    }
  }
}

function bolt(s: RunState, t: Tower, dmg: number): boolean {
  chosen.length = 0;
  for (let k = 0; k < t.stats.shots; k++) {
    const e = pickTarget(s, t, t.x, t.y, t.stats.range, chosen);
    if (!e) break;
    chosen.push(e);
  }
  if (chosen.length === 0) return false;
  for (let k = 0; k < t.stats.shots; k++) {
    const e = chosen[k % chosen.length];
    const p = s.projectiles.add();
    if (!p) break;
    p.kind = 'bolt';
    p.x = p.px = p.sx = t.x; p.y = p.py = p.sy = t.y - 14;
    p.tx = e.x; p.ty = e.y; p.t = 0; p.life = 3;
    p.target = e; p.targetUid = e.uid; p.owner = t; p.damage = dmg;
  }
  t.angle = Math.atan2(chosen[0].y - t.y, chosen[0].x - t.x);
  emit(s, 'shot', t.x, t.y, t.angle, t.uid);
  return true;
}

function lob(s: RunState, t: Tower, dmg: number): boolean {
  const e = pickTarget(s, t, t.x, t.y, t.stats.range, null);
  if (!e) return false;
  // Lead the target so slow coals still land on it.
  const travel = e.stunT > 0 ? 0 : e.speed * (1 - e.slow) * PROJECTILE.lobFlight;
  const path = s.paths[e.path];
  pointAt(path, Math.min(path.length, e.dist + travel), tmp);
  const a = tmp[2];
  const p = s.projectiles.add();
  if (!p) return false;
  p.kind = 'lob';
  p.x = p.px = p.sx = t.x; p.y = p.py = p.sy = t.y - 16;
  p.tx = tmp[0] - Math.sin(a) * e.lane; p.ty = tmp[1] + Math.cos(a) * e.lane;
  p.t = 0; p.life = PROJECTILE.lobFlight;
  p.target = null; p.targetUid = 0; p.owner = t; p.damage = dmg;
  t.angle = Math.atan2(p.ty - t.y, p.tx - t.x);
  emit(s, 'shot', t.x, t.y, t.angle, t.uid);
  return true;
}

/** Bells ring in the dark too: they don't need light, only something in reach. */
function pulse(s: RunState, t: Tower, dmg: number): boolean {
  const E = s.enemies;
  const r = t.stats.range;
  const flyers = t.stats.hitsFlying > 0;
  let any = false;
  for (let i = 0; i < E.count; i++) {
    const e = E.items[i];
    if (e.dead || (e.def.flying && !flyers)) continue;
    const rr = r + e.def.radius;
    if ((e.x - t.x) ** 2 + (e.y - t.y) ** 2 > rr * rr) continue;
    any = true;
    break;
  }
  if (!any) return false;
  const type = dmgTypeOf(t);
  const n = E.count;
  for (let i = 0; i < n; i++) {
    const e = E.items[i];
    if (e.dead || (e.def.flying && !flyers)) continue;
    const rr = r + e.def.radius;
    if ((e.x - t.x) ** 2 + (e.y - t.y) ** 2 > rr * rr) continue;
    hurt(s, e, dmg, type, t);
    onHitEffects(s, e, t);
  }
  emit(s, 'pulse', t.x, t.y, r, t.hero ? 1 : 0);
  return true;
}

function chain(s: RunState, t: Tower, dmg: number): boolean {
  const st = t.stats;
  const first = pickTarget(s, t, t.x, t.y, st.range, null);
  if (!first) return false;
  const type = dmgTypeOf(t);
  for (let shot = 0; shot < st.shots; shot++) {
    hitList.length = 0;
    let cur: Enemy | null = shot === 0 ? first : pickTarget(s, t, t.x, t.y, st.range, null);
    let fx = t.x;
    let fy = t.y - 16;
    let d = dmg;
    for (let j = 0; j <= st.chains && cur; j++) {
      hitList.push(cur);
      emit(s, 'chain', fx, fy, cur.x, cur.y, t.hero ? 1 : 0);
      fx = cur.x; fy = cur.y;
      hurt(s, cur, d * critOf(s, t), type, t);
      onHitEffects(s, cur, t);
      d *= st.chainFalloff;
      cur = pickTarget(s, t, fx, fy, st.chainRange, hitList);
    }
  }
  t.angle = Math.atan2(first.y - t.y, first.x - t.x);
  return true;
}

function lash(s: RunState, t: Tower, dmg: number): boolean {
  const mode = t.target;
  t.target = 'close';
  chosen.length = 0;
  for (let k = 0; k < Math.max(1, t.stats.cleave); k++) {
    const e = pickTarget(s, t, t.x, t.y, t.stats.range, chosen);
    if (!e) break;
    chosen.push(e);
  }
  t.target = mode;
  if (chosen.length === 0) return false;
  t.angle = Math.atan2(chosen[0].y - t.y, chosen[0].x - t.x);
  emit(s, 'lash', t.x, t.y, t.angle, t.stats.range);
  const type = dmgTypeOf(t);
  for (const e of chosen) {
    hurt(s, e, dmg * critOf(s, t), type, t);
    onHitEffects(s, e, t);
  }
  return true;
}

function beam(s: RunState, t: Tower, dt: number): void {
  const st = t.stats;
  let e: Enemy | null = null;
  if (t.beamUid) {
    const E = s.enemies;
    for (let i = 0; i < E.count; i++) {
      const o = E.items[i];
      if (o.uid !== t.beamUid) continue;
      const r = st.range + o.def.radius;
      if (canSee(o, t) && (o.x - t.x) ** 2 + (o.y - t.y) ** 2 <= r * r) e = o;
      break;
    }
  }
  if (!e) {
    e = pickTarget(s, t, t.x, t.y, st.range, null);
    t.beamRamp = 1;
    t.beamUid = e ? e.uid : 0;
  }
  if (!e) return;
  const dps = st.damage * (1 + t.buffDamage) * BEAM.dpsPerDamage * t.beamRamp;
  t.beamRamp = Math.min(Math.max(1, st.rampMax), t.beamRamp + st.ramp * dt);
  t.beamX = e.x;
  t.beamY = e.y;
  t.angle = Math.atan2(e.y - t.y, e.x - t.x);
  t.fired = 0;
  hurt(s, e, dps * dt, 'fire', t);
  if (st.shred > 0 && !e.dead) onHitEffects(s, e, t);
}

// ---------------------------------------------------------------------------------------------

function projectiles(s: RunState, dt: number): void {
  const P = s.projectiles;
  for (let i = P.count - 1; i >= 0; i--) {
    const p = P.items[i];
    p.px = p.x;
    p.py = p.y;
    p.t += dt;
    if (p.kind === 'bolt') {
      const live = p.target && p.target.uid === p.targetUid && !p.target.dead;
      if (live && p.target) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = PROJECTILE.boltSpeed * dt;
      if (d <= step + 4 || p.t >= p.life) {
        if (live && p.target && p.owner) {
          hurt(s, p.target, p.damage * critOf(s, p.owner), dmgTypeOf(p.owner), p.owner);
          onHitEffects(s, p.target, p.owner);
          emit(s, 'hit', p.tx, p.ty);
        }
        P.removeAt(i);
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    } else {
      const k = Math.min(1, p.t / p.life);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.y = p.sy + (p.ty - p.sy) * k;
      if (k >= 1) {
        if (p.owner) land(s, p);
        P.removeAt(i);
      }
    }
  }
}

function splash(s: RunState, x: number, y: number, r: number, dmg: number, owner: Tower): void {
  const E = s.enemies;
  const n = E.count;
  const type = dmgTypeOf(owner);
  for (let i = 0; i < n; i++) {
    const e = E.items[i];
    if (e.dead || e.def.flying) continue;
    const rr = r + e.def.radius;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 > rr * rr) continue;
    hurt(s, e, dmg, type, owner);
    onHitEffects(s, e, owner);
  }
}

function land(s: RunState, p: { tx: number; ty: number; damage: number; owner: Tower | null }): void {
  const t = p.owner as Tower;
  const st = t.stats;
  splash(s, p.tx, p.ty, st.splash, p.damage, t);
  emit(s, 'splash', p.tx, p.ty, st.splash);
  for (let c = 0; c < st.cluster; c++) {
    const a = s.rng.range(0, Math.PI * 2);
    const r = s.rng.range(0.4, 1) * PROJECTILE.clusterSpread;
    const cx = p.tx + Math.cos(a) * r;
    const cy = p.ty + Math.sin(a) * r;
    splash(s, cx, cy, PROJECTILE.clusterSplash, p.damage * PROJECTILE.clusterDamage, t);
    emit(s, 'cluster', cx, cy, PROJECTILE.clusterSplash);
  }
  if (st.poolDps > 0) addPool(s, p.tx, p.ty, st.splash * 0.8, st.poolDps, st.poolTime, t);
}

// ---------------------------------------------------------------------------------------------

function keepMoths(s: RunState, t: Tower): void {
  let have = 0;
  const M = s.moths;
  for (let i = 0; i < M.count; i++) if (M.items[i].owner === t && !M.items[i].temp) have++;
  for (; have < t.stats.moths; have++) {
    const m = M.add();
    if (!m) return;
    m.owner = t; m.ownerUid = t.uid; m.x = m.px = t.x; m.y = m.py = t.y - 10;
    m.target = null; m.targetUid = 0; m.cd = 0.3; m.phase = s.rng.range(0, Math.PI * 2);
    m.life = 0; m.temp = false;
  }
}

function moths(s: RunState, dt: number): void {
  const M = s.moths;
  for (let i = M.count - 1; i >= 0; i--) {
    const m = M.items[i];
    const t = m.owner;
    if (!t) { M.removeAt(i); continue; }
    if (m.temp) {
      m.life -= dt;
      if (m.life <= 0) { M.removeAt(i); continue; }
    }
    m.px = m.x;
    m.py = m.y;
    m.cd -= dt;
    const st = t.stats;
    const leash = st.range + 40;
    let e = m.target;
    if (e && (e.uid !== m.targetUid || !canSee(e, t) || (e.x - t.x) ** 2 + (e.y - t.y) ** 2 > leash * leash)) e = null;
    if (!e) {
      e = pickTarget(s, t, t.x, t.y, st.range, null);
      // Spread out: half the swarm prefers whatever is closest to itself.
      if (e && i % 2 === 0) {
        const mode = t.target;
        t.target = 'close';
        e = pickTarget(s, t, m.x, m.y, st.range * 0.6, null) ?? e;
        t.target = mode;
      }
    }
    m.target = e;
    m.targetUid = e ? e.uid : 0;
    const speed = st.mothSpeed;
    let gx: number;
    let gy: number;
    if (e) { gx = e.x; gy = e.y; } else {
      m.phase += dt * 2.2;
      gx = t.x + Math.cos(m.phase) * PROJECTILE.mothOrbit;
      gy = t.y - 10 + Math.sin(m.phase) * PROJECTILE.mothOrbit * 0.6;
    }
    const dx = gx - m.x;
    const dy = gy - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.01) {
      const step = Math.min(d, speed * dt);
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
    }
    if (e && d <= PROJECTILE.mothBiteRange + e.def.radius && m.cd <= 0) {
      hurt(s, e, st.damage * (1 + t.buffDamage) * critOf(s, t), dmgTypeOf(t), t);
      onHitEffects(s, e, t);
      m.cd = 1 / (st.rate * (1 + t.buffRate));
      emit(s, 'bite', e.x, e.y);
    }
  }
}

function burnPools(s: RunState, dt: number): void {
  const P = s.pools;
  for (let i = P.count - 1; i >= 0; i--) {
    const p = P.items[i];
    p.t += dt;
    if (p.t >= p.life) { P.removeAt(i); continue; }
    const E = s.enemies;
    for (let j = 0; j < E.count; j++) {
      const e = E.items[j];
      if (e.dead || e.def.flying) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (p.r + e.def.radius) ** 2) continue;
      hurt(s, e, p.dps * dt, 'fire', p.owner);
    }
  }
}

function sweep(s: RunState): void {
  const E = s.enemies;
  for (let i = E.count - 1; i >= 0; i--) {
    const e = E.items[i];
    if (!e.dead) continue;
    const w = e.wave;
    E.removeAt(i);
    s.waveLeft[w]--;
    if (s.waveLeft[w] === 0) waveCleared(s, w);
  }
}
