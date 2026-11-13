import { describe, expect, it } from 'vitest';
import {
  ENEMIES, ENEMY_IDS, RUN, SPECIAL, WAVES, waveBonus, waveHpScale,
} from '../src/data/balance';
import { callWave, canCallWave, earlyBonus, startWave } from '../src/sim/actions';
import { hurt, spawnAtGate } from '../src/sim/combat';
import { tileCenter } from '../src/sim/hex';
import { Enemy, RunState } from '../src/sim/state';
import { runXp } from '../src/sim/step';
import { buildUp, highTiles, liveEnemies, mk, stepSecs, stepUntil } from './helpers';

/** Teleports a ground enemy next to the keep, heading into it. */
function sendToKeep(s: RunState, e: Enemy): void {
  const g = tileCenter(s.terrain.goal[0], s.terrain.goal[1]);
  e.x = e.px = g.x - 0.2; e.y = e.py = g.y;
  e.next = s.terrain.goal[1] * s.terrain.cols + s.terrain.goal[0];
  e.flowVersion = s.flowVersion;
}

describe('wave data', () => {
  it('has 30 waves and every group references a real enemy', () => {
    expect(WAVES).toHaveLength(RUN.waves);
    expect(RUN.waves).toBe(30);
    for (const [i, w] of WAVES.entries()) {
      expect(w.length, `wave ${i + 1}`).toBeGreaterThan(0);
      for (const [kind, count, gap, delay] of w) {
        expect(ENEMY_IDS).toContain(kind);
        expect(ENEMIES[kind]).toBeDefined();
        expect(count).toBeGreaterThan(0);
        expect(gap).toBeGreaterThan(0);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('bosses arrive on waves 15 and 30', () => {
    expect(WAVES[14].some(([k]) => k === 'ogreking')).toBe(true);
    expect(WAVES[29].some(([k]) => k === 'lich')).toBe(true);
  });

  it('hit point scaling starts at 1 and only grows', () => {
    expect(waveHpScale(1)).toBe(1);
    for (let w = 2; w <= RUN.waves; w++) expect(waveHpScale(w)).toBeGreaterThan(waveHpScale(w - 1));
  });

  it('wave bonus grows with the wave', () => {
    expect(waveBonus(10)).toBe(40 + 60);
    expect(waveBonus(2)).toBeGreaterThan(waveBonus(1));
  });
});

describe('starting waves', () => {
  it('schedules every group, sorted by time', () => {
    const s = mk();
    s.wave = 2;
    startWave(s);
    expect(s.wave).toBe(3);
    const total = WAVES[2].reduce((a, g) => a + g[1], 0);
    expect(s.spawns).toHaveLength(total);
    expect(s.waveLeft[3]).toBe(total);
    for (let i = 1; i < s.spawns.length; i++) expect(s.spawns[i].t).toBeGreaterThanOrEqual(s.spawns[i - 1].t);
    expect(s.spawns.filter((p) => p.kind === 'hexer')).toHaveLength(4);
    // Hexers start after their delay.
    expect(Math.min(...s.spawns.filter((p) => p.kind === 'hexer').map((p) => p.t))).toBe(WAVES[2][1][3]);
  });

  it('spawns enemies over time and counts the wave down', () => {
    const s = mk();
    callWave(s);
    expect(s.waiting).toBe(false);
    stepSecs(s, 3);
    expect(liveEnemies(s).length).toBeGreaterThan(0);
    expect(liveEnemies(s).length).toBeLessThan(WAVES[0][0][1]);
  });

  it('alternates gates on two-gate maps', () => {
    const s = mk({ map: 'canyon' });
    expect(s.terrain.spawns).toHaveLength(2);
    startWave(s);
    const gates = new Set(s.spawns.map((p) => p.gate % 2));
    expect(gates.size).toBe(2);
    const a = spawnAtGate(s, 'goblin', 0, 1)!;
    const b = spawnAtGate(s, 'goblin', 1, 1)!;
    const [g0, g1] = s.terrain.spawns;
    expect(a.y).toBeCloseTo(tileCenter(g0[0], g0[1]).y);
    expect(b.y).toBeCloseTo(tileCenter(g1[0], g1[1]).y);
    expect(a.y).not.toBe(b.y);
  });

  it('the next wave starts by itself after the gap, once spawning has finished', () => {
    const s = mk();
    callWave(s);
    expect(canCallWave(s)).toBe(false);
    const ok = stepUntil(s, () => s.wave === 2, 80);
    expect(ok).toBe(true);
    expect(s.t).toBeGreaterThan(RUN.waveGap);
  });
});

describe('payouts', () => {
  /** Spawns one goblin as the wave's only enemy, kills it, and returns gold before and after the clearing step. */
  function clearWave(s: RunState, wave: number) {
    const e = spawnAtGate(s, 'goblin', 0, wave)!;
    hurt(s, e, 1e6, 'physical', null);
    const before = s.gold;
    stepSecs(s, 1 / 60);
    return { before, after: s.gold };
  }

  it('pays waveBonus once when the wave clears', () => {
    const s = mk();
    const { before, after } = clearWave(s, 4);
    expect(after - before).toBe(waveBonus(4));
    expect(s.cleared).toBe(1);
    stepSecs(s, 1);
    expect(s.gold).toBe(after);
    expect(s.cleared).toBe(1);
  });

  it('adds Treasury income', () => {
    const s = mk();
    const [x, y] = highTiles(s)[0];
    const t = buildUp(s, 'shrine', x, y, ['tier', 'tier', 'b']);
    expect(t.stats.income).toBeGreaterThan(0);
    const { before, after } = clearWave(s, 2);
    expect(after - before).toBe(waveBonus(2) + Math.round(t.stats.income));
  });

  it('interest pays a capped share of banked gold', () => {
    const s = mk({ perks: ['interest'] });
    s.gold = 400;
    const { before, after } = clearWave(s, 2);
    expect(after - before).toBe(waveBonus(2) + Math.min(s.mods.interestCap, Math.floor(before * s.mods.interest)));
    s.gold = 1e6;
    const r = clearWave(s, 3);
    expect(r.after - r.before).toBe(waveBonus(3) + s.mods.interestCap);
  });

  it('kills pay the enemy gold, scaled by the bounty perk', () => {
    const s = mk({ perks: ['bounty'] });
    const e = spawnAtGate(s, 'orc', 0, 1)!;
    const g = s.gold;
    hurt(s, e, 1e6, 'physical', null);
    expect(s.gold - g).toBe(Math.round(ENEMIES.orc.gold * s.mods.goldMul));
    expect(s.kills).toBe(1);
  });

  it('calling a wave early pays earlyBonusPerSec for the time left', () => {
    const s = mk();
    callWave(s);
    // Wait until the wave has finished spawning but the countdown is still running.
    expect(stepUntil(s, () => s.spawnIdx >= s.spawns.length, 30)).toBe(true);
    stepSecs(s, 2);
    expect(canCallWave(s)).toBe(true);
    const bonus = earlyBonus(s);
    expect(bonus).toBe(Math.floor(s.nextIn * RUN.earlyBonusPerSec));
    expect(bonus).toBeGreaterThan(0);
    const g = s.gold;
    expect(callWave(s)).toBe(true);
    expect(s.gold - g).toBe(bonus);
    expect(s.wave).toBe(2);
  });

  it('the first call pays nothing, and the Eager perk multiplies the bonus', () => {
    const s = mk({ perks: ['haste'] });
    const g = s.gold;
    callWave(s);
    expect(s.gold).toBe(g);
    stepUntil(s, () => s.spawnIdx >= s.spawns.length, 30);
    expect(earlyBonus(s)).toBe(Math.floor(s.nextIn * RUN.earlyBonusPerSec * s.mods.earlyMul));
  });

  it('cannot call while a wave is still spawning, or after the last wave', () => {
    const s = mk();
    callWave(s);
    expect(callWave(s)).toBe(false);
    s.wave = RUN.waves;
    s.spawns.length = 0;
    expect(canCallWave(s)).toBe(false);
  });

  it('profile xp per cleared wave, scaled by the map, plus a victory bonus', () => {
    const s = mk();
    s.cleared = 3;
    expect(runXp(s)).toBe(7 + 8 + 9);
    s.outcome = 'won';
    expect(runXp(s)).toBe(7 + 8 + 9 + 150);
    const c = mk({ map: 'canyon' });
    c.cleared = 3;
    expect(runXp(c)).toBe(Math.round(24 * 1.6));
  });
});

describe('lives and losing', () => {
  it('a leaking enemy costs its lives value', () => {
    const s = mk();
    const e = spawnAtGate(s, 'orc', 0, 1)!;
    sendToKeep(s, e);
    stepSecs(s, 1 / 60);
    expect(s.lives).toBe(s.mods.lives - ENEMIES.orc.lives);
    expect(s.leaked).toBe(ENEMIES.orc.lives);
    expect(s.outcome).toBeNull();
  });

  it('losing happens at zero lives', () => {
    const s = mk();
    s.lives = 2;
    const e = spawnAtGate(s, 'orc', 0, 1)!;
    sendToKeep(s, e);
    stepSecs(s, 1 / 60);
    expect(s.lives).toBe(0);
    expect(s.outcome).toBe('lost');
  });

  it('winning needs the last wave out and the board empty', () => {
    const s = mk();
    s.wave = RUN.waves;
    s.waiting = false;
    stepSecs(s, 1 / 60);
    expect(s.outcome).toBe('won');
  });

  it('nothing steps after the run is over', () => {
    const s = mk();
    s.outcome = 'lost';
    const t = s.t;
    stepSecs(s, 1);
    expect(s.t).toBe(t);
  });
});

describe('special enemies', () => {
  it('wagons spill goblins when they die', () => {
    const s = mk();
    const w = spawnAtGate(s, 'wagon', 0, 1)!;
    hurt(s, w, 1e6, 'physical', null);
    const goblins = liveEnemies(s).filter((e) => e.def.id === 'goblin');
    expect(goblins).toHaveLength(SPECIAL.wagon.count);
    expect(liveEnemies(s).some((e) => e.def.id === 'wagon')).toBe(false);
  });

  it('the Ogre King sheds goblins as it loses hit points', () => {
    const s = mk();
    const k = spawnAtGate(s, 'ogreking', 0, 15)!;
    const goblins = () => liveEnemies(s).filter((e) => e.def.id === 'goblin').length;
    expect(goblins()).toBe(0);
    // Take it just under 90%: one shed.
    hurt(s, k, (k.maxHp * 0.11) / (1 - ENEMIES.ogreking.ward), 'magic', null);
    expect(goblins()).toBe(SPECIAL.ogreking.shedCount);
    // A big hit crossing two more thresholds sheds twice.
    hurt(s, k, (k.maxHp * 0.21) / (1 - ENEMIES.ogreking.ward), 'magic', null);
    expect(goblins()).toBe(SPECIAL.ogreking.shedCount * 3);
  });

  it('the Lich raises stalkers on a timer', () => {
    const s = mk();
    const l = spawnAtGate(s, 'lich', 0, 30)!;
    l.stunT = 1e9;
    l.cdB = 0;
    stepSecs(s, 0.1);
    expect(liveEnemies(s).filter((e) => e.def.id === 'stalker')).toHaveLength(SPECIAL.lich.spawnCount);
  });
});
