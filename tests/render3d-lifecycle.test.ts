import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { tilePosition } from '../src/camera-preview/terrain';
import { build, clearTile, sell } from '../src/sim/actions';
import { FEATURE } from '../src/sim/mapgen';
import type { RunState } from '../src/sim/state';
import { createRun } from '../src/sim/state';

interface GraphicsMock {
  shadowMap: { enabled: boolean; type: number };
  setPixelRatio: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const mockState = vi.hoisted(() => ({
  graphics: [] as GraphicsMock[],
  loadAsync: vi.fn(),
}));

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor() { mockState.graphics.push(this as unknown as GraphicsMock); }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class { loadAsync = mockState.loadAsync; },
}));

import { Renderer3D } from '../src/render3d/renderer';

class FakeNotice {
  className = '';
  hidden = false;
  textContent = '';
  removed = false;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  remove(): void { this.removed = true; }
}

class FakeCanvas extends EventTarget {
  dataset: Record<string, string> = {};
  notice: FakeNotice | null = null;
  after(element: FakeNotice): void { this.notice = element; }
}

function installBrowser(): { canvas: FakeCanvas; notice: FakeNotice } {
  const canvas = new FakeCanvas();
  const notice = new FakeNotice();
  vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768 });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('document', { createElement: vi.fn(() => notice) });
  return { canvas, notice };
}

function createState(): RunState {
  return createRun({ seed: 10, map: 'meadow', mapSeed: 7, heroes: [], perks: [] });
}

function stateSnapshot(s: RunState): unknown {
  return {
    t: s.t, gold: s.gold, lives: s.lives, keep: s.keep, wave: s.wave, eventCount: s.eventCount,
    events: s.events.slice(0, s.eventCount).map(event => ({ ...event })),
    towers: s.towers.map(tower => ({ uid: tower.uid, x: tower.x, y: tower.y, hp: tower.hp, cd: tower.cd })),
    terrainVersion: s.terrainVersion, flowVersion: s.flowVersion,
    height: Array.from(s.terrain.height), features: Array.from(s.terrain.feature), decoration: Array.from(s.terrain.decoration),
    occ: Array.from(s.occ), flow: Array.from(s.flow),
  };
}

interface DecorationInstances { total: number; zeroScaled: number; visibleByTile: number[] }

function decorationInstances(root: Group, s: RunState): DecorationInstances {
  const mesh = root.getObjectByName('Small map decoration instances') as InstancedMesh | null;
  const visibleByTile = new Array(s.terrain.decoration.length).fill(0);
  if (!mesh) return { total: 0, zeroScaled: 0, visibleByTile };
  const matrix = new Matrix4();
  let zeroScaled = 0;
  const positions = Array.from(s.terrain.height, (_, index) => tilePosition(s.terrain, index));
  for (let instance = 0; instance < mesh.count; instance++) {
    mesh.getMatrixAt(instance, matrix);
    const elements = matrix.elements;
    if (elements[0] === 0 && elements[5] === 0 && elements[10] === 0) { zeroScaled++; continue; }
    const x = elements[12], z = elements[14];
    let closest = -1, closestDistance = Infinity;
    for (let index = 0; index < positions.length; index++) {
      const p = positions[index];
      const distance = Math.hypot(x - p.x, z - p.z);
      if (distance < closestDistance) { closest = index; closestDistance = distance; }
    }
    if (closestDistance < 0.38) visibleByTile[closest]++;
  }
  return { total: mesh.count, zeroScaled, visibleByTile };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockState.graphics.length = 0;
  mockState.loadAsync.mockReset();
  mockState.loadAsync.mockReturnValue(new Promise(() => {}));
});

describe('Renderer3D lifecycle', () => {
  it('prevents context loss, notifies the host, and restores the notice without changing the run', () => {
    const { canvas, notice } = installBrowser();
    const state = createState();
    const renderer = new Renderer3D(canvas as unknown as HTMLCanvasElement);
    renderer.syncState(state);
    const before = stateSnapshot(state);
    const interrupted = vi.fn();
    renderer.onGraphicsInterrupted = interrupted;

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(interrupted).toHaveBeenCalledOnce();
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/restoring/i);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(notice.hidden).toBe(true);
    expect(stateSnapshot(state)).toEqual(before);
    renderer.dispose();
  });

  it('aborts canvas listeners and disposes the graphics renderer only once', () => {
    const { canvas, notice } = installBrowser();
    const renderer = new Renderer3D(canvas as unknown as HTMLCanvasElement);
    const graphics = mockState.graphics[0];
    const interrupted = vi.fn();
    renderer.onGraphicsInterrupted = interrupted;

    renderer.dispose();
    renderer.dispose();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(graphics.dispose).toHaveBeenCalledOnce();
    expect(interrupted).not.toHaveBeenCalled();
    expect(notice.hidden).toBe(true);
    expect(notice.removed).toBe(true);
  });

  it('disposes a GLB that resolves after renderer disposal without installing it on actors', async () => {
    const { canvas } = installBrowser();
    const loading = deferred<GLTF>();
    mockState.loadAsync.mockReturnValueOnce(loading.promise);
    const renderer = new Renderer3D(canvas as unknown as HTMLCanvasElement);
    const actors = (renderer as unknown as { actors: { setTemplate(template: GLTF): void } }).actors;
    const setTemplate = vi.spyOn(actors, 'setTemplate');

    const scene = new Group();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    geometry.addEventListener('dispose', geometryDisposed);
    material.addEventListener('dispose', materialDisposed);
    scene.add(new Mesh(geometry, material));

    renderer.dispose();
    loading.resolve({ scene } as GLTF);
    await loading.promise;
    await Promise.resolve();

    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(setTemplate).not.toHaveBeenCalled();
    expect(canvas.dataset.model).toBe('loading');
    expect(mockState.graphics[0].dispose).toHaveBeenCalledOnce();
  });

  it('removes only a built tile decor through terrain rebuilds, then restores it in a same-seed run', () => {
    const { canvas } = installBrowser();
    const cfg = { seed: 10, map: 'highlands' as const, mapSeed: 0, heroes: [], perks: [] };
    const state = createRun(cfg);
    state.gold = 10000;
    const renderer = new Renderer3D(canvas as unknown as HTMLCanvasElement);
    const internals = renderer as unknown as {
      environment: { root: Group; decorations: { root: Group } } | null;
    };

    try {
      renderer.syncState(state);
      const environmentBefore = internals.environment!;
      const initial = decorationInstances(environmentBefore.decorations.root, state);
      expect(initial.total).toBeGreaterThan(0);
      expect(initial.zeroScaled).toBe(0);
      const buildTile = state.terrain.decoration.findIndex((kind, index) => kind !== 0 && initial.visibleByTile[index] > 0);
      expect(buildTile).toBeGreaterThanOrEqual(0);
      const buildCount = initial.visibleByTile[buildTile];
      const untouchedTile = initial.visibleByTile.findIndex((count, index) => index !== buildTile && count > 0);
      expect(untouchedTile).toBeGreaterThanOrEqual(0);
      const originalDecor = Array.from(state.terrain.decoration);
      const col = buildTile % state.terrain.cols, row = Math.floor(buildTile / state.terrain.cols);

      const tower = build(state, 'archer', col, row);
      expect(tower).not.toBeNull();
      const afterBuild = stateSnapshot(state);
      renderer.syncState(state);
      expect(stateSnapshot(state)).toEqual(afterBuild);
      const afterBuildDecor = decorationInstances(internals.environment!.decorations.root, state);
      expect(afterBuildDecor.visibleByTile[buildTile]).toBe(0);
      expect(afterBuildDecor.visibleByTile[untouchedTile]).toBe(initial.visibleByTile[untouchedTile]);
      expect(afterBuildDecor.zeroScaled).toBe(buildCount);
      for (let index = 0; index < initial.visibleByTile.length; index++) {
        if (index !== buildTile) expect(afterBuildDecor.visibleByTile[index]).toBe(initial.visibleByTile[index]);
      }
      expect(Array.from(state.terrain.decoration)).toEqual(originalDecor);

      expect(sell(state, tower!.uid)).toBe(true);
      renderer.syncState(state);
      expect(decorationInstances(internals.environment!.decorations.root, state).visibleByTile[buildTile]).toBe(0);

      const clearTileIndex = state.terrain.feature.findIndex((feature, index) => feature !== FEATURE.none && index !== buildTile);
      expect(clearTileIndex).toBeGreaterThanOrEqual(0);
      const clearCol = clearTileIndex % state.terrain.cols, clearRow = Math.floor(clearTileIndex / state.terrain.cols);
      const version = state.terrainVersion;
      expect(clearTile(state, clearCol, clearRow)).toBe(true);
      expect(state.terrainVersion).toBe(version + 1);
      const afterClear = stateSnapshot(state);
      renderer.syncState(state);
      expect(stateSnapshot(state)).toEqual(afterClear);
      expect(internals.environment).not.toBe(environmentBefore);
      const afterRebuildDecor = decorationInstances(internals.environment!.decorations.root, state);
      expect(afterRebuildDecor.visibleByTile[buildTile]).toBe(0);
      expect(afterRebuildDecor.visibleByTile[untouchedTile]).toBe(initial.visibleByTile[untouchedTile]);
      expect(afterRebuildDecor.zeroScaled).toBe(buildCount);

      const nextRun = createRun(cfg);
      expect(Array.from(nextRun.terrain.decoration)).toEqual(originalDecor);
      renderer.syncState(nextRun);
      const restartedDecor = decorationInstances(internals.environment!.decorations.root, nextRun);
      expect(restartedDecor.visibleByTile[buildTile]).toBe(buildCount);
      expect(restartedDecor.zeroScaled).toBe(0);
      expect(stateSnapshot(nextRun)).toEqual(stateSnapshot(createRun(cfg)));
    } finally {
      renderer.dispose();
    }
  });
});
