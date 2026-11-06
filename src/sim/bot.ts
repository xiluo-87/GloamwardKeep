import { flameRadius } from './lantern';
import { Choice, Input, passiveRank, RunState } from './state';

/**
 * A stand-in player for balance checks and headless runs. It circles the swarm the way people
 * do in this kind of game, cuts in for pickups when it's safe, and backs off when hurt.
 */
export function botInput(s: RunState, out: Input): Input {
  const p = s.player;
  let cx = 0;
  let cy = 0;
  let n = 0;
  let rx = 0;
  let ry = 0;
  for (let i = 0; i < s.enemies.count; i++) {
    const e = s.enemies.items[i];
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 320 * 320) { cx += e.x; cy += e.y; n++; }
    if (d2 < 70 * 70 && d2 > 1) {
      rx += dx / d2;
      ry += dy / d2;
    }
  }
  let mx = 0;
  let my = 0;
  if (n > 0) {
    // Orbit the swarm's centre at a distance that keeps it inside whip reach but off our back.
    const ox = p.x - cx / n;
    const oy = p.y - cy / n;
    const d = Math.hypot(ox, oy) || 1;
    const hurt = p.hp < p.maxHp * 0.5;
    const radial = ((hurt ? 240 : 130) - d) / 130;
    const dir = Math.sin(s.t * 0.09) > 0 ? 1 : -1;
    mx = (ox / d) * radial + (-oy / d) * dir;
    my = (oy / d) * radial + (ox / d) * dir;
  }
  // Fetch the most useful pickup in reach; oil matters more as the flask empties.
  const wantOil = p.oil < p.maxOil * 0.6;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < s.pickups.count; i++) {
    const k = s.pickups.items[i];
    const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
    const score = k.kind === 'ember' ? d * (wantOil ? 3 : 1) : d * 0.3;
    if (score < best) { best = score; bx = k.x - p.x; by = k.y - p.y; }
  }
  for (let i = 0; i < s.crates.count; i++) {
    const c = s.crates.items[i];
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d * 0.1 < best) { best = d * 0.1; bx = c.x - p.x; by = c.y - p.y; }
  }
  const bl = Math.hypot(bx, by);
  if (bl > 0) {
    const pull = n === 0 ? 2 : 0.85;
    mx += (bx / bl) * pull;
    my += (by / bl) * pull;
  }
  out.mx = mx + rx * 90;
  out.my = my + ry * 90;
  out.dim = false;
  if (s.bossEnemy && s.boss) {
    // Circles the boss within weapon reach; in the last phase it knows the secret.
    const e = s.bossEnemy;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const a = Math.atan2(p.y - e.y, p.x - e.x) + (d > 170 ? 2.4 : 1.2);
    out.mx = Math.cos(a) + rx * 60;
    out.my = Math.sin(a) + ry * 60;
    out.dim = s.boss.phase === 3;
  }
  return out;
}

export function botChoose(s: RunState, choices: Choice[]): number {
  let best = 0;
  let bestScore = -Infinity;
  const r = flameRadius('burning', passiveRank(s, 'wick'), s.lightBonus, s.lightCap);
  choices.forEach((c, i) => {
    let score = c.kind === 'combo' ? 50 : c.kind === 'weapon' ? 10 + c.rank : 8;
    if (c.id === 'wick') score = r < 280 && s.player.oil > 50 ? 12 : 3;
    if (c.id === 'heart' || c.id === 'reservoir') score = 11;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}
