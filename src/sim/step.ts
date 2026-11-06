import { BOSS, STEP, WAX } from '../data/balance';
import { sweepDead, updateBoss, updateEnemies, updatePickups, updateSpawner } from './enemies';
import { classifyLight, updateLantern, updatePosts } from './lantern';
import { Input, RunState, emit } from './state';
import { rollChoices } from './upgrades';
import { updateWeapons } from './weapons';

function updatePlayer(s: RunState, input: Input, dt: number): void {
  const p = s.player;
  p.px = p.x;
  p.py = p.y;
  const m = Math.hypot(input.mx, input.my);
  p.moving = m > 0.05;
  if (p.moving) {
    const k = Math.min(1, m) / m;
    p.x += input.mx * k * p.speed * dt;
    p.y += input.my * k * p.speed * dt;
    p.facing = Math.atan2(input.my, input.mx);
  }
  if (p.hurt > 0) p.hurt -= dt;
  if (p.grace > 0) p.grace -= dt;
  if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
}

/** Advances the simulation one fixed step. Does nothing while a level-up waits or after the run ends. */
export function stepRun(s: RunState, input: Input): void {
  if (s.over || s.choices) return;
  const dt = STEP;
  s.hitBudget = 3;
  s.t += dt;
  updatePlayer(s, input, dt);
  if (s.bossDead) {
    // The dawn plays out: enemies crumble and the lantern goes out on its own.
    updateLantern(s, { mx: 0, my: 0, dim: false }, dt);
    s.player.hp = Math.max(s.player.hp, 1);
    sweepDead(s);
    s.dawnT += dt;
    if (s.dawnT >= BOSS.dawnTime) { s.over = true; s.outcome = 'dawn'; }
    return;
  }
  updateLantern(s, input, dt);
  updatePosts(s, dt);
  updateBoss(s, dt);
  updateSpawner(s, dt);
  s.grid.rebuild(s.enemies.items, s.enemies.count, s.player.x, s.player.y);
  updateEnemies(s, dt);
  classifyLight(s);
  updateWeapons(s, dt);
  updatePickups(s, dt);
  sweepDead(s);
  if (s.player.hp <= 0) {
    s.player.hp = 0;
    s.over = true;
    s.outcome = 'death';
    emit(s, 'hurt', s.player.x, s.player.y, 1);
    return;
  }
  if (s.pendingLevels > 0) {
    s.choices = rollChoices(s);
    emit(s, 'level');
  }
}

export function computeWax(o: { t: number; kills: number; dawn: boolean; chandler: boolean; newMoon: boolean }): number {
  const base = (o.t / 60) * WAX.perMinute + o.kills / WAX.killsPerWax + (o.dawn ? WAX.dawn : 0);
  return Math.floor(base * (o.chandler ? WAX.chandler : 1) * (o.newMoon ? WAX.newMoon : 1));
}
