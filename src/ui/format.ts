import { StatKey, Stats, StatMod } from '../data/balance';
import { STAT_TEXT } from '../data/text';

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
