import { describe, expect, it } from 'vitest';
import { STEP } from '../src/data/balance';
import { MAP_IDS } from '../src/data/maps';
import { Bot } from '../src/sim/bot';
import { createRun } from '../src/sim/state';
import { clearEvents, runXp, stepRun } from '../src/sim/step';

describe('headless run', () => {
  for (const map of MAP_IDS) {
    it(`bot plays ${map}`, () => {
      const s = createRun({ seed: 7, map, heroes: ['lamplighter'], perks: [] });
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
        'gold', Math.round(s.gold), 'xp', runXp(s), 'hero lvl', hero?.heroLevel, 'skills', hero?.skills.length, 'min', (s.t / 60).toFixed(1));
      expect(s.outcome).not.toBeNull();
    });
  }
});
