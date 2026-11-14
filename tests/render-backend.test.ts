import { describe, expect, it } from 'vitest';
import { createGameRenderer } from '../src/render/backend';
import type { GameRenderer } from '../src/render/view';

describe('renderer startup and fallback ownership', () => {
  it('gives 2D a fresh canvas after a failing WebGL constructor claims the first', async () => {
    let replaced: unknown;
    const fresh = {} as HTMLCanvasElement;
    const canvas = { cloneNode: () => fresh, replaceWith: (next: unknown) => { replaced = next; } } as unknown as HTMLCanvasElement;
    const result = await createGameRenderer(canvas, true, {
      three: async received => { expect(received).toBe(canvas); throw new Error('Context unavailable'); },
      canvas2d: received => { expect(received).toBe(fresh); return {} as GameRenderer; },
    });
    expect(replaced).toBe(fresh);
    expect(result.canvas).toBe(fresh);
    expect(result.backend).toBe('2d');
    expect(result.error).toBeInstanceOf(Error);
  });

  it('keeps a successful backend and does not construct the unused renderer', async () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = {} as GameRenderer;
    const result = await createGameRenderer(canvas, true, {
      three: async () => renderer,
      canvas2d: () => { throw new Error('Must not request 2D on a WebGL canvas'); },
    });
    expect(result).toEqual({ canvas, renderer, backend: '3d' });
    const legacy = await createGameRenderer(canvas, false, {
      three: async () => { throw new Error('Must not load WebGL for 2D'); },
      canvas2d: () => renderer,
    });
    expect(legacy.backend).toBe('2d');
  });
});
