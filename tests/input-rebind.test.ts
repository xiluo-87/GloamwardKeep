import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controls } from '../src/input/input';
import type { GameRenderer } from '../src/render/view';
import type { Session } from '../src/ui/session';

class InputCanvas extends EventTarget {
  setPointerCapture = vi.fn();
}

function pointerDown(pointerId: number): PointerEvent {
  return Object.assign(new Event('pointerdown'), {
    pointerId, clientX: 10, clientY: 20, button: 0, pointerType: 'touch',
  }) as PointerEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Controls canvas rebinding', () => {
  it('moves pointer listeners while keeping one window keyboard listener', () => {
    const windowTarget = new EventTarget();
    const addWindowListener = vi.spyOn(windowTarget, 'addEventListener');
    vi.stubGlobal('window', windowTarget);
    const oldCanvas = new InputCanvas();
    const nextCanvas = new InputCanvas();
    const anyKey = vi.fn();
    const controls = new Controls(oldCanvas as unknown as HTMLCanvasElement, {} as Session, {} as GameRenderer, {
      active: () => false, inRun: () => false, togglePause: () => undefined,
      togglePaths: () => undefined, toggleDebug: () => undefined, stepSpeed: () => undefined, anyKey,
    });

    expect(addWindowListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    oldCanvas.dispatchEvent(pointerDown(1));
    expect(anyKey).toHaveBeenCalledOnce();
    anyKey.mockClear();

    controls.setCanvas(nextCanvas as unknown as HTMLCanvasElement);
    oldCanvas.dispatchEvent(pointerDown(2));
    expect(anyKey).not.toHaveBeenCalled();
    nextCanvas.dispatchEvent(pointerDown(3));
    expect(anyKey).toHaveBeenCalledOnce();
    expect(addWindowListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    controls.dispose();
    anyKey.mockClear();
    nextCanvas.dispatchEvent(pointerDown(4));
    expect(anyKey).not.toHaveBeenCalled();
  });
});
