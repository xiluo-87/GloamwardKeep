import { flameRadius } from './lantern';
import { Choice, Input, passiveRank, RunState } from './state';

/**
 * A simple player for balance checks and headless runs. Moves away from the nearest threat
 * while drifting toward pickups, and ramps its wick only when oil allows.
 */
export function botInput(s: RunState, out: Input): Input {
  const p = s.player;
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < s.enemies.count; i += 3) {
    const e = s.enemies.items[i];
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 170 * 170 && d2 > 1) {
      const k = 1 / d2;
      ax += dx * k * 40;
      ay += dy * k * 40;
    }
  }
  let best = Infinity;
  let bx = 0;
  let by = 0;
  const wantOil = p.oil < p.maxOil * 0.6;
  for (let i = 0; i < s.pickups.count; i++) {
    const k = s.pickups.items[i];
    const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
    const score = k.kind === 'ember' ? d * (wantOil ? 4 : 1) : d * 0.25;
    if (score < best) { best = score; bx = k.x - p.x; by = k.y - p.y; }
  }
  for (let i = 0; i < s.crates.count; i++) {
    const c = s.crates.items[i];
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d * 0.1 < best) { best = d * 0.1; bx = c.x - p.x; by = c.y - p.y; }
  }
  const bl = Math.hypot(bx, by) || 1;
  out.mx = ax * 3 + (bx / bl) * 0.9;
  out.my = ay * 3 + (by / bl) * 0.9;
  if (s.bossEnemy && s.boss?.phase === 3) {
    // Knows the secret, keeps out of the telegraphed wedge by circling.
    out.dim = true;
    const e = s.bossEnemy;
    const a = Math.atan2(p.y - e.y, p.x - e.x) + 1.2;
    out.mx = Math.cos(a);
    out.my = Math.sin(a);
  } else out.dim = false;
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
