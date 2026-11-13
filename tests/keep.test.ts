import { describe, expect, it } from 'vitest';
import { KEEP, TOWER_IDS } from '../src/data/balance';
import { build, canBuild, learnSkill, upgrade, upgradeKeep } from '../src/sim/actions';
import { addHeroXp } from '../src/sim/combat';
import { keepCost, keepForTower, skillState, upgradeOptions } from '../src/sim/stats';
import { buildUp, eventsOf, highTiles, mk } from './helpers';

describe('the keep (per-run unlocks)', () => {
  it('starts every run at level 1', () => {
    const s = mk({ keep: 1 });
    expect(s.keep).toBe(1);
  });

  it('locks tower types until the keep is raised', () => {
    const s = mk({ keep: 1 });
    const [x, y] = highTiles(s)[0];
    for (const type of TOWER_IDS) {
      const check = canBuild(s, type, x, y);
      if (keepForTower(type) > 1) expect(check).toBe('locked');
      else expect(check).toBe('ok');
    }
    expect(build(s, 'catapult', x, y)).toBeNull();
    expect(upgradeKeep(s)).toBe(true);
    expect(canBuild(s, 'catapult', x, y)).toBe('ok');
    // Every type above level 2 is still locked.
    for (const type of TOWER_IDS) if (keepForTower(type) > 2) expect(canBuild(s, type, x, y)).toBe('locked');
  });

  it('costs gold per level and stops at the top', () => {
    const s = mk({ keep: 1, gold: 2000 });
    const g = s.gold;
    expect(keepCost(s)).toBe(KEEP.cost[1]);
    upgradeKeep(s);
    expect(s.gold).toBe(g - KEEP.cost[1]);
    expect(keepCost(s)).toBe(KEEP.cost[2]);
    upgradeKeep(s);
    expect(s.keep).toBe(KEEP.max);
    expect(keepCost(s)).toBe(0);
    expect(upgradeKeep(s)).toBe(false);
    expect(eventsOf(s, 'keep')).toHaveLength(2);
  });

  it('refuses without enough gold', () => {
    const s = mk({ keep: 1, gold: KEEP.cost[1] - 1 });
    expect(upgradeKeep(s)).toBe(false);
    expect(s.keep).toBe(1);
  });

  it('thrift lowers the keep price', () => {
    const s = mk({ keep: 1, perks: ['thrift'] });
    expect(keepCost(s)).toBeLessThan(KEEP.cost[1]);
  });

  it('limits upgrade depth: tier 3 and forks need higher keep levels', () => {
    const s = mk({ keep: 1 });
    const [x, y] = highTiles(s)[0];
    const t = buildUp(s, 'archer', x, y, ['tier']);
    expect(t.tier).toBe(2);
    expect(upgradeOptions(t, s.mods)[0].keep).toBe(KEEP.tier[2]);
    expect(upgrade(s, t.uid)).toBe(false);
    s.keep = KEEP.tier[2];
    expect(upgrade(s, t.uid)).toBe(true);
    expect(upgrade(s, t.uid, 'a')).toBe(s.keep >= KEEP.forkTier[0]);
    s.keep = KEEP.forkTier[0];
    if (t.fork === 0) expect(upgrade(s, t.uid, 'a')).toBe(true);
    expect(upgradeOptions(t, s.mods)[0].keep).toBe(KEEP.forkTier[1]);
    if (s.keep < KEEP.forkTier[1]) expect(upgrade(s, t.uid)).toBe(false);
  });

  it('gates hero skill nodes by keep level', () => {
    const s = mk({ keep: 1 });
    const [x, y] = highTiles(s)[0];
    const h = build(s, 'knight', x, y)!;
    addHeroXp(s, h, 1e6);
    expect(skillState(s, h, 0, 0)).toBe(KEEP.skillNode[0] > 1 ? 'needsKeep' : 'available');
    s.keep = KEEP.max;
    expect(learnSkill(s, h.uid, 0, 0)).toBe(true);
  });
});
