import { rankMul, TUNING as T, WEAPONS } from '../data/content';
import { finalDamage, isInverted, postRadius } from './lantern';
import { Enemy, emit, Moth, OwnedWeapon, passiveRank, Projectile, RunState, weaponOf } from './state';

export function damageEnemy(s: RunState, e: Enemy, base: number): void {
  if (e.hp <= 0) return;
  const d = finalDamage(base, { flame: s.flame, wick: passiveRank(s, 'wick'), inLight: e.inLight, inverted: e.boss && isInverted(s) });
  e.hp -= d;
  e.flash = 0.08;
  s.stats.damageDealt += d;
  if (s.hitBudget > 0) { s.hitBudget--; emit(s, 'hit', e.x, e.y, e.inLight ? 1 : 0); }
}

function push(e: Enemy, fromX: number, fromY: number, force: number): void {
  const dx = e.x - fromX;
  const dy = e.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  const k = force * (1 - e.def.pushResist);
  e.kbx += (dx / d) * k;
  e.kby += (dy / d) * k;
}

/** Nearest enemy in the light if there is one, otherwise the nearest in the dark. */
export function nearestTarget(s: RunState, x: number, y: number, range: number, skipUid = 0): Enemy | null {
  const n = s.grid.query(x, y, range, s.grid.b);
  let lit: Enemy | null = null;
  let litD = Infinity;
  let any: Enemy | null = null;
  let anyD = Infinity;
  for (let i = 0; i < n; i++) {
    const idx = s.grid.b[i];
    if (idx >= s.enemies.count) continue;
    const e = s.enemies.items[idx];
    if (e.hp <= 0 || e.uid === skipUid) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d > range * range) continue;
    if (e.inLight && d < litD) { lit = e; litD = d; }
    if (d < anyD) { any = e; anyD = d; }
  }
  return lit ?? any;
}

function randomTarget(s: RunState, x: number, y: number, range: number): Enemy | null {
  const n = s.grid.query(x, y, range, s.grid.b);
  let lit: Enemy | null = null;
  let litN = 0;
  let any: Enemy | null = null;
  let anyN = 0;
  for (let i = 0; i < n; i++) {
    const idx = s.grid.b[i];
    if (idx >= s.enemies.count) continue;
    const e = s.enemies.items[idx];
    if (e.hp <= 0 || (e.x - x) ** 2 + (e.y - y) ** 2 > range * range) continue;
    if (e.inLight && s.rng.next() * ++litN < 1) lit = e;
    if (s.rng.next() * ++anyN < 1) any = e;
  }
  return lit ?? any;
}

function hitCircle(s: RunState, x: number, y: number, r: number, dmg: number): void {
  const n = s.grid.query(x, y, r, s.grid.a);
  for (let i = 0; i < n; i++) {
    const idx = s.grid.a[i];
    if (idx >= s.enemies.count) continue;
    const e = s.enemies.items[idx];
    const R = r + e.r;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 <= R * R) damageEnemy(s, e, dmg);
  }
}

function spawnProjectile(s: RunState, kind: Projectile['kind'], x: number, y: number, damage: number): Projectile | null {
  const p = s.projectiles.add();
  if (!p) return null;
  p.kind = kind;
  p.x = p.px = p.sx = x;
  p.y = p.py = p.sy = y;
  p.vx = p.vy = p.tx = p.ty = 0;
  p.t = 0;
  p.life = 1;
  p.damage = damage;
  p.bounces = 0;
  p.target = null;
  p.targetUid = 0;
  p.lastUid = 0;
  p.pool = 0;
  p.hue = 0;
  return p;
}

function addPool(s: RunState, x: number, y: number, r: number, life: number, dps: number): void {
  const b = s.pools.add();
  if (!b) return;
  b.x = x; b.y = y; b.r = r; b.t = 0; b.life = life; b.dps = dps; b.tick = 0;
}

function addRing(s: RunState, x: number, y: number, max: number, damage: number, pushF: number): void {
  const r = s.rings.add();
  if (!r) return;
  r.x = x; r.y = y; r.prev = 0; r.r = 0; r.max = max; r.speed = max / T.bell.time; r.damage = damage; r.push = pushF; r.age = 0;
  r.pull = s.sextonPull;
  emit(s, 'bell', x, y, max);
}

function mothCount(s: RunState, w: OwnedWeapon): number {
  if (w.id === 'firemoth') return T.moth.count + 3 + s.characterMoths;
  return T.moth.count + (w.rank >= 3 ? 1 : 0) + (w.rank >= 5 ? 2 : 0) + s.characterMoths;
}

function updateMoths(s: RunState, w: OwnedWeapon, dt: number): void {
  const fire = w.id === 'firemoth';
  const count = mothCount(s, w);
  while (s.moths.length < count) {
    const m: Moth = { x: s.player.x, y: s.player.y, px: s.player.x, py: s.player.y, diving: false, tx: 0, ty: 0, cd: T.firemoth.diveEvery * (s.moths.length / count + 0.2), trail: 0, returning: false };
    s.moths.push(m);
  }
  const def = WEAPONS[w.id];
  const dmg = def.damage * rankMul(w.rank);
  for (let i = 0; i < count; i++) {
    const m = s.moths[i];
    m.px = m.x;
    m.py = m.y;
    const a = s.t * T.moth.spin + (i / count) * Math.PI * 2;
    const ox = s.player.x + Math.cos(a) * T.moth.orbit;
    const oy = s.player.y + Math.sin(a) * T.moth.orbit;
    if (fire) {
      m.cd -= dt;
      if (!m.diving && !m.returning && m.cd <= 0) {
        const tgt = randomTarget(s, s.player.x, s.player.y, T.firemoth.range);
        m.cd = T.firemoth.diveEvery;
        if (tgt) { m.diving = true; m.tx = tgt.x; m.ty = tgt.y; }
      }
      m.trail -= dt;
      if (m.trail <= 0 && (m.diving || m.returning)) {
        m.trail = T.firemoth.trailEvery;
        addPool(s, m.x, m.y, T.firemoth.trailRadius, T.firemoth.trailLife, T.firemoth.trailDps);
      }
    }
    if (m.diving || m.returning) {
      const tx = m.diving ? m.tx : ox;
      const ty = m.diving ? m.ty : oy;
      const d = Math.hypot(tx - m.x, ty - m.y);
      const st = T.firemoth.diveSpeed * dt;
      if (d <= st + 4) {
        if (m.diving) { m.diving = false; m.returning = true; } else m.returning = false;
      } else {
        m.x += ((tx - m.x) / d) * st;
        m.y += ((ty - m.y) / d) * st;
      }
    } else {
      m.x = ox;
      m.y = oy;
    }
    const n = s.grid.query(m.x, m.y, T.moth.radius, s.grid.a);
    for (let j = 0; j < n; j++) {
      const idx = s.grid.a[j];
      if (idx >= s.enemies.count) continue;
      const e = s.enemies.items[idx];
      if (e.mothUntil > s.t) continue;
      const R = T.moth.radius + e.r;
      if ((e.x - m.x) ** 2 + (e.y - m.y) ** 2 <= R * R) {
        e.mothUntil = s.t + def.cooldown;
        damageEnemy(s, e, dmg);
      }
    }
  }
}

function lash(s: RunState, w: OwnedWeapon, dir: number, stained: boolean): void {
  const p = s.player;
  const len = T.lash.length * (w.rank >= 5 || stained ? 1.4 : 1);
  const dmg = WEAPONS[w.id].damage * rankMul(w.rank);
  const n = s.grid.query(p.x, p.y, len, s.grid.a);
  for (let i = 0; i < n; i++) {
    const idx = s.grid.a[i];
    if (idx >= s.enemies.count) continue;
    const e = s.enemies.items[idx];
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const R = len + e.r;
    if (dx * dx + dy * dy > R * R) continue;
    let diff = Math.atan2(dy, dx) - dir;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) <= T.lash.halfArc) damageEnemy(s, e, dmg);
  }
  emit(s, stained ? 'stainedlash' : 'lash', p.x, p.y, dir, len, T.lash.halfArc);
  if (stained) {
    for (let i = 0; i < T.lash.stainedShards; i++) {
      const a = dir - T.lash.halfArc + (i / (T.lash.stainedShards - 1)) * T.lash.halfArc * 2;
      const q = spawnProjectile(s, 'stained', p.x + Math.cos(a) * len * 0.5, p.y + Math.sin(a) * len * 0.5, T.lash.shardDamage);
      if (q) {
        q.vx = Math.cos(a) * T.lash.shardSpeed;
        q.vy = Math.sin(a) * T.lash.shardSpeed;
        q.life = T.lash.shardLife;
        q.hue = (i * 40 + 280) % 360;
      }
    }
  }
}

function fireWeapon(s: RunState, w: OwnedWeapon): void {
  const p = s.player;
  const def = WEAPONS[w.id];
  const dmg = def.damage * rankMul(w.rank);
  switch (w.id) {
    case 'cinder': {
      const throws = w.rank >= 3 ? 2 : 1;
      for (let i = 0; i < throws; i++) {
        const tgt = randomTarget(s, p.x, p.y, T.cinder.range);
        if (!tgt) return;
        const q = spawnProjectile(s, 'cinder', p.x, p.y, dmg);
        if (q) {
          q.tx = tgt.x; q.ty = tgt.y; q.life = T.cinder.flight;
          q.pool = w.rank >= 5 ? T.cinder.poolLarge : T.cinder.pool;
          q.hue = T.cinder.burn * rankMul(w.rank);
        }
      }
      break;
    }
    case 'lash':
      lash(s, w, p.facing, false);
      if (w.rank >= 3) lash(s, w, p.facing + Math.PI, false);
      break;
    case 'stained':
      lash(s, w, p.facing, true);
      lash(s, w, p.facing + Math.PI, true);
      break;
    case 'shard': {
      const count = w.rank >= 5 ? 2 : 1;
      let skip = 0;
      for (let i = 0; i < count; i++) {
        const tgt = nearestTarget(s, p.x, p.y, T.shard.range, skip);
        if (!tgt) return;
        skip = tgt.uid;
        const q = spawnProjectile(s, 'shard', p.x, p.y, dmg);
        if (q) {
          q.target = tgt; q.targetUid = tgt.uid;
          q.bounces = T.shard.bounces + (w.rank >= 3 ? 2 : 0);
          q.life = 4;
          emit(s, 'shard', p.x, p.y);
        }
      }
      break;
    }
    case 'bell':
      addRing(s, p.x, p.y, T.bell.radius * (w.rank >= 5 ? 1.25 : 1), dmg, T.bell.push * (w.rank >= 3 ? 1.3 : 1));
      break;
    case 'sentry':
    case 'vigil': {
      const vigil = w.id === 'vigil';
      const count = vigil || w.rank >= 3 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        let c = s.sentries.add();
        if (!c) {
          // Replace the oldest sentry when all are out.
          let best = 0;
          for (let j = 1; j < s.sentries.count; j++) if (s.sentries.items[j].t > s.sentries.items[best].t) best = j;
          c = s.sentries.items[best];
        }
        c.x = c.px = p.x + (i === 0 ? 0 : 26);
        c.y = c.py = p.y + (i === 0 ? 0 : -14);
        c.t = 0;
        c.life = T.sentry.life;
        c.cd = 0.2;
        c.toll = T.vigil.tollEvery * 0.5;
        c.light = vigil || w.rank >= 5;
        c.bell = vigil;
      }
      break;
    }
    default:
      break;
  }
}

export function updateWeapons(s: RunState, dt: number): void {
  for (let i = 0; i < s.weapons.length; i++) {
    const w = s.weapons[i];
    if (w.id === 'moth' || w.id === 'firemoth') { updateMoths(s, w, dt); continue; }
    w.cd -= dt;
    if (w.cd <= 0) {
      w.cd += WEAPONS[w.id].cooldown;
      fireWeapon(s, w);
    }
  }
  updateProjectiles(s, dt);
  updateGroundAndRings(s, dt);
  updateSentries(s, dt);
}

function updateProjectiles(s: RunState, dt: number): void {
  const pool = s.projectiles;
  for (let i = pool.count - 1; i >= 0; i--) {
    const q = pool.items[i];
    q.px = q.x;
    q.py = q.y;
    q.t += dt;
    let dead = q.t >= q.life;
    if (q.kind === 'cinder') {
      const k = Math.min(1, q.t / q.life);
      q.x = q.sx + (q.tx - q.sx) * k;
      q.y = q.sy + (q.ty - q.sy) * k;
      if (dead) {
        hitCircle(s, q.x, q.y, T.cinder.hitRadius, q.damage);
        addPool(s, q.x, q.y, q.pool, T.cinder.life, q.hue);
      }
    } else if (q.kind === 'shard') {
      const tgt = q.target;
      if (!tgt || tgt.uid !== q.targetUid || tgt.hp <= 0) {
        const nt = nearestTarget(s, q.x, q.y, T.shard.bounceRange, q.lastUid);
        if (!nt) { pool.removeAt(i); continue; }
        q.target = nt;
        q.targetUid = nt.uid;
      }
      const t2 = q.target as Enemy;
      const dx = t2.x - q.x;
      const dy = t2.y - q.y;
      const d = Math.hypot(dx, dy) || 1;
      const st = T.shard.speed * dt;
      q.x += (dx / d) * Math.min(st, d);
      q.y += (dy / d) * Math.min(st, d);
      if (d <= st + t2.r) {
        damageEnemy(s, t2, q.damage);
        q.lastUid = t2.uid;
        if (--q.bounces < 0) dead = true;
        else {
          const nt = nearestTarget(s, q.x, q.y, T.shard.bounceRange, t2.uid);
          if (nt) { q.target = nt; q.targetUid = nt.uid; } else dead = true;
        }
      }
    } else {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const n = s.grid.query(q.x, q.y, 6, s.grid.a);
      for (let j = 0; j < n; j++) {
        const idx = s.grid.a[j];
        if (idx >= s.enemies.count) continue;
        const e = s.enemies.items[idx];
        if (e.hp > 0 && (e.x - q.x) ** 2 + (e.y - q.y) ** 2 <= (e.r + 5) ** 2) {
          damageEnemy(s, e, q.damage);
          dead = true;
          break;
        }
      }
    }
    if (dead) pool.removeAt(i);
  }
}

function updateGroundAndRings(s: RunState, dt: number): void {
  const pools = s.pools;
  for (let i = pools.count - 1; i >= 0; i--) {
    const b = pools.items[i];
    b.t += dt;
    b.tick -= dt;
    if (b.tick <= 0) {
      b.tick = 0.5;
      hitCircle(s, b.x, b.y, b.r, b.dps * 0.5);
    }
    if (b.t >= b.life) pools.removeAt(i);
  }
  const rings = s.rings;
  for (let i = rings.count - 1; i >= 0; i--) {
    const r = rings.items[i];
    r.age += dt;
    r.prev = r.r;
    r.r = Math.min(r.max, r.r + r.speed * dt);
    const n = s.grid.query(r.x, r.y, r.r, s.grid.a);
    for (let j = 0; j < n; j++) {
      const idx = s.grid.a[j];
      if (idx >= s.enemies.count) continue;
      const e = s.enemies.items[idx];
      const d = Math.hypot(e.x - r.x, e.y - r.y);
      // The wave front hits each enemy exactly once as it passes.
      if (d - e.r <= r.r && d - e.r > r.prev) {
        damageEnemy(s, e, r.damage);
        push(e, r.x, r.y, r.push);
      }
    }
    if (r.pull) {
      for (let j = 0; j < s.pickups.count; j++) {
        const k = s.pickups.items[j];
        const d = Math.hypot(k.x - r.x, k.y - r.y);
        if (d <= r.r && d > r.prev) k.pulled = true;
      }
    }
    if (r.r >= r.max) rings.removeAt(i);
  }
}

function updateSentries(s: RunState, dt: number): void {
  const pool = s.sentries;
  s.litSentries.length = 0;
  const w = weaponOf(s, 'sentry') ?? weaponOf(s, 'vigil');
  const shotDmg = w ? WEAPONS.sentry.damage * (w.id === 'vigil' ? 1.8 : rankMul(w.rank)) : WEAPONS.sentry.damage;
  for (let i = pool.count - 1; i >= 0; i--) {
    const c = pool.items[i];
    c.t += dt;
    if (c.t >= c.life) { pool.removeAt(i); continue; }
    if (c.light) s.litSentries.push(c);
    c.cd -= dt;
    if (c.cd <= 0) {
      c.cd += 1 / T.sentry.rate;
      const tgt = nearestTarget(s, c.x, c.y, T.sentry.range);
      if (tgt) {
        const q = spawnProjectile(s, 'bolt', c.x, c.y - 12, shotDmg);
        if (q) {
          const d = Math.hypot(tgt.x - c.x, tgt.y - c.y) || 1;
          q.vx = ((tgt.x - c.x) / d) * T.sentry.shotSpeed;
          q.vy = ((tgt.y - c.y) / d) * T.sentry.shotSpeed;
          q.life = 1;
        }
      }
    }
    if (c.bell) {
      c.toll -= dt;
      if (c.toll <= 0) {
        c.toll = T.vigil.tollEvery;
        addRing(s, c.x, c.y, T.vigil.tollRadius, WEAPONS.vigil.damage, T.bell.push);
        for (const lp of s.litPosts) {
          if ((lp.x - c.x) ** 2 + (lp.y - c.y) ** 2 < T.vigil.postRange ** 2 && postRadius(lp) > 0) {
            lp.life = Math.min(45, lp.life + T.vigil.addLife);
          }
        }
      }
    }
  }
}
