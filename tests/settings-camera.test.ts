import { Box3, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIRECTIONS, TILTS } from '../src/camera-preview/camera';
import { GameCamera3D } from '../src/render3d/camera';
import { generateMap } from '../src/sim/mapgen';
import { DEFAULT_UI, loadUi, saveUi, uiFromUrl } from '../src/ui/settings';

function memoryStorage(initial: string | null = null): Storage {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
    clear: vi.fn(() => { value = null; }),
    key: vi.fn(() => null),
    get length() { return value === null ? 0 : 1; },
  } as unknown as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('camera preferences', () => {
  it('keeps legacy UI settings and defaults to 2D, southeast, and classic isometric tilt', () => {
    const storage = memoryStorage(JSON.stringify({ slow: 'pause', paths: false }));
    vi.stubGlobal('window', { localStorage: storage });
    expect(loadUi()).toEqual({ ...DEFAULT_UI, slow: 'pause', paths: false });
    expect(DEFAULT_UI.renderer).toBe('2d');
    expect(DIRECTIONS[DEFAULT_UI.cameraDirection].short).toBe('SE');
    expect(TILTS[DEFAULT_UI.cameraTilt]).toBeCloseTo(35.264, 2);
  });

  it('ignores corrupt persisted camera and renderer values without losing legacy values', () => {
    const storage = memoryStorage(JSON.stringify({ slow: 'half', paths: true, renderer: 'webgl', cameraDirection: 9, cameraTilt: -1 }));
    vi.stubGlobal('window', { localStorage: storage });
    expect(loadUi()).toEqual(DEFAULT_UI);

    storage.getItem = vi.fn(() => '{broken');
    expect(loadUi()).toEqual(DEFAULT_UI);
  });

  it('persists all settings while URL overrides stay validated and transient', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    const settings = { ...DEFAULT_UI, slow: 'normal' as const, paths: false, renderer: '3d' as const, cameraDirection: 3 as const, cameraTilt: 0 as const };
    saveUi(settings);
    expect(JSON.parse(storage.getItem('gloamward-keep.ui.v1')!)).toEqual(settings);

    expect(uiFromUrl(new URLSearchParams('renderer=2d&direction=1&tilt=3'), settings)).toEqual({
      ...settings, renderer: '2d', cameraDirection: 1, cameraTilt: 3,
    });
    expect(uiFromUrl(new URLSearchParams('renderer=webgl&direction=4&tilt=oops'), settings)).toEqual(settings);
    expect(loadUi()).toEqual(settings);
  });

  it('supports every direction and tilt index and ignores invalid runtime indexes', () => {
    const terrain = generateMap('meadow', 4);
    const camera = new GameCamera3D();
    camera.layout(900, 600);
    camera.setTerrain(terrain, new Box3(new Vector3(-1, -1, -1), new Vector3(25, 5, 18)));
    const positions: Vector3[] = [];
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      for (let tilt = 0; tilt < TILTS.length; tilt++) {
        camera.configure(direction, tilt);
        positions.push(camera.camera.position.clone());
      }
    }
    expect(new Set(positions.map(position => `${position.x.toFixed(5)}:${position.y.toFixed(5)}:${position.z.toFixed(5)}`)).size).toBe(16);

    const before = camera.camera.position.clone();
    camera.configure(4, -1);
    expect(camera.camera.position.distanceTo(before)).toBeLessThan(1e-8);
  });
});
