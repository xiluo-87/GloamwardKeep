import { describe, expect, it } from 'vitest';
import { MAP_BALANCE, MapId, STEP } from '../src/data/balance';
import { Bot } from '../src/sim/bot';
import { generateMap } from '../src/sim/mapgen';
import { createRun, RunState } from '../src/sim/state';
import { clearEvents, stepRun } from '../src/sim/step';

function play(map: MapId, seed: number, mapSeed: number, maxMinutes = 40): RunState {
  const s = createRun({ seed, map, mapSeed, heroes: ['knight'], perks: [] });
  const bot = new Bot(s);
  for (let i = 0; i < maxMinutes * 3600 && !s.outcome; i++) {
    bot.update(STEP);
    stepRun(s);
    clearEvents(s);
  }
  return s;
}

const summary = (s: RunState) => ({
  outcome: s.outcome, wave: s.wave, cleared: s.cleared, lives: s.lives, gold: s.gold, kills: s.kills, leaked: s.leaked,
  towers: s.towers.map((t) => [t.type, t.tx, t.ty, t.tier, t.fork, t.forkTier, t.heroLevel]), t: s.t,
});

describe('determinism', () => {
  it('the same seed, map seed and bot give the same run', () => {
    const a = play('meadow', 11, 5);
    const b = play('meadow', 11, 5);
    expect(summary(a)).toEqual(summary(b));
    expect(Array.from(a.terrain.height)).toEqual(Array.from(b.terrain.height));
    expect(Array.from(a.terrain.feature)).toEqual(Array.from(b.terrain.feature));
    expect(a.outcome).not.toBeNull();
  });

  it('a different gameplay seed changes the run but not the map', () => {
    const a = play('highlands', 1, 5, 6);
    const b = play('highlands', 2, 5, 6);
    expect(Array.from(a.terrain.height)).toEqual(Array.from(b.terrain.height));
    expect(summary(a)).not.toEqual(summary(b));
  });

  it('map seeds make different maps', () => {
    for (const map of Object.keys(MAP_BALANCE) as MapId[]) {
      const a = generateMap(map, 1);
      const b = generateMap(map, 2);
      expect(Array.from(a.height)).not.toEqual(Array.from(b.height));
    }
  });
});
