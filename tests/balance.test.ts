import { describe, expect, it } from 'vitest';
import { botChoose, botInput } from '../src/sim/bot';
import { createRun, Input } from '../src/sim/state';
import { stepRun } from '../src/sim/step';
import { chooseUpgrade } from '../src/sim/upgrades';

/** An unassisted bot, for tuning. It plays worse than a person but must not die instantly. */
function play(seed: number) {
  const s = createRun({ seed, character: 'lamplighter', newMoon: false, shop: {}, viewHalfW: 640, viewHalfH: 360 });
  const inp: Input = { mx: 0, my: 0, dim: false };
  let early = 0;
  let earlyN = 0;
  for (let i = 0; i < 60 * 60 * 25 && !s.over; i++) {
    if (s.choices) chooseUpgrade(s, botChoose(s, s.choices));
    botInput(s, inp);
    stepRun(s, inp);
    s.eventCount = 0;
    if (s.t < 180) { early += s.player.oil / s.player.maxOil; earlyN++; }
  }
  return { seed, t: Math.round(s.t), outcome: s.outcome, kills: s.kills, level: s.player.level, earlyOil: +(early / earlyN).toFixed(2), gutter: Math.round(s.stats.gutterTime), peak: s.stats.peakEnemies, phase: s.boss?.phase ?? 0 };
}

describe('balance', () => {
  it('gives an unassisted player a real run with oil in the target band', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(play);
    console.table(rows);
    const survived = rows.reduce((a, r) => a + r.t, 0) / rows.length;
    expect(survived).toBeGreaterThan(120);
  });
});
