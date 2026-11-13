import { KEEP, StatKey, Stats, StatMod, TOWER_IDS } from '../data/balance';
import { STAT_TEXT, TOWER_TEXT } from '../data/text';

export const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const num = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

export function fmtStat(k: StatKey, v: number): string {
  const t = STAT_TEXT[k];
  if (t.flag) return 'yes';
  return t.pct ? `${Math.round(v * 100)}%` : `${num(k === 'range' ? Math.round(v) : v)}${t.unit ?? ''}`;
}

/** Stats worth a row, in reading order. Secondary numbers (durations, falloff) are folded into the notes. */
const SHOWN: StatKey[] = [
  'damage', 'rate', 'range', 'splash', 'cluster', 'chains', 'shots', 'cleave', 'pets', 'beam',
  'burnDps', 'poolDps', 'slow', 'stunChance', 'crit', 'shred',
  'buffDamage', 'buffRate', 'income', 'bounty', 'lifeRegen', 'thorns',
];

const FLAGS: [StatKey, string][] = [['hitsFlying', 'Hits flyers'], ['reveal', 'Detects stalkers'], ['jinxImmune', 'Jinx-proof']];

export function statRows(st: Stats | StatMod, overrides: Partial<Record<StatKey, number>> = {}): [string, string][] {
  const rows: [string, string][] = [];
  for (const k of SHOWN) {
    const v = overrides[k] ?? st[k] ?? 0;
    if (!v) continue;
    if (k === 'shots' && v <= 1) continue;
    rows.push([STAT_TEXT[k].label, fmtStat(k, v)]);
  }
  return rows;
}

export const flagList = (st: Stats | StatMod): string[] => FLAGS.filter(([k]) => (st[k] ?? 0) > 0).map(([, t]) => t);

export const statLine = (st: StatMod): string => statRows(st).map(([l, v]) => `${l} ${v}`).join(' · ');

export const roman = (n: number): string => ['', 'I', 'II', 'III', 'IV', 'V'][n] ?? String(n);

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Tower types a keep level unlocks, by short name. */
export const keepTowers = (level: number): string[] =>
  TOWER_IDS.filter((id) => KEEP.tower[id] === level).map((id) => TOWER_TEXT[id].name.replace(' Tower', ''));

/** What reaching a keep level unlocks, generated from KEEP: towers, upgrade depth and hero skills. */
export function keepUnlocks(level: number): string[] {
  const out: string[] = [];
  const towers = keepTowers(level);
  if (towers.length) out.push(joinNames(towers));
  const deep: string[] = [];
  if (KEEP.tier[1] === level) deep.push('Tier 2');
  if (KEEP.tier[2] === level) deep.push('Tier 3');
  if (KEEP.forkTier[0] === level) deep.push('first fork');
  if (KEEP.forkTier[1] === level) deep.push('final fork tier');
  if (deep.length) out.push(deep.join(' and '));
  const nodes = KEEP.skillNode.map((l, i) => (l === level ? i + 1 : 0)).filter(Boolean);
  if (nodes.length) out.push(nodes.length === 1 ? `Hero skill ${nodes[0]}` : `Hero skills ${nodes[0]}–${nodes[nodes.length - 1]}`);
  return out;
}
