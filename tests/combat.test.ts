import { describe, expect, it } from 'vitest';
import { ENEMIES, RESIST_CAP, SHRED_CAP, SPECIAL } from '../src/data/balance';
import { build, upgrade } from '../src/sim/actions';
import { hurt, onHitEffects, resistOf, spawnAtGate } from '../src/sim/combat';
import { attackRate } from '../src/sim/step';
import { buildUp, frozenNear, highTiles, mk, stepSecs } from './helpers';

const fresh = (kind: Parameters<typeof spawnAtGate>[1]) => {
  const s = mk();
  const e = spawnAtGate(s, kind, 0, 1)!;
  return { s, e };
};

describe('damage rules', () => {
  it('armour reduces physical damage only', () => {
    const { s, e } = fresh('orc');
    const hp = e.hp;
    hurt(s, e, 100, 'physical', null);
    expect(hp - e.hp).toBeCloseTo(100 * (1 - ENEMIES.orc.armour));
    const hp2 = e.hp;
    hurt(s, e, 100, 'fire', null);
    expect(hp2 - e.hp).toBeCloseTo(100);
  });

  it('ward reduces fire and magic, not physical beyond armour', () => {
    const { s, e } = fresh('troll');
    const h0 = e.hp;
    hurt(s, e, 100, 'magic', null);
    expect(h0 - e.hp).toBeCloseTo(100 * (1 - ENEMIES.troll.ward));
    const h1 = e.hp;
    hurt(s, e, 100, 'fire', null);
    expect(h1 - e.hp).toBeCloseTo(100 * (1 - ENEMIES.troll.ward));
    const h2 = e.hp;
    hurt(s, e, 100, 'physical', null);
    expect(h2 - e.hp).toBeCloseTo(100 * (1 - ENEMIES.troll.armour));
  });

  it('shred lowers armour, never below zero', () => {
    const { s, e } = fresh('orc');
    e.shred = 0.2;
    expect(resistOf(e, 'physical')).toBeCloseTo(ENEMIES.orc.armour - 0.2);
    const h = e.hp;
    hurt(s, e, 100, 'physical', null);
    expect(h - e.hp).toBeCloseTo(100 * (1 - (ENEMIES.orc.armour - 0.2)));
    e.shred = SHRED_CAP;
    expect(resistOf(e, 'physical')).toBe(0);
    expect(resistOf(e, 'magic')).toBe(0);
  });

  it('shred from hits stacks up to SHRED_CAP', () => {
    const { s, e } = fresh('orc');
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    t.stats.shred = 0.3;
    onHitEffects(s, e, t);
    expect(e.shred).toBeCloseTo(0.3);
    onHitEffects(s, e, t);
    onHitEffects(s, e, t);
    expect(e.shred).toBe(SHRED_CAP);
  });

  it('resistance is capped so nothing is immune', () => {
    const { s, e } = fresh('goblin');
    e.def = { ...ENEMIES.goblin, armour: 0.99, ward: 0.99 };
    expect(resistOf(e, 'physical')).toBe(RESIST_CAP);
    expect(resistOf(e, 'fire')).toBe(RESIST_CAP);
    const h = e.hp;
    hurt(s, e, 100, 'magic', null);
    expect(h - e.hp).toBeCloseTo(100 * (1 - RESIST_CAP));
  });

  it('shields absorb damage before hit points', () => {
    const { s, e } = fresh('goblin');
    e.shield = 30;
    const h = e.hp;
    hurt(s, e, 20, 'physical', null);
    expect(e.hp).toBe(h);
    expect(e.shield).toBe(10);
    hurt(s, e, 25, 'physical', null);
    expect(e.shield).toBe(0);
    expect(h - e.hp).toBeCloseTo(15);
  });

  it('shields absorb after resistance', () => {
    const { s, e } = fresh('orc');
    e.shield = 65;
    hurt(s, e, 100, 'physical', null);
    expect(e.shield).toBeCloseTo(0);
    expect(e.hp).toBe(e.maxHp);
  });

  it('enemy hit points scale with the wave', () => {
    const s = mk();
    const a = spawnAtGate(s, 'goblin', 0, 1)!;
    const b = spawnAtGate(s, 'goblin', 0, 20)!;
    expect(b.maxHp).toBeGreaterThan(a.maxHp * 2);
    const boss = spawnAtGate(s, 'ogreking', 0, 15)!;
    expect(boss.maxHp).toBe(ENEMIES.ogreking.hp);
  });
});

describe('targeting', () => {
  it('stalkers cannot be targeted until a detecting tower covers them', () => {
    const s = mk();
    const tiles = highTiles(s);
    const archer = build(s, 'archer', tiles[0][0], tiles[0][1])!;
    const e = frozenNear(s, 'stalker', archer.tx, archer.ty, 30);
    e.hp = e.maxHp = 1e6;
    stepSecs(s, 3);
    expect(e.hp).toBe(e.maxHp);
    expect(e.revealed).toBe(false);
    // A Watch Shrine (tier 3) reveals it.
    const shrine = buildUp(s, 'shrine', tiles[1][0], tiles[1][1], ['tier', 'tier']);
    expect(shrine.stats.reveal).toBe(1);
    // Put the stalker inside the shrine's range.
    e.x = shrine.x + 20; e.y = shrine.y;
    archer.x = shrine.x - 20; archer.y = shrine.y;
    stepSecs(s, 3);
    expect(e.revealed).toBe(true);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('the knight detects stalkers by himself', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const k = build(s, 'knight', x, y)!;
    const e = frozenNear(s, 'stalker', x, y, 40);
    e.hp = e.maxHp = 1e6;
    stepSecs(s, 2);
    expect(k.stats.reveal).toBe(1);
    expect(e.revealed).toBe(true);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('towers without hitsFlying leave bats alone', () => {
    const s = mk();
    const tiles = highTiles(s);
    const cat = build(s, 'catapult', tiles[0][0], tiles[0][1])!;
    const frost = build(s, 'frost', tiles[1][0], tiles[1][1])!;
    expect(cat.stats.hitsFlying).toBe(0);
    expect(frost.stats.hitsFlying).toBe(0);
    const bat = frozenNear(s, 'bat', cat.tx, cat.ty, 20);
    bat.x = (cat.x + frost.x) / 2; bat.y = (cat.y + frost.y) / 2;
    bat.hp = bat.maxHp = 1e6;
    stepSecs(s, 4);
    expect(bat.hp).toBe(bat.maxHp);
  });

  it('archers, mages and aviaries do hit bats', () => {
    for (const type of ['archer', 'mage', 'aviary'] as const) {
      const s = mk();
      const [x, y] = highTiles(s)[0];
      build(s, type, x, y);
      const bat = frozenNear(s, 'bat', x, y, 30);
      bat.hp = bat.maxHp = 1e6;
      stepSecs(s, 4);
      expect(bat.hp, type).toBeLessThan(bat.maxHp);
    }
  });

  it('guard walls hit flyers, plain walls do not', () => {
    const s = mk();
    const tiles = highTiles(s);
    const wall = build(s, 'palisade', tiles[0][0], tiles[0][1])!;
    expect(wall.stats.hitsFlying).toBe(0);
    const guard = buildUp(s, 'palisade', tiles[1][0], tiles[1][1], ['tier', 'tier', 'b']);
    expect(guard.stats.hitsFlying).toBe(1);
  });

  it('catapults splash grounded enemies but not flyers in the blast', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    build(s, 'catapult', x, y);
    const g = frozenNear(s, 'goblin', x, y, 60);
    g.hp = g.maxHp = 1e6;
    stepSecs(s, 4);
    expect(g.hp).toBeLessThan(g.maxHp);
  });

  it('frost slows what it hits', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    build(s, 'frost', x, y);
    const g = frozenNear(s, 'goblin', x, y, 40);
    g.hp = g.maxHp = 1e6;
    stepSecs(s, 0.8);
    expect(g.slow).toBeGreaterThan(0);
  });
});

describe('statuses', () => {
  it('a hexer jinxes towers it passes, lowering attack speed', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    const rate = attackRate(t);
    frozenNear(s, 'hexer', x, y, 30);
    stepSecs(s, 0.2);
    expect(t.jinxT).toBeGreaterThan(0);
    expect(attackRate(t)).toBeCloseTo(rate * (1 - SPECIAL.hexer.jinxAmount));
  });

  it('jinx immunity blocks it', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    t.stats.jinxImmune = 1;
    frozenNear(s, 'hexer', x, y, 30);
    stepSecs(s, 0.2);
    expect(attackRate(t)).toBe(t.stats.rate);
  });

  it('silence stops attacks until it wears off', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    const g = frozenNear(s, 'goblin', x, y, 30);
    g.hp = g.maxHp = 1e6;
    t.silenceT = 3;
    stepSecs(s, 2);
    expect(g.hp).toBe(g.maxHp);
    stepSecs(s, 3);
    expect(g.hp).toBeLessThan(g.maxHp);
  });

  it('the Lich silences nearby towers', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = build(s, 'archer', x, y)!;
    const lich = frozenNear(s, 'lich', x, y, 50);
    lich.cdA = 0;
    stepSecs(s, 0.1);
    expect(t.silenceT).toBeGreaterThan(0);
  });

  it('shamans shield allies', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const sh = frozenNear(s, 'shaman', x, y, 0);
    const g = frozenNear(s, 'goblin', x, y, 20);
    sh.cdA = 0;
    stepSecs(s, 0.1);
    expect(g.shield).toBeGreaterThan(0);
    expect(sh.shield).toBe(0);
  });

  it('shrine auras buff the damage of towers in range', () => {
    const s = mk();
    const tiles = highTiles(s);
    const a = build(s, 'archer', tiles[0][0], tiles[0][1])!;
    const shrine = build(s, 'shrine', tiles[1][0], tiles[1][1])!;
    a.x = shrine.x + 10; a.y = shrine.y;
    stepSecs(s, 0.1);
    expect(a.buffDamage).toBeCloseTo(shrine.stats.buffDamage);
    expect(shrine.buffDamage).toBe(0);
  });

  it('burning deals fire damage over time', () => {
    const { s, e } = fresh('goblin');
    e.stunT = 1e9;
    e.burnDps = 10;
    e.burnT = 2;
    const h = e.hp;
    stepSecs(s, 1);
    expect(h - e.hp).toBeGreaterThan(9);
    expect(h - e.hp).toBeLessThan(11);
  });
});

describe('upgrade keeps working when upgraded mid-fight', () => {
  it('a tier 2 archer out-damages a tier 1 over the same time', () => {
    const dmg = (ups: number) => {
      const s = mk();
      const [x, y] = highTiles(s)[0];
      const t = build(s, 'archer', x, y)!;
      for (let i = 0; i < ups; i++) upgrade(s, t.uid);
      const g = frozenNear(s, 'goblin', x, y, 40);
      g.hp = g.maxHp = 1e6;
      stepSecs(s, 6);
      return g.maxHp - g.hp;
    };
    expect(dmg(2)).toBeGreaterThan(dmg(0));
  });
});
