import { describe, expect, it } from 'vitest';
import { budgetRate, emberNeed, hpScale, RUN } from '../src/data/balance';
import { ENEMIES, waveAt } from '../src/data/content';
import { botChoose, botInput } from '../src/sim/bot';
import { spawnEnemy, sweepDead } from '../src/sim/enemies';
import { addOil, finalDamage, flameBurn, flameDamage, flameRadius, flameSpawn, postAt } from '../src/sim/lantern';
import { createRun, Input, RunConfig, RunState } from '../src/sim/state';
import { computeWax, stepRun } from '../src/sim/step';
import { chooseUpgrade, choicePool, rollChoices } from '../src/sim/upgrades';
import { buyUpgrade, characterUnlocked, defaultSave, loadSave, migrate, recordRun } from '../src/save/save';

const cfg = (o: Partial<RunConfig> = {}): RunConfig => ({ seed: 7, character: 'lamplighter', newMoon: false, shop: {}, viewHalfW: 640, viewHalfH: 360, ...o });
const idle: Input = { mx: 0, my: 0, dim: false };

function runBot(s: RunState, maxSteps: number, onStep?: (s: RunState) => void): void {
  const inp: Input = { mx: 0, my: 0, dim: false };
  for (let i = 0; i < maxSteps && !s.over; i++) {
    if (s.choices) chooseUpgrade(s, botChoose(s, s.choices));
    botInput(s, inp);
    stepRun(s, inp);
    s.eventCount = 0;
    onStep?.(s);
  }
}

describe('lantern rules', () => {
  it('scales with wick rank as designed', () => {
    expect(flameRadius('burning', 5, 0, Infinity)).toBe(370);
    expect(flameDamage('burning', 5)).toBeCloseTo(1.4);
    expect(flameBurn('burning', 5, 1)).toBeCloseTo(2.75);
    expect(flameSpawn('burning', 5)).toBeCloseTo(1.4);
  });
  it('dimming and guttering ignore the wick', () => {
    expect(flameRadius('dimmed', 5, 0, Infinity)).toBe(90);
    expect(flameBurn('dimmed', 5, 1)).toBeCloseTo(0.2);
    expect(flameDamage('dimmed', 5)).toBeCloseTo(0.7);
    expect(flameRadius('guttering', 5, 0, Infinity)).toBe(50);
    expect(flameBurn('guttering', 0, 1)).toBe(0);
  });
  it('burns oil, then gutters and hurts, and relights on any oil', () => {
    const s = createRun(cfg());
    s.player.oil = 1;
    for (let i = 0; i < 90; i++) stepRun(s, idle);
    expect(s.flame).toBe('guttering');
    const hp = s.player.hp;
    for (let i = 0; i < 60; i++) stepRun(s, idle);
    expect(hp - s.player.hp).toBeGreaterThanOrEqual(3.9);
    addOil(s, 4);
    stepRun(s, idle);
    expect(s.flame).toBe('burning');
  });
  it('burns about 0.2 oil/s when dimmed and 1 oil/s when burning', () => {
    const a = createRun(cfg());
    const b = createRun(cfg());
    for (let i = 0; i < 300; i++) { stepRun(a, { ...idle, dim: true }); stepRun(b, idle); a.choices = null; b.choices = null; }
    expect(70 - a.player.oil).toBeCloseTo(1, 1);
    expect(70 - b.player.oil).toBeCloseTo(5, 1);
  });
  it('light radius eases rather than snaps', () => {
    const s = createRun(cfg());
    stepRun(s, { ...idle, dim: true });
    expect(s.radius).toBeGreaterThan(190);
    for (let i = 0; i < 30; i++) stepRun(s, { ...idle, dim: true });
    expect(s.radius).toBeLessThan(95);
  });
});

describe('damage rules', () => {
  const base = { flame: 'burning' as const, wick: 0, inverted: false };
  it('darkness reduces damage to 40%', () => {
    expect(finalDamage(10, { ...base, inLight: true })).toBeCloseTo(10);
    expect(finalDamage(10, { ...base, inLight: false })).toBeCloseTo(4);
  });
  it('applies flame multipliers', () => {
    expect(finalDamage(10, { ...base, flame: 'dimmed', inLight: true })).toBeCloseTo(7);
    expect(finalDamage(10, { ...base, flame: 'guttering', inLight: true })).toBeCloseTo(5);
    expect(finalDamage(10, { ...base, wick: 5, inLight: true })).toBeCloseTo(14);
  });
  it('applies the final-phase exception regardless of darkness', () => {
    expect(finalDamage(10, { ...base, inverted: true, inLight: true })).toBeCloseTo(1);
    expect(finalDamage(10, { ...base, flame: 'dimmed', inverted: true, inLight: false })).toBeCloseTo(20);
  });
});

describe('curves and waves', () => {
  it('uses the ember curve', () => {
    expect(emberNeed(1)).toBe(9);
    expect(emberNeed(10)).toBe(85);
  });
  it('grows the spawn budget and enemy hp', () => {
    expect(budgetRate(0)).toBe(2);
    expect(budgetRate(839)).toBe(40);
    expect(budgetRate(900)).toBe(40);
    expect(hpScale(360)).toBe(2);
  });
  it('selects waves by time', () => {
    expect(Object.keys(waveAt(0).weights)).toEqual(['mite']);
    expect(waveAt(119).name).toBe('Dusk');
    expect(waveAt(120).weights.hollow).toBeGreaterThan(0);
    expect(waveAt(299).weights.snuffer).toBeUndefined();
    expect(waveAt(300).weights.snuffer).toBeGreaterThan(0);
    expect(waveAt(480).weights.hound).toBeGreaterThan(0);
  });
});

describe('lampposts and oil', () => {
  it('costs oil to light and shrinks to nothing after 45 s', () => {
    const s = createRun(cfg({ character: 'chandler' }));
    const post = postAt(s, 0, 0);
    s.player.x = post.x;
    s.player.y = post.y;
    for (let i = 0; i < 62; i++) stepRun(s, idle);
    expect(post.life).toBeGreaterThan(44);
    expect(s.player.oil).toBeLessThan(60);
    s.player.x += 2000;
    s.player.oil = 100;
    for (let i = 0; i < 46 * 60; i++) { stepRun(s, idle); s.choices = null; s.eventCount = 0; s.player.hp = 100; s.enemies.count = 0; }
    expect(post.life).toBe(0);
    expect(s.litPosts).toHaveLength(0);
  });
  it('kills inside lamppost light drop embers but no oil, even from elites', () => {
    const s = createRun(cfg());
    for (let i = 0; i < 50; i++) {
      const e = spawnEnemy(s, ENEMIES.mite, 500, 500, true);
      if (e) { e.inPost = true; e.hp = 0; }
    }
    sweepDead(s);
    const kinds = new Set(s.pickups.items.slice(0, s.pickups.count).map((k) => k.kind));
    expect([...kinds]).toEqual(['ember']);
  });
  it('elites outside a post always drop a flask', () => {
    const s = createRun(cfg());
    const e = spawnEnemy(s, ENEMIES.mite, 500, 500, true);
    if (e) e.hp = 0;
    sweepDead(s);
    expect(s.pickups.items.slice(0, s.pickups.count).some((k) => k.kind === 'flask')).toBe(true);
  });
  it('recycles the furthest common enemy at the cap', () => {
    const s = createRun(cfg());
    for (let i = 0; i < RUN.enemyCap; i++) spawnEnemy(s, ENEMIES.mite, 100 + i, 0);
    const uidFar = s.enemies.items[RUN.enemyCap - 1].uid;
    spawnEnemy(s, ENEMIES.mite, 5, 5);
    expect(s.enemies.count).toBe(RUN.enemyCap);
    expect(s.enemies.items.some((e) => e.uid === uidFar)).toBe(false);
  });
});

describe('spawning', () => {
  it('brings hound packs after 8:00, saving up for their cost', () => {
    const s = createRun(cfg({ startAt: 8 * 60 }));
    let hounds = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepRun(s, idle);
      s.choices = null;
      s.eventCount = 0;
      s.player.hp = 100;
      hounds = Math.max(hounds, s.enemies.items.slice(0, s.enemies.count).filter((e) => e.def.id === 'hound').length);
    }
    expect(hounds).toBeGreaterThanOrEqual(6);
  });
});

describe('upgrades', () => {
  it('offers three choices, then combinations at rank 5, then fallbacks', () => {
    const s = createRun(cfg());
    expect(rollChoices(s)).toHaveLength(3);
    s.weapons = [{ id: 'lash', rank: 5, cd: 1 }, { id: 'shard', rank: 5, cd: 1 }];
    expect(rollChoices(s)[0].kind).toBe('combo');
    s.choices = rollChoices(s);
    s.pendingLevels = 1;
    chooseUpgrade(s, 0);
    expect(s.weapons.map((w) => w.id)).toEqual(['stained']);
    s.weapons = [{ id: 'stained', rank: 1, cd: 1 }, { id: 'firemoth', rank: 1, cd: 1 }, { id: 'vigil', rank: 1, cd: 1 }];
    s.passives = (['wick', 'reservoir', 'trim', 'boots', 'coat', 'hook'] as const).map((id) => ({ id, rank: 5 }));
    expect(choicePool(s).rest).toHaveLength(0);
    expect(rollChoices(s).map((c) => c.kind)).toEqual(['hp', 'oil']);
  });
});

describe('boss', () => {
  function atBoss(): RunState {
    const s = createRun(cfg({ startAt: RUN.bossAt - 0.1 }));
    for (let i = 0; i < 12; i++) stepRun(s, idle);
    return s;
  }
  it('spawns at 14:00 and flips the rule at 25%', () => {
    const s = atBoss();
    const e = s.bossEnemy!;
    expect(e.hp).toBe(6000);
    e.hp = 6000 * 0.5;
    stepRun(s, idle);
    expect(s.boss!.phase).toBe(2);
    const cap = s.lightCap;
    for (let i = 0; i < 60; i++) { stepRun(s, idle); s.player.hp = 100; s.choices = null; s.eventCount = 0; }
    expect(cap - s.lightCap).toBeCloseTo(8, 0);
    e.hp = 6000 * 0.2;
    s.player.oil = 0;
    stepRun(s, idle);
    expect(s.boss!.phase).toBe(3);
    const oil = s.player.oil;
    for (let i = 0; i < 120; i++) { stepRun(s, idle); s.player.hp = 100; s.choices = null; s.eventCount = 0; }
    expect(s.player.oil).toBeGreaterThanOrEqual(oil);
  });
  it('plays the dawn after the kill and wins', () => {
    const s = atBoss();
    s.bossEnemy!.hp = 0;
    stepRun(s, idle);
    expect(s.bossDead).toBe(true);
    expect(s.enemies.count).toBe(0);
    for (let i = 0; i < 300 && !s.over; i++) stepRun(s, idle);
    expect(s.outcome).toBe('dawn');
  });
});

describe('save and wax', () => {
  it('survives missing or corrupt data', () => {
    expect(migrate(null)).toEqual(defaultSave());
    expect(migrate('nope')).toEqual(defaultSave());
    expect(migrate({ wax: -4, shop: { glass: 99, bogus: 1 }, bestTime: 'x' })).toMatchObject({ wax: 0, shop: { glass: 5 }, bestTime: 0 });
    expect(loadSave({ getItem: () => '{broken', setItem: () => undefined })).toEqual(defaultSave());
    expect(loadSave(null)).toEqual(defaultSave());
  });
  it('buys upgrades and unlocks characters', () => {
    const save = defaultSave();
    expect(buyUpgrade(save, 'glass')).toBe(false);
    recordRun(save, { t: 620, dawn: false, wax: 320 });
    expect(buyUpgrade(save, 'glass')).toBe(true);
    expect(save.shop.glass).toBe(1);
    expect(characterUnlocked(save, 'chandler')).toBe(true);
    expect(characterUnlocked(save, 'sexton')).toBe(true);
    expect(characterUnlocked(save, 'mothchild')).toBe(false);
  });
  it('computes wax', () => {
    expect(computeWax({ t: 600, kills: 500, dawn: false, chandler: false, newMoon: false })).toBe(55);
    expect(computeWax({ t: 900, kills: 0, dawn: true, chandler: true, newMoon: true })).toBe(243);
  });
});

describe('headless runs', () => {
  it('is deterministic for the same seed and inputs', () => {
    const a = createRun(cfg({ seed: 42 }));
    const b = createRun(cfg({ seed: 42 }));
    runBot(a, 3600);
    runBot(b, 3600);
    expect(a.kills).toBe(b.kills);
    expect(a.player.x).toBe(b.player.x);
    expect(a.player.oil).toBe(b.player.oil);
  });

  it('runs a full night at high speed without errors and with sane values', () => {
    const s = createRun(cfg({ seed: 3, shop: { frame: 5 } }));
    let earlyOilSum = 0;
    let earlyN = 0;
    let earlyMin = 100;
    runBot(s, 60 * 60 * 22, (r) => {
      r.player.hp = Math.max(r.player.hp, 60); // Survive so every system gets exercised.
      if (r.t < 180) { earlyOilSum += r.player.oil / r.player.maxOil; earlyN++; earlyMin = Math.min(earlyMin, r.player.oil); }
      expect(Number.isFinite(r.player.x)).toBe(true);
    });
    console.log('balance', { t: s.t, kills: s.kills, level: s.player.level, outcome: s.outcome, peak: s.stats.peakEnemies, earlyOilAvg: earlyOilSum / earlyN, earlyMin, gutter: s.stats.gutterTime, weapons: s.weapons.map((w) => `${w.id}${w.rank}`).join(',') });
    expect(s.outcome).toBe('dawn');
    expect(s.kills).toBeGreaterThan(500);
  });
});
