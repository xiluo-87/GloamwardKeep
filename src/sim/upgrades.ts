import { BASE_WEAPONS, COMBOS, MAX_PASSIVES, MAX_WEAPONS, PASSIVE_IDS, PASSIVES, PassiveId, WEAPONS, WeaponId } from '../data/content';
import { Choice, passiveRank, RunState, weaponOf } from './state';

const weaponChoice = (id: WeaponId, rank: number): Choice => {
  const d = WEAPONS[id];
  const extra = rank === 3 ? d.rank3 : rank === 5 ? d.rank5 : undefined;
  return { kind: 'weapon', id, rank, name: d.name, glyph: d.glyph, colour: d.colour, desc: rank === 1 ? d.desc : `+20% damage${extra ? `. ${extra}` : ''}.` };
};
const passiveChoice = (id: PassiveId, rank: number): Choice => {
  const d = PASSIVES[id];
  return { kind: 'passive', id, rank, name: d.name, glyph: d.glyph, colour: d.colour, desc: d.desc };
};

const FALLBACK: Choice[] = [
  { kind: 'hp', id: 'hp', rank: 0, name: 'Warm Broth', glyph: '+H', colour: '#d94f6a', desc: '+20 HP.' },
  { kind: 'oil', id: 'oil', rank: 0, name: 'Spare Oil', glyph: '+O', colour: '#7ad7c2', desc: '+20 oil.' },
];

/** Everything currently on offer. Combinations come first and are always shown. */
export function choicePool(s: RunState): { combos: Choice[]; rest: Choice[] } {
  const combos: Choice[] = [];
  for (const c of COMBOS) {
    if (weaponOf(s, c.a)?.rank === 5 && weaponOf(s, c.b)?.rank === 5) {
      const d = WEAPONS[c.result];
      combos.push({ kind: 'combo', id: c.result, rank: 1, name: d.name, glyph: d.glyph, colour: d.colour, desc: `${d.desc} Replaces ${WEAPONS[c.a].name} and ${WEAPONS[c.b].name}.` });
    }
  }
  const rest: Choice[] = [];
  for (const w of s.weapons) if (w.rank < WEAPONS[w.id].maxRank) rest.push(weaponChoice(w.id, w.rank + 1));
  if (s.weapons.length < MAX_WEAPONS) {
    for (const id of BASE_WEAPONS) {
      const usedByCombo = COMBOS.some((c) => (c.a === id || c.b === id) && weaponOf(s, c.result));
      if (!weaponOf(s, id) && !usedByCombo) rest.push(weaponChoice(id, 1));
    }
  }
  for (const p of s.passives) if (p.rank < 5) rest.push(passiveChoice(p.id, p.rank + 1));
  if (s.passives.length < MAX_PASSIVES) {
    for (const id of PASSIVE_IDS) if (passiveRank(s, id) === 0) rest.push(passiveChoice(id, 1));
  }
  return { combos, rest };
}

export function rollChoices(s: RunState): Choice[] {
  const { combos, rest } = choicePool(s);
  const out = combos.slice(0, 3);
  while (out.length < 3 && rest.length > 0) out.push(rest.splice(s.rng.int(rest.length), 1)[0]);
  return out.length > 0 ? out : FALLBACK.slice();
}

export function recalcPassives(s: RunState): void {
  const p = s.player;
  const moth = s.cfg.character === 'mothchild';
  p.burnMul = 1 - passiveRank(s, 'trim') * 0.08;
  p.speed = 150 * (moth ? 1.15 : 1) * (1 + passiveRank(s, 'boots') * 0.07);
  p.armor = passiveRank(s, 'coat');
  p.pickupRange = 60 * (1 + passiveRank(s, 'hook') * 0.25);
  p.regen = passiveRank(s, 'heart') * 0.2;
  const maxOil = 100 + passiveRank(s, 'reservoir') * 20;
  if (maxOil > p.maxOil) p.oil += 10;
  p.maxOil = maxOil;
  const maxHp = 100 + (s.cfg.shop.frame ?? 0) * 10 + passiveRank(s, 'heart') * 20;
  if (maxHp > p.maxHp) p.hp += maxHp - p.maxHp;
  p.maxHp = maxHp;
  p.oil = Math.min(p.oil, p.maxOil);
}

export function applyChoice(s: RunState, c: Choice): void {
  if (c.kind === 'weapon') {
    const w = weaponOf(s, c.id as WeaponId);
    if (w) w.rank = c.rank;
    else s.weapons.push({ id: c.id as WeaponId, rank: 1, cd: 0.2 });
  } else if (c.kind === 'passive') {
    const p = s.passives.find((q) => q.id === c.id);
    if (p) p.rank = c.rank;
    else s.passives.push({ id: c.id as PassiveId, rank: 1 });
    recalcPassives(s);
  } else if (c.kind === 'combo') {
    const combo = COMBOS.find((k) => k.result === c.id);
    if (combo) {
      s.weapons = s.weapons.filter((w) => w.id !== combo.a && w.id !== combo.b);
      s.weapons.push({ id: combo.result, rank: 1, cd: 0.2 });
    }
  } else if (c.kind === 'hp') {
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + 20);
  } else {
    s.player.oil = Math.min(s.player.maxOil, s.player.oil + 20);
  }
}

/** Called by the UI (or a bot) with the chosen index. */
export function chooseUpgrade(s: RunState, index: number): void {
  if (!s.choices) return;
  const c = s.choices[index];
  if (!c) return;
  applyChoice(s, c);
  s.choices = null;
  s.pendingLevels--;
}

export function rerollChoices(s: RunState): void {
  if (!s.choices || s.rerolls <= 0) return;
  s.rerolls--;
  s.choices = rollChoices(s);
}
