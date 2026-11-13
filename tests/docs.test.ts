// The design doc's price tables must match balance.ts, so the two can't drift apart.
import { describe, expect, it } from 'vitest';
import { HERO, HEROES, KEEP, TOWER_IDS, TOWERS } from '../src/data/balance';
import { HERO_TEXT, TOWER_TEXT } from '../src/data/text';
import doc from '../docs/DESIGN.md?raw';


const nums = (cell: string): number[] => (cell.match(/\d+(\.\d+)?/g) ?? []).map(Number);
const row = (name: string): string[] | undefined => {
  const line = doc.split('\n').find((l) => l.startsWith(`| ${name} |`));
  return line?.split('|').slice(1, -1).map((c) => c.trim());
};

describe('DESIGN.md matches balance.ts', () => {
  for (const id of TOWER_IDS) {
    it(`${id}: build, tier and fork prices`, () => {
      const d = TOWERS[id];
      const r = row(TOWER_TEXT[id].name);
      expect(r, `no towers-table row for ${TOWER_TEXT[id].name}`).toBeDefined();
      const [, , build, tiers, forkA, forkB] = r as string[];
      expect(nums(build)).toEqual([d.cost]);
      expect(nums(tiers)).toEqual(d.tiers.map((u) => u.cost));
      expect(nums(forkA)).toEqual(d.forks.a.map((u) => u.cost));
      expect(nums(forkB)).toEqual(d.forks.b.map((u) => u.cost));
    });
  }

  it('keep prices', () => {
    const r = row('II');
    const r3 = row('III');
    expect(doc).toContain(`(${KEEP.cost[1]} for II, ${KEEP.cost[2]} for III`);
    expect(r).toBeDefined();
    expect(r3).toBeDefined();
  });

  it('hero placement prices and skill costs', () => {
    for (const [id, h] of Object.entries(HEROES)) {
      const r = row(HERO_TEXT[id as keyof typeof HERO_TEXT].name);
      expect(r, `no heroes-table row for ${HERO_TEXT[id as keyof typeof HERO_TEXT].name}`).toBeDefined();
      expect((r as string[]).some((c) => nums(c).includes(h.cost))).toBe(true);
    }
    expect(doc).toContain(HERO.nodeCost.join(', ').replace(/, (\d+)$/, ' or $1'));
  });
});
