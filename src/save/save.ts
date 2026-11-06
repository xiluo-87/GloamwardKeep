import { CharacterId, SHOP, ShopId } from '../data/content';

export const SAVE_KEY = 'gloamward.save.v1';

export interface SaveData {
  version: 1;
  wax: number;
  totalWax: number;
  shop: Partial<Record<ShopId, number>>;
  bestTime: number;
  reachedDawn: boolean;
  runs: number;
  reduceMotion: boolean;
  muted: boolean;
}

export const defaultSave = (): SaveData => ({
  version: 1, wax: 0, totalWax: 0, shop: {}, bestTime: 0, reachedDawn: false, runs: 0, reduceMotion: false, muted: false,
});

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/** Accepts anything and returns a valid save; unknown or broken fields fall back to defaults. */
export function migrate(raw: unknown): SaveData {
  const out = defaultSave();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.wax = Math.floor(num(r.wax));
  out.totalWax = Math.floor(num(r.totalWax, out.wax));
  out.bestTime = num(r.bestTime);
  out.runs = Math.floor(num(r.runs));
  out.reachedDawn = r.reachedDawn === true;
  out.reduceMotion = r.reduceMotion === true;
  out.muted = r.muted === true;
  if (r.shop && typeof r.shop === 'object') {
    for (const item of SHOP) {
      const v = (r.shop as Record<string, unknown>)[item.id];
      const rank = Math.floor(num(v));
      if (rank > 0) out.shop[item.id] = Math.min(item.ranks, rank);
    }
  }
  return out;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSave(store: Store | null): SaveData {
  try {
    const text = store?.getItem(SAVE_KEY);
    return text ? migrate(JSON.parse(text)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(store: Store | null, data: SaveData): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private windows can refuse storage. The game still runs.
  }
}

export function characterUnlocked(save: SaveData, id: CharacterId): boolean {
  switch (id) {
    case 'lamplighter': return true;
    case 'chandler': return save.totalWax >= 300;
    case 'sexton': return save.bestTime >= 600;
    case 'mothchild': return save.reachedDawn;
  }
}

export const newMoonUnlocked = (save: SaveData): boolean => save.reachedDawn;

export function recordRun(save: SaveData, o: { t: number; dawn: boolean; wax: number }): void {
  save.wax += o.wax;
  save.totalWax += o.wax;
  save.bestTime = Math.max(save.bestTime, o.t);
  save.reachedDawn = save.reachedDawn || o.dawn;
  save.runs++;
}

export function buyUpgrade(save: SaveData, id: ShopId): boolean {
  const item = SHOP.find((i) => i.id === id);
  if (!item) return false;
  const rank = save.shop[id] ?? 0;
  if (rank >= item.ranks) return false;
  const cost = item.cost(rank);
  if (save.wax < cost) return false;
  save.wax -= cost;
  save.shop[id] = rank + 1;
  return true;
}
