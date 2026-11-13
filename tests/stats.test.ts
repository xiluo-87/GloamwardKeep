import { describe, expect, it } from 'vitest';
import { HEIGHT, HERO, HEROES, StatMod, TOWERS, TOWER_HP } from '../src/data/balance';
import { build, sell, startWave, upgrade } from '../src/sim/actions';
import { appliedMods, buildCost, computeStats, maxHpOf, price, sellValue, upgradeOptions } from '../src/sim/stats';
import { perkMods } from '../src/sim/state';
import { buildUp, highTiles, mk, roadTiles } from './helpers';

const base = perkMods([]);
const T = (type: string, tier = 1, fork: 0 | 'a' | 'b' = 0, forkTier = 0, height = 0, heroLevel = 1, skills: number[] = []) =>
  ({ type, tier, fork, forkTier, height, heroLevel, skills }) as Parameters<typeof computeStats>[0];

/** Sum of a stat over base + a list of upgrade mods. */
const sum = (key: keyof StatMod, mods: StatMod[]): number => mods.reduce((a, m) => a + (m[key] ?? 0), 0);

describe('tower stats', () => {
  it('base archer matches the data', () => {
    const st = computeStats(T('archer'), base);
    expect(st.damage).toBe(TOWERS.archer.base.damage);
    expect(st.rate).toBe(TOWERS.archer.base.rate);
    expect(st.range).toBe(TOWERS.archer.base.range);
    expect(st.hitsFlying).toBe(1);
  });

  it('tiers add up', () => {
    const d = TOWERS.archer;
    const t2 = computeStats(T('archer', 2), base);
    const t3 = computeStats(T('archer', 3), base);
    expect(t2.damage).toBe(sum('damage', [d.base, d.tiers[0].add]));
    expect(t3.damage).toBe(sum('damage', [d.base, d.tiers[0].add, d.tiers[1].add]));
    expect(t3.rate).toBeCloseTo(sum('rate', [d.base, d.tiers[0].add, d.tiers[1].add]));
    expect(t3.range).toBe(sum('range', [d.base, d.tiers[0].add, d.tiers[1].add]));
  });

  it('fork A and fork B diverge from the same tier 3', () => {
    const d = TOWERS.archer;
    const a = computeStats(T('archer', 3, 'a', 1), base);
    const b = computeStats(T('archer', 3, 'b', 1), base);
    const t3 = computeStats(T('archer', 3), base);
    expect(a.range).toBe(t3.range + (d.forks.a[0].add.range ?? 0));
    expect(a.crit).toBeGreaterThan(0);
    expect(b.crit).toBe(0);
    expect(b.shots).toBe(t3.shots + (d.forks.b[0].add.shots ?? 0));
    expect(a.shots).toBe(t3.shots);
    // Second fork tier stacks on the first.
    const a2 = computeStats(T('archer', 3, 'a', 2), base);
    expect(a2.damage).toBe(a.damage + (d.forks.a[1].add.damage ?? 0));
    expect(a2.shred).toBeCloseTo(d.forks.a[1].add.shred ?? 0);
  });

  it('applied mods list base, tiers, then fork tiers in order', () => {
    const mods = appliedMods({ type: 'catapult', tier: 3, fork: 'b', forkTier: 2, heroLevel: 1, skills: [] });
    expect(mods).toEqual([TOWERS.catapult.base, ...TOWERS.catapult.tiers.map((u) => u.add), ...TOWERS.catapult.forks.b.map((u) => u.add)]);
  });

  it('palisade main line is walls: tiers add hit points', () => {
    const p = TOWERS.palisade;
    const t3 = computeStats(T('palisade', 3), base);
    expect(t3.hp).toBe(sum('hp', [p.base, p.tiers[0].add, p.tiers[1].add]));
    expect(computeStats(T('palisade', 3, 'a', 1), base).thorns).toBe(p.forks.a[0].add.thorns);
    expect(computeStats(T('palisade', 3, 'b', 1), base).hitsFlying).toBe(1);
    expect(computeStats(T('palisade'), base).hitsFlying).toBe(0);
  });

  it('shots floor at 1, rate at 0.1, and chain falloff is capped at 1', () => {
    const st = computeStats(T('mage', 3, 'a', 1), base);
    expect(st.chainFalloff).toBeLessThanOrEqual(1);
    const slow = computeStats(T('archer', 1), base);
    expect(slow.shots).toBeGreaterThanOrEqual(1);
    expect(slow.rate).toBeGreaterThanOrEqual(0.1);
  });
});

describe('height and perks', () => {
  it('range grows with height by HEIGHT.rangePerLevel', () => {
    const r0 = computeStats(T('archer'), base).range;
    for (let h = 0; h <= HEIGHT.max; h++) {
      expect(computeStats(T('archer', 1, 0, 0, h), base).range).toBeCloseTo(r0 * (1 + HEIGHT.rangePerLevel * h));
    }
  });

  it('a tower built on high ground gets the bonus', () => {
    const s = mk();
    const [x, y] = highTiles(s, 3)[0] ?? highTiles(s, 2)[0];
    const t = build(s, 'archer', x, y);
    expect(t).not.toBeNull();
    expect(t!.height).toBeGreaterThanOrEqual(2);
    expect(t!.stats.range).toBeCloseTo(TOWERS.archer.base.range! * (1 + HEIGHT.rangePerLevel * t!.height));
    const [rx, ry] = roadTiles(s)[0];
    const low = build(s, 'archer', rx, ry)!;
    expect(low.stats.range).toBe(TOWERS.archer.base.range);
  });

  it('highground perk adds to the per-level bonus; eagle multiplies range', () => {
    const hg = perkMods(['highground']);
    const eagle = perkMods(['eagle']);
    const r0 = TOWERS.archer.base.range!;
    expect(computeStats(T('archer', 1, 0, 0, 3), hg).range).toBeCloseTo(r0 * (1 + (HEIGHT.rangePerLevel + hg.heightRangeBonus) * 3));
    expect(computeStats(T('archer'), eagle).range).toBeCloseTo(r0 * eagle.rangeMul);
    expect(eagle.rangeMul).toBeGreaterThan(1);
  });

  it('sharpened perk raises damage and ability damage', () => {
    const m = perkMods(['sharpened']);
    expect(computeStats(T('archer'), m).damage).toBeCloseTo(TOWERS.archer.base.damage! * m.damageMul);
    const k = computeStats(T('knight'), m);
    expect(k.abilityDamage).toBeCloseTo(HEROES.knight.base.abilityDamage! * m.damageMul);
  });

  it('thrift lowers every price, upgrades and heroes included', () => {
    const m = perkMods(['thrift']);
    expect(m.costMul).toBeLessThan(1);
    expect(buildCost('archer', m)).toBe(Math.round(TOWERS.archer.cost * m.costMul));
    expect(buildCost('knight', m)).toBe(Math.round(HEROES.knight.cost * m.costMul));
    expect(price(100, m)).toBe(Math.round(100 * m.costMul));
    const s = mk({ perks: ['thrift'] });
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    expect(upgradeOptions(t, s.mods)[0].cost).toBe(price(TOWERS.archer.tiers[0].cost, s.mods));
  });

  it('perk mods fold together: starting gold, lives, sell refund, start level', () => {
    const m = perkMods(['purse', 'walls', 'salvage', 'veteran']);
    expect(m.startGold).toBeGreaterThan(base.startGold);
    expect(m.lives).toBeGreaterThan(base.lives);
    expect(m.sellRefund).toBe(0.9);
    expect(m.heroStartLevel).toBe(3);
    const s = mk({ perks: ['purse', 'walls'], gold: undefined });
    expect(s.lives).toBe(m.lives);
  });

  it('unknown perk ids are ignored', () => {
    expect(perkMods(['nope' as never])).toEqual(base);
  });
});

describe('hero stats', () => {
  it('grow per level and add skills', () => {
    const h = HEROES.knight;
    const l1 = computeStats(T('knight'), base);
    const l5 = computeStats(T('knight', 1, 0, 0, 0, 5), base);
    expect(l5.damage).toBe(l1.damage + 4 * (h.perLevel.damage ?? 0));
    // Skill 0 of branch 0 (+damage) and node 1 (burn).
    const sk = computeStats(T('knight', 1, 0, 0, 0, 5, [0, 1]), base);
    expect(sk.damage).toBe(l5.damage + (h.branches[0][0].add.damage ?? 0));
    expect(sk.burnDps).toBe(h.branches[0][1].add.burnDps);
  });

  it('druid gains fractional pets per level, floored', () => {
    const l1 = computeStats(T('druid'), base).pets;
    const l5 = computeStats(T('druid', 1, 0, 0, 0, 5), base).pets;
    expect(l1).toBe(HEROES.druid.base.pets);
    expect(l5).toBe(Math.floor(HEROES.druid.base.pets! + 4 * HEROES.druid.perLevel.pets!));
  });

  it('hit points follow gold invested for towers and level for heroes', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    expect(t.maxHp).toBe(Math.round(TOWER_HP.base + TOWER_HP.perGold * TOWERS.archer.cost));
    const [hx, hy] = highTiles(s)[1];
    const k = build(s, 'knight', hx, hy)!;
    expect(k.maxHp).toBe(TOWER_HP.heroBase);
    expect(maxHpOf({ hero: true, heroLevel: 4, invested: 0, stats: k.stats })).toBe(TOWER_HP.heroBase + 3 * TOWER_HP.heroPerLevel);
  });

  it('veteran starts heroes at level 3 and caps at the max', () => {
    const s = mk({ perks: ['veteran'] });
    const [x, y] = highTiles(s)[0];
    expect(build(s, 'knight', x, y)!.heroLevel).toBe(3);
    expect(Math.min(HERO.maxLevel, 3)).toBe(3);
  });
});

describe('upgrades and selling', () => {
  it('gives 1, 2, 1, 0 options through tiers, fork and fork tiers', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'catapult', x, y)!;
    expect(upgradeOptions(t, s.mods).map((o) => o.path)).toEqual(['tier']);
    expect(upgrade(s, t.uid)).toBe(true);
    expect(upgradeOptions(t, s.mods)).toHaveLength(1);
    expect(upgrade(s, t.uid)).toBe(true);
    expect(t.tier).toBe(3);
    expect(upgradeOptions(t, s.mods).map((o) => o.path)).toEqual(['a', 'b']);
    expect(upgrade(s, t.uid, 'a')).toBe(true);
    expect(t.fork).toBe('a');
    expect(upgradeOptions(t, s.mods)).toHaveLength(1);
    expect(upgrade(s, t.uid)).toBe(true);
    expect(t.forkTier).toBe(2);
    expect(upgradeOptions(t, s.mods)).toHaveLength(0);
    expect(upgrade(s, t.uid)).toBe(false);
  });

  it('heroes have no upgrade options', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const k = build(s, 'knight', x, y)!;
    expect(upgradeOptions(k, s.mods)).toEqual([]);
    expect(upgrade(s, k.uid)).toBe(false);
  });

  it('upgrading deducts gold and records the investment', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    const g = s.gold;
    expect(upgrade(s, t.uid)).toBe(true);
    expect(s.gold).toBe(g - TOWERS.archer.tiers[0].cost);
    expect(t.invested).toBe(TOWERS.archer.cost + TOWERS.archer.tiers[0].cost);
    expect(t.tier).toBe(2);
  });

  it('refuses when poor, and a fork must be chosen at the fork', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = buildUp(s, 'archer', x, y, ['tier', 'tier']);
    expect(upgrade(s, t.uid)).toBe(false);
    s.gold = 10;
    expect(upgrade(s, t.uid, 'a')).toBe(false);
    expect(t.fork).toBe(0);
  });

  it('cannot switch forks', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = buildUp(s, 'mage', x, y, ['tier', 'tier', 'a']);
    expect(upgrade(s, t.uid, 'b')).toBe(true); // buys the next tier of fork A instead
    expect(t.fork).toBe('a');
    expect(t.forkTier).toBe(2);
  });

  it('stats change after an upgrade and hit points grow with investment', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    const before = t.stats.damage;
    const hp = t.maxHp;
    upgrade(s, t.uid);
    expect(t.stats.damage).toBeGreaterThan(before);
    expect(t.maxHp).toBeGreaterThan(hp);
  });

  it('sell refunds floor(invested x sellRefund), frees the tile and removes the tower', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = buildUp(s, 'archer', x, y, ['tier']);
    startWave(s); // after a wave starts, the free undo refund is over
    const expected = Math.floor(t.invested * s.mods.sellRefund);
    expect(sellValue(t, s.mods)).toBe(expected);
    const g = s.gold;
    expect(sell(s, t.uid)).toBe(true);
    expect(s.gold).toBe(g + expected);
    expect(s.towers).toHaveLength(0);
    expect(s.occ[y * s.terrain.cols + x]).toBe(0);
    expect(build(s, 'archer', x, y)).not.toBeNull();
  });

  it('salvage perk raises the refund', () => {
    const s = mk({ perks: ['salvage'] });
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    startWave(s);
    expect(sellValue(t, s.mods)).toBe(Math.floor(TOWERS.archer.cost * 0.9));
  });

  it('gold spent since the wave started is refunded in full (undo)', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    expect(sellValue(t, s.mods)).toBe(TOWERS.archer.cost);
    startWave(s);
    expect(upgrade(s, t.uid)).toBe(true);
    const tierCost = TOWERS.archer.tiers[0].cost;
    expect(sellValue(t, s.mods)).toBe(tierCost + Math.floor(TOWERS.archer.cost * s.mods.sellRefund));
    const g = s.gold;
    sell(s, t.uid);
    expect(s.gold).toBe(g + tierCost + Math.floor(TOWERS.archer.cost * s.mods.sellRefund));
  });

  it('selling a road tower rebuilds the flow field; a hill tower does not', () => {
    const s = mk();
    const [rx, ry] = roadTiles(s)[0];
    const road = build(s, 'palisade', rx, ry)!;
    const v = s.flowVersion;
    sell(s, road.uid);
    expect(s.flowVersion).toBeGreaterThan(v);
    const [hx, hy] = highTiles(s)[0];
    const hill = build(s, 'archer', hx, hy)!;
    const v2 = s.flowVersion;
    sell(s, hill.uid);
    expect(s.flowVersion).toBe(v2);
  });
});
