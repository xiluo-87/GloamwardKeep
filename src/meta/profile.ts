// Between-run progress: profile XP, levels, unlocked heroes, perks and maps. Stored in localStorage.
import {
  HERO_IDS, HEROES, HeroId, MAP_BALANCE, MapId, PERK_IDS, PERKS, PerkId, PROFILE, profileXpNeed, RUN,
} from '../data/balance';

export const SAVE_KEY = 'gloamward-keep.save.v1';

export interface MapRecord { bestWave: number; wins: number }

export interface Profile {
  version: 1;
  /** Total profile XP ever earned. Levels are derived from it, nothing is spent. */
  xp: number;
  perks: PerkId[];
  heroes: HeroId[];
  map: MapId;
  maps: Partial<Record<MapId, MapRecord>>;
  runs: number;
  muted: boolean;
  reduceMotion: boolean;
}

export const defaultProfile = (): Profile => ({
  version: 1, xp: 0, perks: [], heroes: ['knight'], map: 'meadow', maps: {}, runs: 0, muted: false, reduceMotion: false,
});

/** Level from total XP, starting at 1. */
export function levelOf(xp: number): number {
  let level = 1;
  let left = xp;
  while (level < PROFILE.maxLevel && left >= profileXpNeed(level)) {
    left -= profileXpNeed(level);
    level++;
  }
  return level;
}

/** XP into the current level and XP needed for the next one (need is 0 at max level). */
export function levelProgress(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = xp;
  while (level < PROFILE.maxLevel && left >= profileXpNeed(level)) {
    left -= profileXpNeed(level);
    level++;
  }
  return { level, into: level >= PROFILE.maxLevel ? 0 : left, need: level >= PROFILE.maxLevel ? 0 : profileXpNeed(level) };
}

export const perkSlots = (level: number): number => PROFILE.perkSlotLevels.filter((l) => level >= l).length;
export const heroSlots = (level: number): number => RUN.heroSlots + (level >= RUN.secondHeroSlotLevel ? 1 : 0);
export const heroUnlocked = (level: number, id: HeroId): boolean => level >= HEROES[id].unlock;
export const perkUnlocked = (level: number, id: PerkId): boolean => level >= PERKS[id].unlock;
export const mapUnlocked = (level: number, id: MapId): boolean => level >= MAP_BALANCE[id].unlock;

/** Drops anything the profile's level doesn't allow, so the loadout is always valid. */
export function fixLoadout(p: Profile): void {
  const level = levelOf(p.xp);
  p.perks = [...new Set(p.perks)].filter((id) => perkUnlocked(level, id)).slice(0, perkSlots(level));
  p.heroes = [...new Set(p.heroes)].filter((id) => heroUnlocked(level, id)).slice(0, heroSlots(level));
  if (p.heroes.length === 0) p.heroes = ['knight'];
  if (!mapUnlocked(level, p.map)) p.map = 'meadow';
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/** Accepts anything and returns a valid profile; unknown or broken fields fall back to defaults. */
export function migrate(raw: unknown): Profile {
  const out = defaultProfile();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.xp = Math.floor(num(r.xp));
  out.runs = Math.floor(num(r.runs));
  out.muted = r.muted === true;
  out.reduceMotion = r.reduceMotion === true;
  if (Array.isArray(r.perks)) out.perks = r.perks.filter((x): x is PerkId => PERK_IDS.includes(x as PerkId));
  if (Array.isArray(r.heroes)) out.heroes = r.heroes.filter((x): x is HeroId => HERO_IDS.includes(x as HeroId));
  if (typeof r.map === 'string' && r.map in MAP_BALANCE) out.map = r.map as MapId;
  if (r.maps && typeof r.maps === 'object') {
    for (const id of Object.keys(MAP_BALANCE) as MapId[]) {
      const m = (r.maps as Record<string, unknown>)[id];
      if (!m || typeof m !== 'object') continue;
      const rec = m as Record<string, unknown>;
      out.maps[id] = { bestWave: Math.min(RUN.waves, Math.floor(num(rec.bestWave))), wins: Math.floor(num(rec.wins)) };
    }
  }
  fixLoadout(out);
  return out;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadProfile(store: Store | null): Profile {
  try {
    const text = store?.getItem(SAVE_KEY);
    return text ? migrate(JSON.parse(text)) : defaultProfile();
  } catch {
    return defaultProfile();
  }
}

export function writeProfile(store: Store | null, p: Profile): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(p));
  } catch {
    // Private windows can refuse storage. The game still runs.
  }
}

export interface RunResult { map: MapId; cleared: number; won: boolean; xp: number }

/** Adds a finished run. Returns the levels gained so the end screen can list new unlocks. */
export function recordRun(p: Profile, r: RunResult): { before: number; after: number } {
  const before = levelOf(p.xp);
  p.xp += Math.max(0, Math.floor(r.xp));
  p.runs++;
  const rec = p.maps[r.map] ?? { bestWave: 0, wins: 0 };
  rec.bestWave = Math.max(rec.bestWave, r.cleared);
  if (r.won) rec.wins++;
  p.maps[r.map] = rec;
  return { before, after: levelOf(p.xp) };
}

/** Everything that opens at exactly this level, for "new unlock" messages. */
export function unlocksAt(level: number): { heroes: HeroId[]; perks: PerkId[]; maps: MapId[]; perkSlot: boolean; heroSlot: boolean } {
  return {
    heroes: HERO_IDS.filter((h) => HEROES[h].unlock === level && level > 1),
    perks: PERK_IDS.filter((k) => PERKS[k].unlock === level),
    maps: (Object.keys(MAP_BALANCE) as MapId[]).filter((m) => MAP_BALANCE[m].unlock === level && level > 1),
    perkSlot: PROFILE.perkSlotLevels.includes(level),
    heroSlot: level === RUN.secondHeroSlotLevel,
  };
}
