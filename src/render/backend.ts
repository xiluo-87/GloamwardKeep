import { Renderer } from './renderer';
import { defaultView, type GameRenderer, type ViewState } from './view';
import type { Terrain } from '../sim/mapgen';
import type { RunState } from '../sim/state';

export type RendererBackend = '2d' | '3d';
export interface RendererSelection { canvas: HTMLCanvasElement; renderer: GameRenderer; backend: RendererBackend; error?: unknown }
export interface RendererFactories {
  canvas2d(canvas: HTMLCanvasElement): GameRenderer;
  three(canvas: HTMLCanvasElement): Promise<GameRenderer>;
}

const defaults: RendererFactories = {
  canvas2d: canvas => new Renderer(canvas),
  three: async canvas => {
    const { Renderer3D } = await import('../render3d/renderer');
    return new Renderer3D(canvas);
  },
};

function freshCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  return fresh;
}

/** Startup helper retained for callers that only need a one-time backend choice. */
export async function createGameRenderer(canvas: HTMLCanvasElement, use3d: boolean, factories: RendererFactories = defaults): Promise<RendererSelection> {
  if (!use3d) return { canvas, renderer: factories.canvas2d(canvas), backend: '2d' };
  try {
    return { canvas, renderer: await factories.three(canvas), backend: '3d' };
  } catch (error) {
    const fresh = freshCanvas(canvas);
    return { canvas: fresh, renderer: factories.canvas2d(fresh), backend: '2d', error };
  }
}

export interface RendererHostOptions {
  cameraDirection?: number;
  cameraTilt?: number;
  factories?: RendererFactories;
}

/** Stable GameRenderer facade that replaces context-owned renderers without replacing game state. */
export class RendererHost implements GameRenderer {
  private current: GameRenderer;
  private currentCanvas: HTMLCanvasElement;
  private currentBackend: RendererBackend;
  private readonly factories: RendererFactories;
  private cameraDirection: number;
  private cameraTilt: number;
  private insets = { top: 0, bottom: 0, left: 0, right: 0 };
  private transition: Promise<unknown> = Promise.resolve();
  private interrupted?: () => void;
  private disposed = false;
  initialError?: unknown;
  onCanvasChange?: (canvas: HTMLCanvasElement) => void;

  private constructor(selection: RendererSelection, options: RendererHostOptions) {
    this.current = selection.renderer;
    this.currentCanvas = selection.canvas;
    this.currentBackend = selection.backend;
    this.factories = options.factories ?? defaults;
    this.cameraDirection = this.validIndex(options.cameraDirection, 0);
    this.cameraTilt = this.validIndex(options.cameraTilt, 1);
    this.initialError = selection.error;
    this.applyConfiguration(this.current);
  }

  static async create(canvas: HTMLCanvasElement, backend: RendererBackend, options: RendererHostOptions = {}): Promise<RendererHost> {
    const selection = await createGameRenderer(canvas, backend === '3d', options.factories ?? defaults);
    return new RendererHost(selection, options);
  }

  get canvas(): HTMLCanvasElement { return this.currentCanvas; }
  get backend(): RendererBackend { return this.currentBackend; }
  get rotated(): boolean { return this.current.rotated; }
  get zoom(): number { return this.current.zoom; }
  get reduceMotion(): boolean { return this.current.reduceMotion; }
  set reduceMotion(value: boolean) { this.current.reduceMotion = value; }
  get onGraphicsInterrupted(): (() => void) | undefined { return this.interrupted; }
  set onGraphicsInterrupted(handler: (() => void) | undefined) {
    this.interrupted = handler;
    if ('onGraphicsInterrupted' in this.current) this.current.onGraphicsInterrupted = handler;
  }

  /** Switches contexts on a fresh canvas and prepares the new scene before publishing it. */
  switchBackend(backend: RendererBackend, state?: RunState, titleTerrain?: Terrain, view?: ViewState): Promise<RendererSelection> {
    const operation = this.transition.then(() => this.performSwitch(backend, state, titleTerrain, view));
    this.transition = operation.catch(() => undefined);
    return operation;
  }

  configureCamera(directionIndex: number, tiltIndex: number): void {
    this.cameraDirection = this.validIndex(directionIndex, this.cameraDirection);
    this.cameraTilt = this.validIndex(tiltIndex, this.cameraTilt);
    this.current.configureCamera?.(this.cameraDirection, this.cameraTilt);
  }

  resize(): void { this.current.resize(); }
  setInsets(top: number, bottom: number, left: number, right: number): void {
    this.insets = { top, bottom, left, right };
    this.current.setInsets(top, bottom, left, right);
  }
  panBy(dx: number, dy: number): void { this.current.panBy(dx, dy); }
  zoomAt(x: number, y: number, factor: number): void { this.current.zoomAt(x, y, factor); }
  fitBoard(): void { this.current.fitBoard(); }
  focusTile(col: number, row: number, avoidBottom?: number): void { this.current.focusTile(col, row, avoidBottom); }
  tileToScreen(col: number, row: number): { x: number; y: number; r: number } { return this.current.tileToScreen(col, row); }
  edgeArrowAt(x: number, y: number): { col: number; row: number } | null { return this.current.edgeArrowAt(x, y); }
  screenToWorld(x: number, y: number): { x: number; y: number } { return this.current.screenToWorld(x, y); }
  screenToTile(x: number, y: number): { col: number; row: number } | null { return this.current.screenToTile(x, y); }
  resetFx(): void { this.current.resetFx(); }
  syncState(s: RunState): void { this.current.syncState?.(s); }
  consumeEvents(s: RunState): void { this.current.consumeEvents(s); }
  draw(s: RunState, alpha: number, frameDt: number, wallTime: number, view: Parameters<GameRenderer['draw']>[4]): void {
    this.current.draw(s, alpha, frameDt, wallTime, view);
  }
  drawTitle(time: number, terrain?: Terrain): void { this.current.drawTitle(time, terrain); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.safeDispose(this.current);
  }

  private async performSwitch(backend: RendererBackend, state?: RunState, titleTerrain?: Terrain, view?: ViewState): Promise<RendererSelection> {
    if (this.disposed) throw new Error('Renderer host is disposed.');
    if (backend === this.currentBackend) return { canvas: this.currentCanvas, renderer: this.current, backend };
    const oldCanvas = this.currentCanvas;
    const oldRenderer = this.current;
    const oldBackend = this.currentBackend;
    let attemptCanvas = freshCanvas(oldCanvas);
    let result: RendererSelection | undefined;
    let error: unknown;

    try {
      result = await this.createPrepared(attemptCanvas, backend, state, titleTerrain, view);
    } catch (failure) {
      error = failure;
      if (backend === '3d' && !this.disposed) {
        attemptCanvas = freshCanvas(attemptCanvas);
        try { result = await this.createPrepared(attemptCanvas, '2d', state, titleTerrain, view); }
        catch (fallbackFailure) { error = new AggregateError([failure, fallbackFailure], 'The requested renderer and 2D fallback both failed.'); }
      }
    }

    if (this.disposed) {
      if (result) this.safeDispose(result.renderer);
      (result?.canvas ?? attemptCanvas).replaceWith(oldCanvas);
      throw new Error('Renderer host was disposed during a backend switch.');
    }
    if (!result) {
      attemptCanvas.replaceWith(oldCanvas);
      this.currentCanvas = oldCanvas;
      this.current = oldRenderer;
      this.currentBackend = oldBackend;
      return { canvas: oldCanvas, renderer: oldRenderer, backend: oldBackend, error };
    }

    this.currentCanvas = result.canvas;
    this.current = result.renderer;
    this.currentBackend = result.backend;
    try { this.onCanvasChange?.(this.currentCanvas); } catch { /* A consumer callback must not strand the new renderer. */ }
    this.safeDispose(oldRenderer);
    return { ...result, error };
  }

  private async createPrepared(canvas: HTMLCanvasElement, backend: RendererBackend, state?: RunState, titleTerrain?: Terrain, view?: ViewState): Promise<RendererSelection> {
    let renderer: GameRenderer | undefined;
    try {
      renderer = backend === '3d' ? await this.factories.three(canvas) : this.factories.canvas2d(canvas);
      renderer.reduceMotion = this.current.reduceMotion;
      if ('onGraphicsInterrupted' in renderer) renderer.onGraphicsInterrupted = this.interrupted;
      renderer.configureCamera?.(this.cameraDirection, this.cameraTilt);
      renderer.resize();
      renderer.setInsets(this.insets.top, this.insets.bottom, this.insets.left, this.insets.right);
      if (state) {
        if (renderer.syncState) renderer.syncState(state);
        else renderer.draw(state, 0, 0, 0, view ?? defaultView());
      }
      else if (titleTerrain) renderer.drawTitle(0, titleTerrain);
      return { canvas, renderer, backend };
    } catch (error) {
      if (renderer) this.safeDispose(renderer);
      throw error;
    }
  }

  private applyConfiguration(renderer: GameRenderer): void {
    renderer.reduceMotion = this.current.reduceMotion;
    renderer.configureCamera?.(this.cameraDirection, this.cameraTilt);
    renderer.setInsets(this.insets.top, this.insets.bottom, this.insets.left, this.insets.right);
    if ('onGraphicsInterrupted' in renderer) renderer.onGraphicsInterrupted = this.interrupted;
  }

  private validIndex(index: number | undefined, fallback: number): number {
    return Number.isInteger(index) && index! >= 0 && index! < 4 ? index! : fallback;
  }

  private safeDispose(renderer: GameRenderer): void {
    try { renderer.dispose?.(); } catch { /* Keep a failed renderer teardown from breaking the host. */ }
  }
}
