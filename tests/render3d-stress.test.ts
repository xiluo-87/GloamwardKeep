import { describe, expect, it } from 'vitest';
import { STRESS_CAPS, createStressFixture, moveStressFixture } from '../src/render3d/stress-fixture';
import { createRun } from '../src/sim/state';

const finite = (values: number[]) => values.every(Number.isFinite);

describe('3D renderer stress fixture', () => {
  it('fills capped render pools with unique enemies, valid references, legal towers, and finite positions', () => {
    const fixture = createStressFixture({ seed: 12 });
    const s = fixture.run;
    expect(fixture.counts).toEqual(STRESS_CAPS);
    expect(s.enemies.count).toBe(600);
    expect(s.projectiles.count).toBe(400);
    expect(s.pets.count).toBe(160);
    expect(s.pools.count).toBe(80);
    expect(s.towers.length).toBe(80);
    const uids = s.enemies.items.slice(0, s.enemies.count).map(enemy => enemy.uid);
    expect(new Set(uids).size).toBe(uids.length);
    const valid = new Set(uids);
    for (const enemy of s.enemies.items.slice(0, s.enemies.count)) {
      expect(finite([enemy.x, enemy.y, enemy.px, enemy.py, enemy.hp, enemy.speed])).toBe(true);
      expect(enemy.uid).toBeGreaterThan(0);
    }
    for (const projectile of s.projectiles.items.slice(0, s.projectiles.count)) {
      expect(finite([projectile.x, projectile.y, projectile.px, projectile.py, projectile.tx, projectile.ty])).toBe(true);
      if (projectile.target) expect(projectile.targetUid).toBe(projectile.target.uid);
    }
    for (const pet of s.pets.items.slice(0, s.pets.count)) {
      expect(finite([pet.x, pet.y, pet.px, pet.py])).toBe(true);
      if (pet.target) expect(valid.has(pet.targetUid)).toBe(true);
    }
    for (const pool of s.pools.items.slice(0, s.pools.count)) expect(finite([pool.x, pool.y, pool.r, pool.life])).toBe(true);
    expect(new Set(fixture.routes.map(route => route.length > 1)).size).toBe(1);
    expect(s.eventCount).toBe(0);
  });

  it('offers a customizable all-goblin load, bounded counts, isolated configs, and movement without combat events', () => {
    const first = createStressFixture({ map: 'highlands', seed: 5, enemyKind: 'goblin', counts: { enemies: 5, projectiles: 3, pets: 2, pools: 1, towers: 4 } });
    const second = createStressFixture({ map: 'highlands', seed: 5, enemyKind: 'goblin', counts: { enemies: 999, projectiles: -4, pets: 2.8, pools: 1, towers: 4 } });
    const game = createRun({ seed: 5, map: 'highlands', mapSeed: 5, heroes: [], perks: [] });
    expect(first.run.cfg).not.toBe(second.run.cfg);
    expect(first.run.cfg).not.toBe(game.cfg);
    expect(first.run.enemies.items.slice(0, first.run.enemies.count).every(enemy => enemy.def.id === 'goblin')).toBe(true);
    expect(second.counts).toEqual({ enemies: 600, projectiles: 0, pets: 2, pools: 1, towers: 4 });
    const events = first.run.eventCount;
    const gold = first.run.gold;
    const rngMirror = createRun({ seed: 1, map: 'highlands', mapSeed: 5, heroes: [], perks: [] });
    const before = first.run.enemies.items.slice(0, first.run.enemies.count).map(enemy => [enemy.x, enemy.y]);
    moveStressFixture(first, 4.2);
    const after = first.run.enemies.items.slice(0, first.run.enemies.count).map(enemy => [enemy.x, enemy.y]);
    expect(after).not.toEqual(before);
    expect(after.flat().every(Number.isFinite)).toBe(true);
    expect(first.run.eventCount).toBe(events);
    expect(first.run.gold).toBe(gold);
    expect(first.run.rng.next()).toBe(rngMirror.rng.next());
    expect(first.run.towers).toHaveLength(4);
  });
});
