import { afterEach, describe, expect, it, vi } from 'vitest';
import { RendererHost, type RendererFactories } from '../src/render/backend';
import type { GameRenderer } from '../src/render/view';
import { emit, createRun } from '../src/sim/state';

class CanvasStub {
  replacedBy: unknown;
  constructor(readonly label: string, private next: { value: number }) {}
  cloneNode(): CanvasStub { return new CanvasStub(`canvas-${++this.next.value}`, this.next); }
  replaceWith(canvas: unknown): void { this.replacedBy = canvas; }
}

function canvas(label = 'initial'): HTMLCanvasElement {
  return new CanvasStub(label, { value: 0 }) as unknown as HTMLCanvasElement;
}

function renderer(name: string, calls: string[]): GameRenderer {
  return {
    rotated: false, zoom: 1, reduceMotion: false,
    configureCamera: (direction, tilt) => calls.push(`${name}.camera:${direction}:${tilt}`),
    resize: () => calls.push(`${name}.resize`),
    setInsets: (top, bottom, left, right) => calls.push(`${name}.insets:${top}:${bottom}:${left}:${right}`),
    panBy: () => undefined, zoomAt: () => undefined, fitBoard: () => undefined, focusTile: () => undefined,
    tileToScreen: () => ({ x: 0, y: 0, r: 0 }), edgeArrowAt: () => null, screenToWorld: () => ({ x: 0, y: 0 }), screenToTile: () => null,
    resetFx: () => calls.push(`${name}.resetFx`), syncState: () => calls.push(`${name}.syncState`),
    consumeEvents: () => undefined, draw: () => undefined, drawTitle: () => calls.push(`${name}.drawTitle`),
    dispose: () => calls.push(`${name}.dispose`),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RendererHost backend switching', () => {
  it('switches both ways on fresh canvases and prepares the active run before rebinding input', async () => {
    const calls: string[] = [];
    const initialCanvas = canvas();
    const twoD = renderer('2d-first', calls);
    const threeD = renderer('3d', calls);
    const twoDAgain = renderer('2d-second', calls);
    let twoDCount = 0;
    const factories: RendererFactories = {
      canvas2d: () => [twoD, twoDAgain][twoDCount++],
      three: async () => threeD,
    };
    const host = await RendererHost.create(initialCanvas, '2d', { factories, cameraDirection: 2, cameraTilt: 3 });
    host.reduceMotion = true;
    host.setInsets(8, 12, 16, 20);
    const run = createRun({ seed: 3, map: 'meadow', mapSeed: 8, heroes: [], perks: [] });
    emit(run, 'hit', 12, 34);
    const before = { t: run.t, eventCount: run.eventCount, events: run.events.slice(0, run.eventCount).map(event => ({ ...event })), gold: run.gold };
    const rebound: HTMLCanvasElement[] = [];
    host.onCanvasChange = next => { calls.push('canvas-rebound'); rebound.push(next); };

    const first = await host.switchBackend('3d', run);
    expect(host.backend).toBe('3d');
    expect(first.canvas).toBe(host.canvas);
    expect(first.canvas).not.toBe(initialCanvas);
    expect((initialCanvas as unknown as CanvasStub).replacedBy).toBe(first.canvas);
    expect(threeD.reduceMotion).toBe(true);
    expect(calls.indexOf('3d.syncState')).toBeLessThan(calls.indexOf('canvas-rebound'));
    expect(calls.indexOf('canvas-rebound')).toBeLessThan(calls.indexOf('2d-first.dispose'));
    expect(run).toMatchObject({ t: before.t, eventCount: before.eventCount, gold: before.gold });
    expect(run.events.slice(0, run.eventCount)).toEqual(before.events);

    const first3dCanvas = host.canvas;
    const second = await host.switchBackend('2d', run);
    expect(host.backend).toBe('2d');
    expect(second.canvas).not.toBe(first3dCanvas);
    expect((first3dCanvas as unknown as CanvasStub).replacedBy).toBe(second.canvas);
    expect(calls).toContain('3d.dispose');
    expect(rebound).toEqual([first.canvas, second.canvas]);
    host.dispose();
    expect(calls.filter(call => call === '2d-second.dispose')).toHaveLength(1);
  });

  it('falls back from a failing WebGL constructor on another fresh canvas', async () => {
    const calls: string[] = [];
    const initialCanvas = canvas();
    const current = renderer('current', calls);
    const fallback = renderer('fallback', calls);
    let twoDCount = 0;
    const factories: RendererFactories = {
      canvas2d: () => twoDCount++ === 0 ? current : fallback,
      three: async () => { calls.push('3d.construct'); throw new Error('WebGL unavailable'); },
    };
    const host = await RendererHost.create(initialCanvas, '2d', { factories });
    const state = createRun({ seed: 4, map: 'canyon', mapSeed: 0, heroes: [], perks: [] });
    const result = await host.switchBackend('3d', state);

    expect(result.backend).toBe('2d');
    expect(result.error).toBeInstanceOf(Error);
    expect(host.backend).toBe('2d');
    expect(host.canvas).not.toBe(initialCanvas);
    expect((initialCanvas as unknown as CanvasStub).replacedBy).not.toBe(host.canvas);
    expect(calls).toContain('fallback.syncState');
    expect(calls).toContain('current.dispose');
    host.dispose();
  });

  it('retains the current renderer if both the requested backend and fallback constructors fail', async () => {
    const calls: string[] = [];
    const initialCanvas = canvas();
    const current = renderer('current', calls);
    const factories: RendererFactories = {
      canvas2d: () => { calls.push('2d.construct'); if (calls.filter(call => call === '2d.construct').length > 1) throw new Error('2D unavailable'); return current; },
      three: async () => { throw new Error('WebGL unavailable'); },
    };
    const host = await RendererHost.create(initialCanvas, '2d', { factories });
    const result = await host.switchBackend('3d');

    expect(result.backend).toBe('2d');
    expect(result.error).toBeInstanceOf(AggregateError);
    expect(host.canvas).toBe(initialCanvas);
    expect(host.backend).toBe('2d');
    expect(calls).not.toContain('current.dispose');
    host.dispose();
  });

  it('disposes a candidate that finishes construction after host disposal', async () => {
    const calls: string[] = [];
    const initialCanvas = canvas();
    let pendingCanvas: CanvasStub | undefined;
    let resolve!: (value: GameRenderer) => void;
    let started!: () => void;
    const pending = new Promise<GameRenderer>(accept => { resolve = accept; });
    const constructionStarted = new Promise<void>(accept => { started = accept; });
    const current = renderer('current', calls);
    const candidate = renderer('late', calls);
    const host = await RendererHost.create(initialCanvas, '2d', { factories: {
      canvas2d: () => current,
      three: target => { pendingCanvas = target as unknown as CanvasStub; started(); return pending; },
    } });
    const switching = host.switchBackend('3d');
    await constructionStarted;
    host.dispose();
    resolve(candidate);

    await expect(switching).rejects.toThrow(/disposed/i);
    expect(calls.filter(call => call === 'current.dispose')).toHaveLength(1);
    expect(calls.filter(call => call === 'late.dispose')).toHaveLength(1);
    expect(pendingCanvas?.replacedBy).toBe(host.canvas);
  });

  it('serializes overlapping switch requests against the newly active canvas and preserves RunState', async () => {
    const calls: string[] = [];
    const initialCanvas = canvas();
    let resolveThree!: (value: GameRenderer) => void;
    const pendingThree = new Promise<GameRenderer>(resolve => { resolveThree = resolve; });
    const initial = renderer('initial', calls), three = renderer('three', calls), finalTwoD = renderer('final-two-d', calls);
    let twoDCount = 0;
    const host = await RendererHost.create(initialCanvas, '2d', { factories: {
      canvas2d: () => twoDCount++ === 0 ? initial : finalTwoD,
      three: () => pendingThree,
    } });
    const run = createRun({ seed: 8, map: 'meadow', mapSeed: 3, heroes: [], perks: [] });
    emit(run, 'hit', 2, 9);
    const before = { gold: run.gold, eventCount: run.eventCount, t: run.t, event: { ...run.events[0] } };
    const first = host.switchBackend('3d', run);
    const second = host.switchBackend('2d', run);
    resolveThree(three);
    await first;
    await second;
    expect(host.backend).toBe('2d');
    expect(host.canvas).not.toBe(initialCanvas);
    expect((initialCanvas as unknown as CanvasStub).replacedBy).not.toBe(host.canvas);
    expect(run).toMatchObject({ gold: before.gold, eventCount: before.eventCount, t: before.t });
    expect(run.events[0]).toEqual(before.event);
    expect(calls.filter(call => call === 'initial.dispose')).toHaveLength(1);
    expect(calls.filter(call => call === 'three.dispose')).toHaveLength(1);
    host.dispose();
  });

  it('keeps the current renderer and simulation intact when candidate preparation and fallback both fail', async () => {
    const calls: string[] = [];
    const initial = renderer('initial', calls);
    const state = createRun({ seed: 14, map: 'canyon', mapSeed: 3, heroes: [], perks: [] });
    emit(state, 'hit', 5, 6);
    const before = { gold: state.gold, eventCount: state.eventCount, t: state.t, event: { ...state.events[0] } };
    let twoDCount = 0;
    const fallback = renderer('fallback', calls);
    fallback.syncState = () => { throw new Error('scene preparation failed'); };
    const candidate = renderer('candidate', calls);
    candidate.syncState = () => { throw new Error('3D scene preparation failed'); };
    const host = await RendererHost.create(canvas(), '2d', { factories: {
      canvas2d: () => twoDCount++ === 0 ? initial : fallback,
      three: async () => candidate,
    } });
    const result = await host.switchBackend('3d', state);
    expect(result.error).toBeInstanceOf(AggregateError);
    expect(host.backend).toBe('2d');
    expect(calls).toContain('candidate.dispose');
    expect(calls).toContain('fallback.dispose');
    expect(state).toMatchObject({ gold: before.gold, eventCount: before.eventCount, t: before.t });
    expect(state.events[0]).toEqual(before.event);
    expect(calls).not.toContain('initial.dispose');
    host.dispose();
  });
});
