import { describe, expect, it } from 'vitest';
import { ENEMIES, HERO, HEROES, heroXpNeed } from '../src/data/balance';
import { build, learnSkill, sell, useAbility } from '../src/sim/actions';
import { addHeroXp, hurt } from '../src/sim/combat';
import { skillCode, skillCost, skillState } from '../src/sim/stats';
import { attackRate } from '../src/sim/step';
import { buildUp, frozenNear, highTiles, mk, stepSecs } from './helpers';

const knight = (s = mk()) => {
  const [x, y] = highTiles(s)[0];
  return { s, t: build(s, 'knight', x, y)!, x, y };
};

describe('skill tree', () => {
  it('node 1 is open at level 1; later nodes need the previous one and the level', () => {
    const { s, t } = knight();
    expect(skillState(s, t, 0, 0)).toBe('available');
    expect(skillState(s, t, 0, 1)).toBe('needsPrevious');
    expect(learnSkill(s, t.uid, 0, 1)).toBe(false);
    expect(learnSkill(s, t.uid, 0, 0)).toBe(true);
    expect(skillState(s, t, 0, 0)).toBe('learned');
    expect(skillState(s, t, 0, 1)).toBe('needsLevel');
    expect(learnSkill(s, t.uid, 0, 1)).toBe(false);
    addHeroXp(s, t, 1e5);
    expect(t.heroLevel).toBe(HERO.maxLevel);
    expect(skillState(s, t, 0, 1)).toBe('available');
  });

  it('level gates follow HERO.nodeLevel', () => {
    const { s, t } = knight();
    t.heroLevel = HERO.nodeLevel[1] - 1;
    learnSkill(s, t.uid, 0, 0);
    expect(skillState(s, t, 0, 1)).toBe('needsLevel');
    t.heroLevel = HERO.nodeLevel[1];
    expect(skillState(s, t, 0, 1)).toBe('available');
  });

  it('branches are independent', () => {
    const { s, t } = knight();
    expect(learnSkill(s, t.uid, 1, 0)).toBe(true);
    expect(learnSkill(s, t.uid, 2, 0)).toBe(true);
    expect(t.skills).toEqual([skillCode(1, 0), skillCode(2, 0)]);
  });

  it('only one capstone may be learned', () => {
    const { s, t } = knight();
    t.heroLevel = HERO.maxLevel;
    for (let n = 0; n < 4; n++) expect(learnSkill(s, t.uid, 0, n)).toBe(true);
    for (let n = 0; n < 3; n++) expect(learnSkill(s, t.uid, 1, n)).toBe(true);
    expect(skillState(s, t, 1, 3)).toBe('capstoneTaken');
    expect(learnSkill(s, t.uid, 1, 3)).toBe(false);
    expect(t.skills.filter((c) => c % 4 === 3)).toHaveLength(1);
  });

  it('deducts gold and records the investment; needs gold', () => {
    const { s, t } = knight();
    const g = s.gold;
    const inv = t.invested;
    expect(learnSkill(s, t.uid, 0, 0)).toBe(true);
    expect(s.gold).toBe(g - skillCost(0, s.mods));
    expect(s.gold).toBe(g - HERO.nodeCost[0]);
    expect(t.invested).toBe(inv + HERO.nodeCost[0]);
    s.gold = HERO.nodeCost[0] - 1;
    expect(skillState(s, t, 1, 0)).toBe('tooExpensive');
    expect(learnSkill(s, t.uid, 1, 0)).toBe(false);
  });

  it('skills change the stats immediately', () => {
    const { s, t } = knight();
    const d = t.stats.damage;
    learnSkill(s, t.uid, 0, 0);
    expect(t.stats.damage).toBe(d + (HEROES.knight.branches[0][0].add.damage ?? 0));
  });

  it('towers have no skills', () => {
    const s = mk();
    const t = build(s, 'archer', ...highTiles(s)[0])!;
    expect(learnSkill(s, t.uid, 0, 0)).toBe(false);
  });
});

describe('hero experience', () => {
  it('levels up from kills, carries over leftover xp and caps at the max level', () => {
    const { s, t } = knight();
    const need = heroXpNeed(1);
    addHeroXp(s, t, need + 5);
    expect(t.heroLevel).toBe(2);
    expect(t.heroXp).toBeCloseTo(5);
    addHeroXp(s, t, 1e9);
    expect(t.heroLevel).toBe(HERO.maxLevel);
    expect(t.heroXp).toBe(0);
    addHeroXp(s, t, 100);
    expect(t.heroLevel).toBe(HERO.maxLevel);
  });

  it('level ups raise stats and hit points', () => {
    const { s, t } = knight();
    const d = t.stats.damage;
    const hp = t.maxHp;
    addHeroXp(s, t, heroXpNeed(1));
    expect(t.stats.damage).toBe(d + (HEROES.knight.perLevel.damage ?? 0));
    expect(t.maxHp).toBeGreaterThan(hp);
  });

  it('the killer gets full xp, other heroes get the share', () => {
    const s = mk();
    const tiles = highTiles(s);
    const k = build(s, 'knight', tiles[0][0], tiles[0][1])!;
    const c = build(s, 'cleric', tiles[1][0], tiles[1][1])!;
    const e = frozenNear(s, 'orc', k.tx, k.ty, 400);
    hurt(s, e, 1e6, 'physical', k);
    expect(k.heroXp).toBeCloseTo(ENEMIES.orc.xp);
    expect(c.heroXp).toBeCloseTo(ENEMIES.orc.xp * HERO.share);
    const e2 = frozenNear(s, 'orc', k.tx, k.ty, 400);
    hurt(s, e2, 1e6, 'physical', null);
    expect(k.heroXp).toBeCloseTo(ENEMIES.orc.xp * (1 + HERO.share));
  });

  it('the tutor perk boosts experience', () => {
    const s = mk({ perks: ['tutor'] });
    const { t } = knight(s);
    addHeroXp(s, t, 10);
    expect(t.heroXp).toBeCloseTo(10);
    const e = frozenNear(s, 'goblin', t.tx, t.ty, 400);
    hurt(s, e, 1e6, 'physical', t);
    expect(t.heroXp).toBeCloseTo(10 + ENEMIES.goblin.xp * s.mods.heroXpMul);
  });

  it('every hero has 3 branches of 4 nodes and an ability', () => {
    for (const h of Object.values(HEROES)) {
      expect(h.branches).toHaveLength(3);
      for (const b of h.branches) expect(b).toHaveLength(4);
      expect(h.base.abilityCd).toBeGreaterThan(0);
    }
  });
});

describe('hero abilities', () => {
  it('start on a short delay and then go on cooldown', () => {
    const { s, t } = knight();
    expect(useAbility(s, t.uid)).toBe(false);
    t.abilityCd = 0;
    expect(useAbility(s, t.uid)).toBe(true);
    expect(t.abilityCd).toBe(t.stats.abilityCd);
    expect(useAbility(s, t.uid)).toBe(false);
    stepSecs(s, 1);
    expect(t.abilityCd).toBeLessThan(t.stats.abilityCd);
  });

  it('Charge damages and stuns everything nearby, but not bosses or far enemies', () => {
    const { s, t, x, y } = knight();
    t.abilityCd = 0;
    const near = frozenNear(s, 'orc', x, y, 60);
    const far = frozenNear(s, 'orc', x, y, 600);
    const boss = frozenNear(s, 'ogreking', x, y, 60, 15);
    near.stunT = far.stunT = boss.stunT = 0;
    near.hp = near.maxHp = far.hp = far.maxHp = 1e5;
    const bossHp = boss.hp;
    expect(useAbility(s, t.uid)).toBe(true);
    expect(near.stunT).toBeCloseTo(t.stats.abilityTime);
    expect(near.maxHp - near.hp).toBeGreaterThan(0);
    expect(far.stunT).toBe(0);
    expect(far.hp).toBe(far.maxHp);
    expect(boss.stunT).toBe(0);
    expect(boss.hp).toBeLessThan(bossHp);
  });

  it('Sanctify stuns enemies in its circle', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const c = build(s, 'cleric', x, y)!;
    c.abilityCd = 0;
    const e = frozenNear(s, 'goblin', x, y, 80);
    e.stunT = 0;
    e.hp = e.maxHp = 1e5;
    expect(useAbility(s, c.uid)).toBe(true);
    expect(e.stunT).toBeGreaterThan(0);
  });

  it('Arcane Barrage strikes the strongest enemies in range', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const m = build(s, 'sorcerer', x, y)!;
    m.abilityCd = 0;
    const trolls = [0, 1, 2].map((i) => {
      const e = frozenNear(s, 'troll', x, y, 40 + i * 10);
      return e;
    });
    const goblin = frozenNear(s, 'goblin', x, y, 30);
    m.stats.abilityTargets = 3;
    expect(useAbility(s, m.uid)).toBe(true);
    for (const e of trolls) expect(e.hp).toBeLessThan(e.maxHp);
    expect(goblin.hp).toBe(goblin.maxHp);
  });

  it('Rally makes every tower attack faster for a while', () => {
    const s = mk();
    const tiles = highTiles(s);
    const r = build(s, 'ranger', tiles[0][0], tiles[0][1])!;
    const a = build(s, 'archer', tiles[1][0], tiles[1][1])!;
    r.abilityCd = 0;
    a.x = r.x + 1000; a.y = r.y; // out of the ranger's own aura
    const rate = attackRate(a);
    expect(useAbility(s, r.uid)).toBe(true);
    expect(s.rallyT).toBe(r.stats.abilityTime);
    stepSecs(s, 0.1);
    expect(attackRate(a)).toBeCloseTo(rate * (1 + r.stats.abilityPower));
    stepSecs(s, r.stats.abilityTime + 1);
    expect(attackRate(a)).toBeCloseTo(rate);
  });

  it('Wild Hunt releases temporary hawks that expire', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const d = build(s, 'druid', x, y)!;
    stepSecs(s, 0.1);
    const own = s.pets.count;
    expect(own).toBe(d.stats.pets);
    d.abilityCd = 0;
    expect(useAbility(s, d.uid)).toBe(true);
    expect(s.pets.count).toBe(own + d.stats.abilityTargets);
    stepSecs(s, d.stats.abilityTime + 0.5);
    expect(s.pets.count).toBe(own);
  });

  it('hawks from an aviary are removed when it is sold', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const av = buildUp(s, 'aviary', x, y);
    stepSecs(s, 0.1);
    expect(s.pets.count).toBe(av.stats.pets);
    expect(s.pets.count).toBeGreaterThan(0);
    sell(s, av.uid);
    expect(s.pets.count).toBe(0);
  });
});
