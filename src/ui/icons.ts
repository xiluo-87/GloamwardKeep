// Tiny inline-SVG icons, drawn in code. Each uses currentColor plus an accent so they read on wood and parchment.
import type { HeroId, TowerId } from '../data/balance';

const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const TOWER_ICONS: Record<TowerId, string> = {
  palisade: wrap('<path d="M4 20V8l2-3 2 3v12M10 20V6l2-4 2 4v14M16 20V8l2-3 2 3v12M3 20h18"/>'),
  archer: wrap('<path d="M6 21V10h12v11M5 10V7h3v2h2V7h4v2h2V7h3v3M12 21v-4M9 15h6"/><path d="M12 2v4M10 4l2-2 2 2" stroke="#c9972b"/>'),
  catapult: wrap('<path d="M3 20h18M6 20l4-9M14 20l-3-9M4 11l12-6" /><circle cx="18" cy="5" r="2.4" fill="#c9972b" stroke="#8a4a14"/><circle cx="6" cy="20" r="1.4"/><circle cx="14" cy="20" r="1.4"/>'),
  frost: wrap('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2" stroke="#3d82b8"/>'),
  mage: wrap('<path d="M12 21V9M9 21h6" /><path d="M12 2l2 4 4 .6-3 3 .8 4.2L12 11.7 8.2 13.8 9 9.6l-3-3L10 6z" fill="#9a63c9" stroke="#5c2f86"/>'),
  aviary: wrap('<path d="M3 13c3-5 6-6 9-2 3-4 6-3 9 2-3-1-5 0-6 2l-3 3-3-3c-1-2-3-3-6-2z" fill="#c9972b" stroke="#8a4a14"/>'),
  shrine: wrap('<path d="M6 21h12M8 21V11h8v10M7 11l5-8 5 8"/><path d="M12 14v4M10 16h4" stroke="#c9972b"/>'),
};

const HERO_ICONS: Record<HeroId, string> = {
  knight: wrap('<path d="M12 2l7 3v6c0 5-3 9-7 11-4-2-7-6-7-11V5z" fill="#cfd5dc" stroke="#4d5662"/><path d="M12 6v11M8 10h8" stroke="#8a2f2a"/>'),
  cleric: wrap('<circle cx="12" cy="12" r="9" fill="#f5e7b4" stroke="#c9972b"/><path d="M12 6v12M7 10h10" stroke="#8a2f2a" stroke-width="2.2"/>'),
  sorcerer: wrap('<path d="M13 2L5 14h6l-1 8 9-13h-6z" fill="#9a63c9" stroke="#5c2f86"/>'),
  ranger: wrap('<path d="M6 3c8 2 8 16 0 18M6 3v18M3 12h16M16 9l3 3-3 3" stroke="#3f6b2f"/>'),
  druid: wrap('<path d="M12 22V10M12 14c-5 0-8-3-8-8 5 0 8 3 8 8zM12 12c4 0 7-3 7-7-4 0-7 3-7 7z" fill="#7bb25f" stroke="#3f6b2f"/>'),
};

export const towerIcon = (id: TowerId): string => TOWER_ICONS[id];
export const heroIcon = (id: HeroId): string => HERO_ICONS[id];
export const iconFor = (id: TowerId | HeroId): string => (id in HERO_ICONS ? HERO_ICONS[id as HeroId] : TOWER_ICONS[id as TowerId]);

export const GOLD_ICON = wrap('<circle cx="12" cy="12" r="8.5" fill="#f3d27a" stroke="#8a5a14"/><path d="M12 7v10M9.5 9.5h4a1.6 1.6 0 010 3h-3a1.6 1.6 0 000 3h4" stroke="#8a5a14"/>');
export const HEART_ICON = wrap('<path d="M12 21C4 15 2 11 2 8a5 5 0 0110-1 5 5 0 0110 1c0 3-2 7-10 13z" fill="#c8453d" stroke="#6e1d19"/>');
export const WAVE_ICON = wrap('<path d="M5 21V3M5 4h13l-3 4 3 4H5" fill="#c9972b" stroke="#6e4a0e"/>');

export const ACTION_ICONS = {
  upgrade: wrap('<path d="M12 20V6M6 12l6-6 6 6" stroke="#3f6b2f" stroke-width="2.4"/><path d="M5 21h14"/>'),
  target: wrap('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="#a2352d" stroke="#a2352d"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  sell: wrap('<circle cx="12" cy="12" r="8.5" fill="#f3d27a" stroke="#8a5a14"/><path d="M8 12h8M13 9l3 3-3 3" stroke="#8a5a14"/>'),
  undo: wrap('<path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 8h-3" stroke="#3f6b2f" stroke-width="2.2"/>'),
  ability: wrap('<path d="M12 2l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 15.8 6.4 19.2l1.4-6.3L3 8.6 9.4 8z" fill="#cdb6ec" stroke="#5c2f86"/>'),
  skills: wrap('<path d="M12 21V8M12 14c-4 0-6-2-6-6 4 0 6 2 6 6zM12 11c3 0 5-2 5-5-3 0-5 2-5 5z" fill="#9ec677" stroke="#3f6b2f"/><path d="M6 21h12"/>'),
  clear: wrap('<path d="M5 20L15 6M13 4l7 5-3 2-6-4z" fill="#cfd5dc" stroke="#4d5662"/><path d="M5 20l3-1" />'),
  fit: wrap('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
};
