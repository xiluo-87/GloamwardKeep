import { describe, expect, it } from 'vitest';
import { MAP_BALANCE, MapId, STEP } from '../src/data/balance';
import { Bot } from '../src/sim/bot';
import { createRun } from '../src/sim/state';
import { clearEvents, runXp, stepRun } from '../src/sim/step';

describe('headless run', () => {
  for (const map of Object.keys(MAP_BALANCE) as MapId[]) {
    it(`bot plays ${map} to an outcome`, () => {
      const s = createRun({ seed: 7, map, mapSeed: 3, heroes: ['knight'], perks: [] });
      const bot = new Bot(s);
      let steps = 0;
      while (!s.outcome && steps < 60 * 60 * 40) {
        bot.update(STEP);
        stepRun(s);
        clearEvents(s);
        steps++;
      }
      const hero = s.towers.find((t) => t.hero);
      console.log(map, s.outcome, 'wave', s.wave, 'cleared', s.cleared, 'lives', s.lives, 'towers', s.towers.length,
        'gold', Math.round(s.gold), 'xp', runXp(s), 'hero lvl', hero?.heroLevel, 'min', (s.t / 60).toFixed(1));
      expect(s.outcome).not.toBeNull();
      expect(Number.isFinite(s.gold)).toBe(true);
    });
  }
});
