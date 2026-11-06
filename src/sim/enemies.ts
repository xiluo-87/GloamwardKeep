import { budgetRate, BOSS, ELITE, hpScale, OIL, PLAYER, RUN, emberNeed } from '../data/balance';
import { ENEMIES, EnemyDef, EnemyId, HOUND_PACK, SNUFFER_DRAIN, waveAt, Wave } from '../data/content';
import { addOil, drainOil, flameSpawn, isInverted, postRadius, snuffPost } from './lantern';
import { Enemy, emit, passiveRank, PickupKind, RunState } from './state';
import { Rng } from './rng';

export function pickKind(wave: Wave, rng: Rng): EnemyId {
  let total = 0;
  for (const k in wave.weights) total += wave.weights[k as EnemyId] ?? 0;
  let roll = rng.next() * total;
  for (const k in wave.weights) {
    roll -= wave.weights[k as EnemyId] ?? 0;
    if (roll <= 0) return k as EnemyId;
  }
  return 'mite';
}

function furthestCommon(s: RunState): Enemy | null {
  let best: Enemy | null = null;
  let bestD = -1;
  for (let i = 0; i < s.enemies.count; i++) {
    const e = s.enemies.items[i];
    if (e.elite || e.boss) continue;
    const d = (e.x - s.player.x) ** 2 + (e.y - s.player.y) ** 2;
    if (d > bestD) { bestD = d; best = e; }
  }
  return best;
}

export function spawnEnemy(s: RunState, def: EnemyDef, x: number, y: number, elite = false): Enemy | null {
  let e = s.enemies.add();
  if (!e) e = furthestCommon(s); // At the cap, the furthest common enemy is recycled.
  if (!e) return null;
  const hp = def.id === 'boss' ? def.hp : def.hp * hpScale(s.t) * (elite ? ELITE.hp : 1);
  e.uid = s.nextUid++;
  e.def = def;
  e.x = e.px = x;
  e.y = e.py = y;
  e.kbx = e.kby = 0;
  e.hp = e.maxHp = hp;
  e.speed = def.speed * (elite ? ELITE.speed : 1) * (def.id === 'boss' ? 1 : s.rng.range(0.94, 1.06));
  e.damage = def.damage * (elite ? ELITE.damage : 1);
  e.embers = elite ? ELITE.embers : def.embers;
  e.r = def.radius * (elite ? ELITE.radius : 1);
  e.elite = elite;
  e.boss = def.id === 'boss';
  e.hitCd = 0;
  e.mothUntil = 0;
  e.flash = 0;
  e.inLight = false;
  e.inPost = false;
  e.noDrops = false;
  return e;
}

/** A point just outside the view around the player. */
export function edgePoint(s: RunState, out: { x: number; y: number }, angle?: number): void {
  const a = angle ?? s.rng.next() * Math.PI * 2;
  const hw = s.cfg.viewHalfW + 40;
  const hh = s.cfg.viewHalfH + 40;
  const c = Math.cos(a);
  const si = Math.sin(a);
  const k = Math.min(hw / Math.max(1e-6, Math.abs(c)), hh / Math.max(1e-6, Math.abs(si)));
  out.x = s.player.x + c * k;
  out.y = s.player.y + si * k;
}

const pt = { x: 0, y: 0 };

function spawnRing(s: RunState, def: EnemyDef, count: number): void {
  const R = Math.hypot(s.cfg.viewHalfW, s.cfg.viewHalfH) + 40;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    spawnEnemy(s, def, s.player.x + Math.cos(a) * R, s.player.y + Math.sin(a) * R);
  }
}

function toughestDef(t: number): EnemyDef {
  const w = waveAt(t);
  let best = ENEMIES.mite;
  for (const k in w.weights) {
    const d = ENEMIES[k as EnemyId];
    if (d.toughness > best.toughness) best = d;
  }
  return best;
}

export function updateSpawner(s: RunState, dt: number): void {
  if (s.bossDead) return;
  const wave = waveAt(s.t);
  const wick = passiveRank(s, 'wick');
  const scale = flameSpawn(s.flame, wick) * (s.bossEnemy ? RUN.bossSpawnScale : 1);
  s.budget += budgetRate(s.t) * scale * dt;
  let guard = 0;
  while (s.budget >= 1 && guard++ < 40) {
    const kind = pickKind(wave, s.rng);
    const def = ENEMIES[kind];
    const n = kind === 'hound' ? HOUND_PACK : 1;
    const cost = def.cost * n;
    if (s.budget < cost) {
      // Save up unless this would stall on an expensive pack in the early game.
      if (s.budget < 1 || kind === 'hound') { s.budget -= 0.25; }
      break;
    }
    s.budget -= cost;
    edgePoint(s, pt);
    for (let i = 0; i < n; i++) spawnEnemy(s, def, pt.x + s.rng.range(-30, 30), pt.y + s.rng.range(-30, 30));
  }
  // Elite waves.
  if (s.eliteNext === 0) s.eliteNext = Math.max(RUN.firstElite, RUN.firstElite + Math.ceil((s.t - RUN.firstElite) / RUN.eliteEvery) * RUN.eliteEvery);
  if (s.t >= s.eliteNext) {
    const n = 1 + Math.floor((s.eliteNext - RUN.firstElite) / (RUN.eliteEvery * 2));
    const def = toughestDef(s.t);
    for (let i = 0; i < n; i++) {
      edgePoint(s, pt);
      spawnEnemy(s, def, pt.x, pt.y, true);
    }
    emit(s, 'elite');
    s.eliteNext += RUN.eliteEvery;
  }
  // Encircling rings in the small hours.
  if (s.t >= RUN.ringFrom) {
    if (s.ringNext === 0) s.ringNext = s.t;
    if (s.t >= s.ringNext) {
      spawnRing(s, ENEMIES.mite, RUN.ringSize);
      s.ringNext += RUN.ringEvery;
    }
  }
  // Supply crates.
  s.crateCd -= dt;
  if (s.crateCd <= 0) {
    s.crateCd = OIL.crateEvery;
    const c = s.crates.add();
    if (c) {
      edgePoint(s, pt);
      c.x = pt.x + s.rng.range(-60, 60);
      c.y = pt.y + s.rng.range(-60, 60);
      emit(s, 'crate', c.x, c.y);
    }
  }
}

/** Moves every enemy, resolves touching. Uses the grid built this step for local separation. */
export function updateEnemies(s: RunState, dt: number): void {
  const p = s.player;
  const inverted = isInverted(s);
  const pr = 12;
  const items = s.enemies.items;
  for (let i = 0; i < s.enemies.count; i++) {
    const e = items[i];
    e.px = e.x;
    e.py = e.y;
    if (e.flash > 0) e.flash -= dt;
    if (e.hitCd > 0) e.hitCd -= dt;
    if (e.hp <= 0) continue;
    let tx = p.x;
    let ty = p.y;
    if (e.def.id === 'snuffer') {
      let best = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      for (let j = 0; j < s.litPosts.length; j++) {
        const lp = s.litPosts[j];
        const d = (lp.x - e.x) ** 2 + (lp.y - e.y) ** 2;
        if (d < best) { best = d; tx = lp.x; ty = lp.y; }
      }
    }
    let dx = tx - e.x;
    let dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    // Far enemies are brought back to the edge of the view so the pressure stays on.
    if (d > RUN.leash && !e.boss) {
      edgePoint(s, pt, s.player.moving ? p.facing + s.rng.range(-0.8, 0.8) : undefined);
      e.x = e.px = pt.x;
      e.y = e.py = pt.y;
      continue;
    }
    let sx = 0;
    let sy = 0;
    if (!e.boss) {
      let checked = 0;
      for (let j = s.grid.firstAt(e.x, e.y); j !== -1 && checked < 6; j = s.grid.nextOf(j)) {
        if (j === i || j >= s.enemies.count) continue;
        checked++;
        const o = items[j];
        const ax = e.x - o.x;
        const ay = e.y - o.y;
        const min = e.r + o.r;
        const dd = ax * ax + ay * ay;
        if (dd < min * min && dd > 0.01) {
          const k = (min - Math.sqrt(dd)) / min;
          sx += ax * k;
          sy += ay * k;
        }
      }
    }
    // The boss never lets the player simply walk away from the end of the night.
    const spd = e.boss && d > BOSS.catchUpDist ? e.speed * BOSS.catchUp : e.speed;
    e.x += (dx * spd + sx * 5 + e.kbx) * dt;
    e.y += (dy * spd + sy * 5 + e.kby) * dt;
    e.kbx *= 0.9;
    e.kby *= 0.9;

    // Snuffers feed on lit posts.
    if (e.def.id === 'snuffer') {
      for (let j = 0; j < s.litPosts.length; j++) {
        const lp = s.litPosts[j];
        if ((lp.x - e.x) ** 2 + (lp.y - e.y) ** 2 < 18 * 18) {
          snuffPost(s, lp, 5);
          e.hp = 0;
          e.noDrops = true;
          break;
        }
      }
    }
    if (e.boss && inverted) continue; // The final phase hurts only through its sweeps.
    const touch = e.r + pr;
    if (e.hitCd <= 0 && (p.x - e.x) ** 2 + (p.y - e.y) ** 2 < touch * touch) {
      e.hitCd = 0.5;
      hurtPlayer(s, e.damage);
      if (e.def.id === 'snuffer') drainOil(s, SNUFFER_DRAIN);
    }
  }
}

export function hurtPlayer(s: RunState, amount: number): void {
  const p = s.player;
  // A brief grace after each hit keeps being swarmed readable instead of instantly fatal.
  if (s.bossDead || p.grace > 0) return;
  p.hp -= Math.max(1, amount - p.armor);
  p.hurt = 0.2;
  p.grace = PLAYER.grace;
  emit(s, 'hurt', p.x, p.y);
}

export function dropPickup(s: RunState, kind: PickupKind, value: number, x: number, y: number): void {
  let pk = s.pickups.add();
  if (!pk) {
    // At the cap, embers merge; oil replaces the first ember so it's never lost.
    const items = s.pickups.items;
    if (kind === 'ember') {
      const o = items[s.rng.int(s.pickups.count)];
      if (o.kind === 'ember') { o.value += value; return; }
    }
    for (let i = 0; i < s.pickups.count && !pk; i++) if (items[i].kind === 'ember') pk = items[i];
    if (!pk) return;
  }
  pk.kind = kind;
  pk.value = value;
  pk.x = pk.px = x + s.rng.range(-6, 6);
  pk.y = pk.py = y + s.rng.range(-6, 6);
  pk.pulled = false;
  pk.speed = 0;
  pk.age = 0;
}

/** Removes dead enemies and applies their drops. Grid indices are invalid until the next rebuild. */
export function sweepDead(s: RunState): void {
  const pool = s.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.items[i];
    if (e.hp > 0) continue;
    if (e.boss) {
      s.bossDead = true;
      s.bossEnemy = null;
      s.dawnT = 0;
      emit(s, 'dawn', e.x, e.y);
      for (let j = 0; j < pool.count; j++) if (j !== i) { pool.items[j].hp = 0; pool.items[j].noDrops = true; }
      pool.removeAt(i);
      s.kills++;
      i = pool.count;
      continue;
    }
    if (!e.noDrops) {
      s.kills++;
      dropPickup(s, 'ember', e.embers, e.x, e.y);
      // Kills inside a lamppost's light drop no oil. Safety doesn't pay.
      if (!e.inPost) {
        if (e.elite) dropPickup(s, 'flask', OIL.flask, e.x + 8, e.y);
        else if (s.rng.chance(OIL.dropletChance)) dropPickup(s, 'droplet', OIL.droplet, e.x, e.y);
      }
      emit(s, 'kill', e.x, e.y, e.r, e.inLight ? 1 : 0);
    } else if (s.bossDead) emit(s, 'kill', e.x, e.y, e.r, 2);
    pool.removeAt(i);
  }
  s.stats.peakEnemies = Math.max(s.stats.peakEnemies, pool.count);
}

export function updatePickups(s: RunState, dt: number): void {
  const p = s.player;
  const range = p.pickupRange;
  const pool = s.pickups;
  for (let i = pool.count - 1; i >= 0; i--) {
    const k = pool.items[i];
    k.px = k.x;
    k.py = k.y;
    k.age += dt;
    const dx = p.x - k.x;
    const dy = p.y - k.y;
    const d = Math.hypot(dx, dy);
    if (!k.pulled && d <= range) k.pulled = true;
    if (k.pulled) {
      k.speed = Math.min(620, k.speed + 1400 * dt);
      const st = (k.speed * dt) / (d || 1);
      k.x += dx * Math.min(1, st);
      k.y += dy * Math.min(1, st);
    }
    if (d < 16) {
      if (k.kind === 'ember') {
        p.embers += k.value * p.emberMul;
        while (p.embers >= emberNeed(p.level)) {
          p.embers -= emberNeed(p.level);
          p.level++;
          s.pendingLevels++;
        }
        emit(s, 'pickup', k.x, k.y);
      } else {
        addOil(s, k.value);
        emit(s, 'oil', k.x, k.y, k.value);
      }
      pool.removeAt(i);
    }
  }
  for (let i = s.crates.count - 1; i >= 0; i--) {
    const c = s.crates.items[i];
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 34 * 34) {
      dropPickup(s, 'flask', OIL.flask, c.x, c.y);
      emit(s, 'crate', c.x, c.y, 1);
      s.crates.removeAt(i);
    }
  }
}

export function spawnBoss(s: RunState): void {
  edgePoint(s, pt);
  const e = spawnEnemy(s, ENEMIES.boss, pt.x, pt.y);
  if (!e) return;
  e.speed = BOSS.speed[0];
  e.r = BOSS.radius;
  s.bossEnemy = e;
  s.boss = { phase: 1, waveCd: 2, sweepCd: BOSS.sweepEvery, sweepT: 0, sweepAngle: 0, sweepFlash: 0, stutter: 0, dimFlicker: 0 };
  emit(s, 'boss', e.x, e.y);
}

export function updateBoss(s: RunState, dt: number): void {
  if (!s.bossEnemy && !s.boss && !s.bossDead && s.t >= RUN.bossAt) spawnBoss(s);
  const b = s.boss;
  const e = s.bossEnemy;
  if (!b) return;
  b.dimFlicker = Math.max(0, b.dimFlicker - dt);
  b.sweepFlash = Math.max(0, b.sweepFlash - dt);
  b.stutter = Math.max(0, b.stutter - dt);
  if (!e || s.bossDead) return;
  const ratio = e.hp / e.maxHp;
  const p = s.player;
  if (b.phase === 1 && ratio <= BOSS.phase2At) {
    b.phase = 2;
    e.speed = BOSS.speed[1];
    s.lightCap = Math.min(s.lightCap, Math.max(s.radius, BOSS.eclipseMin));
    emit(s, 'boss', e.x, e.y, 2);
  }
  if (b.phase === 2 && ratio <= BOSS.phase3At) {
    b.phase = 3;
    e.speed = BOSS.speed[2];
    b.stutter = 1.6;
    // The eclipse lifts: the light is back, and for the first time it won't help.
    s.lightCap = s.cfg.newMoon ? 120 : Infinity;
    if (p.oil < 10) p.oil = 10;
    emit(s, 'inversion', e.x, e.y);
  }
  if (b.phase <= 2) {
    b.waveCd -= dt;
    if (b.waveCd <= 0) {
      b.waveCd = BOSS.waveEvery;
      for (let i = 0; i < BOSS.waveSize; i++) {
        const a = (i / BOSS.waveSize) * Math.PI * 2;
        spawnEnemy(s, ENEMIES.mite, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70);
      }
    }
  }
  if (b.phase === 2) {
    s.lightCap = Math.max(BOSS.eclipseMin, s.lightCap - BOSS.eclipseRate * dt);
    for (const lp of s.litPosts) {
      if (lp.life > 0 && (lp.x - e.x) ** 2 + (lp.y - e.y) ** 2 < BOSS.blowOutDist * BOSS.blowOutDist) snuffPost(s, lp, lp.life);
    }
  }
  if (b.phase === 3) {
    if (b.sweepT > 0) {
      b.sweepT -= dt;
      if (b.sweepT <= 0) {
        // Release: hits only if the player is still inside the telegraphed wedge.
        b.sweepFlash = 0.35;
        emit(s, 'sweep', e.x, e.y, b.sweepAngle);
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = Math.hypot(dx, dy);
        let diff = Math.atan2(dy, dx) - b.sweepAngle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (d <= BOSS.sweepLength && Math.abs(diff) <= BOSS.sweepHalfArc) hurtPlayer(s, BOSS.sweepDamage);
      }
    } else {
      b.sweepCd -= dt;
      if (b.sweepCd <= 0) {
        b.sweepCd = BOSS.sweepEvery;
        b.sweepT = BOSS.sweepTelegraph;
        b.sweepAngle = Math.atan2(p.y - e.y, p.x - e.x);
      }
    }
  }
}

// Post light radius helper re-exported for renderers.
export { postRadius };
