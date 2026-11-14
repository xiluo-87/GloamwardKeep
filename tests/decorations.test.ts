import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { build, canBuild, canClear, clearCost } from '../src/sim/actions';
import { DECORATION, generateDecorations } from '../src/sim/decorations';
import { FEATURE, generateMap } from '../src/sim/mapgen';
import { nextTile } from '../src/sim/path';
import { createRun } from '../src/sim/state';

const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

function gameplayHashes(map: 'meadow' | 'highlands' | 'canyon', seed: number) {
  const terrain = generateMap(map, seed);
  return {
    chosenSeed: terrain.seed,
    height: digest(terrain.height),
    feature: digest(terrain.feature),
    spawns: digest(JSON.stringify(terrain.spawns)),
    goal: digest(JSON.stringify(terrain.goal)),
    gaps: digest(JSON.stringify(terrain.gaps)),
  };
}

describe('map decorations', () => {
  it.each([
    ['meadow', 0, {
      chosenSeed: 15838,
      height: '22f72537dc068f9ba6d358d88f69d29a2607de16bc5274c6655e99d7e6cd1a85',
      feature: 'b88d849604858ca7d60b583d2748c2663d96bafbfcf011910531f6e3c5ce8395',
      spawns: '3aa8e5fe469e54f48a213495d26a648c2b7c03172258d2847b4e7d16371bf9b3',
      goal: '25c63ac955abce36020eb5e60254173f2261522aee79951c6eb9b9075b07e671',
      gaps: '23a1949af220264b233d84414b378895ade13ae2aaba7b797ed8c14f489c4fb8',
    }],
    ['meadow', 17, {
      chosenSeed: 23774,
      height: '7876b373dece507b47556d48dc398a0840dd1064a27ebcd3177c594b030b7721',
      feature: '7908973afa879a994d0f59c8225555f9d7ee2c2204cd4ec70fa58ba30f84afe3',
      spawns: '443f6e8b0ec8884db7570f04a478a1b415d8c53a347e2e9bb65204e3aec3041b',
      goal: '4aa09931da72b8fc11efa026d93b596a5f56e081d6c2fd3227ea582c11ccd5ec',
      gaps: 'adf8969356c78d46526e7276f98720a8d150742ccdb2975a2e816b4c6e14b04f',
    }],
    ['highlands', 0, {
      chosenSeed: 0,
      height: '9008ac39d9e270330563ee3c635734f1a33c412a76c2e820ee208177ce74faec',
      feature: '78bc6d236659c5fdcaeecf89bd0ba50ecb16ce9c56765178d4c3b65787e17285',
      spawns: '9bc3e7b993d42c38412d3e64d343b68751778663fbf4d0f16901d48fa6422e7e',
      goal: 'ccd7a114af83acf62dfd80d06a11a45b213b4d56a2d593bcc8b16fc1e54cd58b',
      gaps: '61f917118a96588fc3891227ff15838249cb2a72edc51ff8d47e4d2628dcea0c',
    }],
    ['highlands', 31, {
      chosenSeed: 31,
      height: '26eff26a7582da917e75b76eef9493d5c0bc8e63951a45932d2ceb495c1b7661',
      feature: 'c907b00cfd51a9817f57bb26c8fcb528fc181d823e3371cbc6a4932f9d903e35',
      spawns: '443f6e8b0ec8884db7570f04a478a1b415d8c53a347e2e9bb65204e3aec3041b',
      goal: '94fa5d23ab4605bf38cb46a7f04863454ec3f3fe3bb1505eae55cf62ad684afe',
      gaps: 'dcc66a4b2c033dead254fc69e8625f0df12f19af96e470f4201372aa30391141',
    }],
    ['canyon', 0, {
      chosenSeed: 0,
      height: 'a4d4c4a679b42413699dd8f3fd63792a56e69232b6cd952d9255307e9212a18b',
      feature: '1b68cb1ded9ecd8f917d1a6955803d61b1e6419fc257c9107d64bfc542acc9b4',
      spawns: 'c2d69e7cf6468a0cca2d10c984f1eeaae7354058dd4d8d630cab8bad307fe197',
      goal: '4aa09931da72b8fc11efa026d93b596a5f56e081d6c2fd3227ea582c11ccd5ec',
      gaps: 'be002740d9723b7f7194209de6e9e48e85c99ee8b43174880a84feebb1aa9466',
    }],
    ['canyon', 29, {
      chosenSeed: 29,
      height: 'a67f6b80fd2bb0f3ebb7e727474bfdf4b5067ffd8aa4bb80f7f02441cd74d58b',
      feature: '991755456ac4a5c5e50020fb6664070c244f32763afe822d0485ba6e4e341c03',
      spawns: '464d09d40266053005ca822df55d0e6dca0104baaeb3f9c0a1320f1649920b25',
      goal: 'f92f4d1870fe2f7283eb852c5206729ac5572bc10f5face3a22bdd05abaac43e',
      gaps: '45dfb117b9933dae5ce35e8df91ff0e120e6dfb36c0691adcb7dbcb10c42ffbc',
    }],
  ] as const)('keeps gameplay map data bit-identical for %s seed %i', (map, seed, expected) => {
    expect(gameplayHashes(map, seed)).toEqual(expected);
  });

  it('is deterministic, varies with the seed, and stays sparse on eligible tiles', () => {
    const terrain = generateMap('highlands', 0);
    const first = generateDecorations(terrain);
    expect(Array.from(generateDecorations(terrain))).toEqual(Array.from(first));
    expect(Array.from(terrain.decoration)).toEqual(Array.from(first));

    const otherSeed = generateDecorations({ ...terrain, seed: terrain.seed + 1 });
    expect(Array.from(otherSeed)).not.toEqual(Array.from(first));

    const eligible = terrain.height.reduce((count, height, index) =>
      count + Number(height > 0 && terrain.feature[index] === FEATURE.none), 0);
    const dressed = first.reduce((count, value) => count + Number(value !== DECORATION.none), 0);
    expect(dressed).toBeGreaterThan(0);
    expect(dressed).toBeLessThan(eligible * 0.2);
    expect(first.some(value => value === DECORATION.bush)).toBe(true);
    expect(first.some(value => value === DECORATION.stones)).toBe(true);
  });

  it('weights stones more heavily than bushes on higher bare ground', () => {
    const terrain = generateMap('highlands', 0);
    const low = { decorated: 0, stones: 0 };
    const high = { decorated: 0, stones: 0 };
    for (let seed = 0; seed < 64; seed++) {
      const decoration = generateDecorations({ ...terrain, seed });
      for (let index = 0; index < decoration.length; index++) {
        if (terrain.feature[index] !== FEATURE.none) continue;
        const group = terrain.height[index] === 1 ? low : terrain.height[index] >= 3 ? high : null;
        if (!group || decoration[index] === DECORATION.none) continue;
        group.decorated++;
        if (decoration[index] === DECORATION.stones) group.stones++;
      }
    }
    expect(high.decorated).toBeGreaterThan(0);
    expect(low.decorated).toBeGreaterThan(0);
    expect(high.stones / high.decorated).toBeGreaterThan(low.stones / low.decorated);
  });

  it('leaves road, gates, keep, features, and inputs untouched', () => {
    const terrain = generateMap('canyon', 0);
    const height = terrain.height.slice();
    const feature = terrain.feature.slice();
    const spawns = structuredClone(terrain.spawns);
    const goal = [...terrain.goal];
    generateDecorations(terrain);

    expect(terrain.height).toEqual(height);
    expect(terrain.feature).toEqual(feature);
    expect(terrain.spawns).toEqual(spawns);
    expect(terrain.goal).toEqual(goal);
    for (let index = 0; index < terrain.decoration.length; index++) {
      if (terrain.height[index] === 0 || terrain.feature[index] !== FEATURE.none) expect(terrain.decoration[index]).toBe(DECORATION.none);
    }
    for (const [col, row] of [...terrain.spawns, terrain.goal]) {
      expect(terrain.decoration[row * terrain.cols + col]).toBe(DECORATION.none);
    }
  });

  it('does not make a decorated tile blocked, clearable, or part of pathing', () => {
    const cfg = { seed: 10, map: 'highlands' as const, mapSeed: 0, heroes: [], perks: [] };
    const s = createRun(cfg);
    const index = s.terrain.decoration.findIndex(value => value !== DECORATION.none);
    expect(index).toBeGreaterThanOrEqual(0);
    const col = index % s.terrain.cols, row = Math.floor(index / s.terrain.cols);
    const tile = s.terrain.decoration[index];
    expect(canBuild(s, 'archer', col, row)).toBe('ok');
    expect(clearCost(s, col, row)).toBe(0);
    expect(canClear(s, col, row)).toBe('nothing');

    const withoutDecoration = createRun(cfg);
    withoutDecoration.terrain.decoration.fill(DECORATION.none);
    expect(Array.from(s.flow)).toEqual(Array.from(withoutDecoration.flow));
    for (let i = 0; i < s.terrain.height.length; i++) if (s.terrain.height[i] === 0) {
      expect(nextTile(s, i)).toBe(nextTile(withoutDecoration, i));
    }
    expect(build(s, 'archer', col, row)).not.toBeNull();
    expect(s.terrain.decoration[index]).toBe(tile);
  });
});
