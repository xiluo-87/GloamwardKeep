import { describe, expect, it } from 'vitest';
import { HEROES, MAP_BALANCE, PERKS, PERK_IDS, PROFILE, profileXpNeed, RUN, HERO_IDS } from '../src/data/balance';
import {
  defaultProfile, fixLoadout, heroSlots, levelOf, levelProgress, loadProfile, mapUnlocked, migrate, perkSlots,
  recordRun, SAVE_KEY, unlocksAt, writeProfile,
} from '../src/meta/profile';

/** Total XP at which a level begins. */
const xpFor = (level: number): number => {
  let t = 0;
  for (let l = 1; l < level; l++) t += profileXpNeed(l);
  return t;
};

const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe('levels', () => {
  it('xp need matches the formula', () => {
    expect(profileXpNeed(1)).toBe(Math.floor(80 + 40 + 6));
    expect(profileXpNeed(10)).toBe(80 + 400 + 600);
  });

  it('levelOf follows the cumulative curve', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(xpFor(2) - 1)).toBe(1);
    expect(levelOf(xpFor(2))).toBe(2);
    for (let l = 1; l <= PROFILE.maxLevel; l++) expect(levelOf(xpFor(l))).toBe(l);
    expect(levelOf(xpFor(PROFILE.maxLevel) * 100)).toBe(PROFILE.maxLevel);
  });

  it('levelProgress is consistent with levelOf and the need', () => {
    for (const xp of [0, 1, 125, 126, 500, 3000, 12345, 1e6]) {
      const p = levelProgress(xp);
      expect(p.level).toBe(levelOf(xp));
      if (p.level < PROFILE.maxLevel) {
        expect(p.need).toBe(profileXpNeed(p.level));
        expect(p.into).toBeLessThan(p.need);
        expect(xpFor(p.level) + p.into).toBe(xp);
      } else {
        expect(p.need).toBe(0);
      }
    }
  });

  it('slots follow level', () => {
    expect(perkSlots(1)).toBe(0);
    expect(perkSlots(2)).toBe(1);
    expect(perkSlots(9)).toBe(3);
    expect(perkSlots(25)).toBe(PROFILE.perkSlotLevels.length);
    expect(heroSlots(1)).toBe(RUN.heroSlots);
    expect(heroSlots(RUN.secondHeroSlotLevel)).toBe(RUN.heroSlots + 1);
  });
});

describe('migrate', () => {
  it('survives anything', () => {
    for (const bad of [null, undefined, 'x', 42, true, [], [1, 2], {}, () => 1]) {
      const p = migrate(bad);
      expect(p).toEqual(defaultProfile());
    }
  });

  it('sanitises numbers: NaN, Infinity, negatives, strings, floats', () => {
    expect(migrate({ xp: NaN }).xp).toBe(0);
    expect(migrate({ xp: Infinity }).xp).toBe(0);
    expect(migrate({ xp: -10 }).xp).toBe(0);
    expect(migrate({ xp: '500' }).xp).toBe(0);
    expect(migrate({ xp: 12.9 }).xp).toBe(12);
    expect(migrate({ runs: -3 }).runs).toBe(0);
    expect(migrate({ runs: 4.5 }).runs).toBe(4);
  });

  it('drops unknown ids and bad types', () => {
    const p = migrate({ xp: xpFor(25), perks: ['purse', 'nope', 7, null, 'walls'], heroes: ['knight', 'dragon', 3], map: 'moon' });
    expect(p.perks).toEqual(['purse', 'walls']);
    expect(p.heroes).toEqual(['knight']);
    expect(p.map).toBe('meadow');
    expect(migrate({ perks: 'purse', heroes: { a: 1 } })).toEqual(defaultProfile());
  });

  it('cleans map records', () => {
    const p = migrate({ maps: { meadow: { bestWave: 999, wins: -2 }, canyon: { bestWave: NaN, wins: 3.7 }, highlands: 'x', moon: { bestWave: 1, wins: 1 } } });
    expect(p.maps.meadow).toEqual({ bestWave: RUN.waves, wins: 0 });
    expect(p.maps.canyon).toEqual({ bestWave: 0, wins: 3 });
    expect(p.maps.highlands).toBeUndefined();
    expect(Object.keys(p.maps)).not.toContain('moon');
    expect(migrate({ maps: 5 }).maps).toEqual({});
  });

  it('keeps valid settings', () => {
    const p = migrate({ muted: true, reduceMotion: true, runs: 5, xp: 1000 });
    expect(p.muted).toBe(true);
    expect(p.reduceMotion).toBe(true);
    expect(p.runs).toBe(5);
    expect(p.xp).toBe(1000);
    expect(migrate({ muted: 'yes' }).muted).toBe(false);
  });

  it('a valid profile round-trips unchanged', () => {
    const p = defaultProfile();
    p.xp = xpFor(12) + 5;
    p.perks = ['purse', 'walls'];
    p.heroes = ['knight', 'cleric'];
    p.map = 'highlands';
    p.maps = { meadow: { bestWave: 12, wins: 1 } };
    p.runs = 9;
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('loadout rules', () => {
  it('enforces unlocks, slots, duplicates and the knight fallback', () => {
    const p = defaultProfile();
    p.xp = 0;
    p.perks = ['purse', 'walls'];
    p.heroes = ['druid', 'ranger'];
    p.map = 'canyon';
    fixLoadout(p);
    expect(p.perks).toEqual([]);
    expect(p.heroes).toEqual(['knight']);
    expect(p.map).toBe('meadow');

    p.xp = xpFor(3);
    p.perks = ['purse', 'purse', 'walls'];
    p.heroes = ['cleric', 'cleric', 'knight'];
    fixLoadout(p);
    expect(p.perks).toEqual(['purse']); // one slot at level 3
    expect(p.heroes).toEqual(['cleric']); // one hero slot
  });

  it('a second hero slot opens at the configured level', () => {
    const p = defaultProfile();
    p.xp = xpFor(RUN.secondHeroSlotLevel);
    p.heroes = ['knight', 'cleric', 'sorcerer'];
    fixLoadout(p);
    expect(p.heroes).toEqual(['knight', 'cleric']);
  });

  it('unlock levels agree with the data', () => {
    for (const id of HERO_IDS) expect(levelOf(xpFor(HEROES[id].unlock))).toBe(HEROES[id].unlock);
    expect(mapUnlocked(1, 'meadow')).toBe(true);
    expect(mapUnlocked(MAP_BALANCE.canyon.unlock - 1, 'canyon')).toBe(false);
    expect(mapUnlocked(MAP_BALANCE.canyon.unlock, 'canyon')).toBe(true);
  });

  it('unlocksAt lists what opens at exactly that level', () => {
    expect(unlocksAt(1)).toEqual({ heroes: [], perks: [], maps: [], perkSlot: false, heroSlot: false });
    const u3 = unlocksAt(HEROES.cleric.unlock);
    expect(u3.heroes).toContain('cleric');
    expect(unlocksAt(2).perkSlot).toBe(true);
    expect(unlocksAt(2).perks).toContain('purse');
    expect(unlocksAt(MAP_BALANCE.highlands.unlock).maps).toEqual(['highlands']);
    expect(unlocksAt(RUN.secondHeroSlotLevel).heroSlot).toBe(true);
    // Every perk shows up at exactly one level.
    const seen = PERK_IDS.filter((id) => unlocksAt(PERKS[id].unlock).perks.includes(id));
    expect(seen).toHaveLength(PERK_IDS.length);
  });
});

describe('recordRun', () => {
  it('adds xp, counts runs and keeps the best wave per map', () => {
    const p = defaultProfile();
    const r = recordRun(p, { map: 'meadow', cleared: 8, won: false, xp: 130 });
    expect(r).toEqual({ before: 1, after: 2 });
    expect(p.runs).toBe(1);
    expect(p.xp).toBe(130);
    expect(p.maps.meadow).toEqual({ bestWave: 8, wins: 0 });
    recordRun(p, { map: 'meadow', cleared: 5, won: false, xp: 10 });
    expect(p.maps.meadow?.bestWave).toBe(8);
    recordRun(p, { map: 'meadow', cleared: 30, won: true, xp: 500 });
    expect(p.maps.meadow).toEqual({ bestWave: 30, wins: 1 });
    expect(p.runs).toBe(3);
  });

  it('ignores negative or fractional xp', () => {
    const p = defaultProfile();
    recordRun(p, { map: 'canyon', cleared: 1, won: false, xp: -50 });
    expect(p.xp).toBe(0);
    recordRun(p, { map: 'canyon', cleared: 1, won: false, xp: 9.9 });
    expect(p.xp).toBe(9);
  });
});

describe('storage', () => {
  it('loads defaults from an empty or missing store', () => {
    expect(loadProfile(null)).toEqual(defaultProfile());
    expect(loadProfile(memoryStore())).toEqual(defaultProfile());
  });

  it('survives a store that throws', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadProfile(bad)).toEqual(defaultProfile());
    expect(() => writeProfile(bad, defaultProfile())).not.toThrow();
    expect(() => writeProfile(null, defaultProfile())).not.toThrow();
  });

  it('survives corrupt JSON', () => {
    const st = memoryStore();
    st.setItem(SAVE_KEY, '{not json');
    expect(loadProfile(st)).toEqual(defaultProfile());
    st.setItem(SAVE_KEY, '"a string"');
    expect(loadProfile(st)).toEqual(defaultProfile());
  });

  it('saves under a versioned key and loads it back', () => {
    const st = memoryStore();
    expect(SAVE_KEY).toMatch(/v\d+$/);
    const p = defaultProfile();
    p.xp = 500;
    p.runs = 2;
    writeProfile(st, p);
    expect(st.m.has(SAVE_KEY)).toBe(true);
    expect(loadProfile(st)).toEqual(migrate(p));
  });
});
