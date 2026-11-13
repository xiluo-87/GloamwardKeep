// UI-only settings kept in localStorage under their own key (the profile belongs to src/meta).
export type SlowMode = 'normal' | 'half' | 'pause';
const KEY = 'gloamward-keep.ui.v1';
export const SLOW_MODES: SlowMode[] = ['normal', 'half', 'pause'];
export const SLOW_TEXT: Record<SlowMode, string> = { normal: 'Normal', half: 'Half speed', pause: 'Pause' };
export const SLOW_FACTOR: Record<SlowMode, number> = { normal: 1, half: 0.5, pause: 0 };

export interface UiSettings { slow: SlowMode; /** Draw enemy paths (flyer lines and the ground route). */ paths: boolean }

export function loadUi(): UiSettings {
  const out: UiSettings = { slow: 'half', paths: true };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { slow?: unknown; paths?: unknown } | null;
    if (raw && typeof raw === 'object' && SLOW_MODES.includes(raw.slow as SlowMode)) out.slow = raw.slow as SlowMode;
    if (raw && typeof raw === 'object' && typeof raw.paths === 'boolean') out.paths = raw.paths;
  } catch {
    // Missing or corrupt: defaults.
  }
  return out;
}

export function saveUi(s: UiSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable.
  }
}
