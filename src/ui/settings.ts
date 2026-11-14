// UI-only settings kept in localStorage under their own key (the profile belongs to src/meta).
export type SlowMode = 'normal' | 'half' | 'pause';
const KEY = 'gloamward-keep.ui.v1';
export const SLOW_MODES: SlowMode[] = ['normal', 'half', 'pause'];
export const SLOW_TEXT: Record<SlowMode, string> = { normal: 'Normal', half: 'Half speed', pause: 'Pause' };
export const SLOW_FACTOR: Record<SlowMode, number> = { normal: 1, half: 0.5, pause: 0 };

export type RendererPreference = '2d' | '3d';
export type CameraPresetIndex = 0 | 1 | 2 | 3;
export interface UiSettings {
  slow: SlowMode;
  /** Draw enemy paths (flyer lines and the ground route). */ paths: boolean;
  renderer: RendererPreference;
  cameraDirection: CameraPresetIndex;
  cameraTilt: CameraPresetIndex;
}

export const DEFAULT_UI: UiSettings = { slow: 'half', paths: true, renderer: '2d', cameraDirection: 0, cameraTilt: 1 };

function cameraIndex(value: unknown, fallback: CameraPresetIndex): CameraPresetIndex {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3 ? Number(value) as CameraPresetIndex : fallback;
}

/** URL query overrides are transient; callers decide when an explicit change should be persisted. */
export function uiFromUrl(params: URLSearchParams, settings: UiSettings): UiSettings {
  const out = { ...settings };
  const renderer = params.get('renderer');
  if (renderer === '2d' || renderer === '3d') out.renderer = renderer;
  const direction = params.get('direction') ?? params.get('cameraDirection');
  const tilt = params.get('tilt') ?? params.get('cameraTilt');
  if (direction !== null && direction.trim() !== '') out.cameraDirection = cameraIndex(Number(direction), out.cameraDirection);
  if (tilt !== null && tilt.trim() !== '') out.cameraTilt = cameraIndex(Number(tilt), out.cameraTilt);
  return out;
}

export function loadUi(): UiSettings {
  const out: UiSettings = { ...DEFAULT_UI };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as {
      slow?: unknown; paths?: unknown; renderer?: unknown; cameraDirection?: unknown; cameraTilt?: unknown;
    } | null;
    if (raw && typeof raw === 'object' && SLOW_MODES.includes(raw.slow as SlowMode)) out.slow = raw.slow as SlowMode;
    if (raw && typeof raw === 'object' && typeof raw.paths === 'boolean') out.paths = raw.paths;
    if (raw && typeof raw === 'object') {
      if (raw.renderer === '2d' || raw.renderer === '3d') out.renderer = raw.renderer;
      out.cameraDirection = cameraIndex(raw.cameraDirection, out.cameraDirection);
      out.cameraTilt = cameraIndex(raw.cameraTilt, out.cameraTilt);
    }
  } catch {
    // Missing or corrupt: defaults.
  }
  return out;
}

export function saveUi(s: UiSettings): void {
  try {
    const safe: UiSettings = {
      slow: SLOW_MODES.includes(s.slow) ? s.slow : DEFAULT_UI.slow,
      paths: typeof s.paths === 'boolean' ? s.paths : DEFAULT_UI.paths,
      renderer: s.renderer === '3d' ? '3d' : '2d',
      cameraDirection: cameraIndex(s.cameraDirection, DEFAULT_UI.cameraDirection),
      cameraTilt: cameraIndex(s.cameraTilt, DEFAULT_UI.cameraTilt),
    };
    window.localStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    // Storage may be unavailable.
  }
}
