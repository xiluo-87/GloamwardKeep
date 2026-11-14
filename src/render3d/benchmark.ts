import { defaultView } from '../render/view';
import type { MapId } from '../data/balance';
import { createStressFixture, moveStressFixture, STRESS_CAPS, type StressCounts } from './stress-fixture';
import { Renderer3D } from './renderer';

interface FrameSample { intervalMs: number; drawMs: number }
interface CycleResult {
  cycle: number;
  counts: StressCounts;
  enemyKind: string;
  renderingSkipped: boolean;
  prepareMs: number;
  firstDrawMs: number;
  warmupSeconds: number;
  sampleSeconds: number;
  frames: number;
  rafIntervalMs: { mean: number; p50: number; p95: number; p99: number };
  cpuDrawMs: { mean: number; p50: number; p95: number; p99: number };
  diagnostics: ReturnType<Renderer3D['getDiagnostics']>;
  assetStatus: string;
  userAgent: string;
  hardwareConcurrency: number | null;
  webglRenderer: string;
}

interface BenchmarkResult { generatedAt: string; map: MapId; seed: number; direction: number; tilt: number; cycles: CycleResult[] }

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing benchmark control: ${id}`);
  return element as T;
};
const number = (id: string): number => Number(byId<HTMLInputElement>(id).value);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
const stats = (values: number[]) => ({
  mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
  p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99),
});
const waitFrame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
const status = byId<HTMLDivElement>('status');
let cancelled = false;
let result: BenchmarkResult | null = null;

function parseUrl(): void {
  const params = new URLSearchParams(location.search);
  const values: Record<string, string> = {
    map: params.get('map') ?? '', seed: params.get('seed') ?? '', direction: params.get('direction') ?? '',
    tilt: params.get('tilt') ?? '', duration: params.get('duration') ?? '', warmup: params.get('warmup') ?? '',
  };
  for (const [id, value] of Object.entries(values)) if (value !== '') byId<HTMLInputElement | HTMLSelectElement>(id).value = value;
  for (const id of ['enemies', 'projectiles', 'pets', 'pools', 'towers']) {
    const value = params.get(id);
    if (value !== null) byId<HTMLInputElement>(id).value = value;
  }
  if (params.get('goblins') === '1') byId<HTMLInputElement>('goblins').checked = true;
  if (params.has('cycles')) byId<HTMLInputElement>('cycles').value = params.get('cycles')!;
}

function readCounts(): StressCounts {
  return {
    enemies: clamp(number('enemies'), 0, STRESS_CAPS.enemies),
    projectiles: clamp(number('projectiles'), 0, STRESS_CAPS.projectiles),
    pets: clamp(number('pets'), 0, STRESS_CAPS.pets),
    pools: clamp(number('pools'), 0, STRESS_CAPS.pools),
    towers: clamp(number('towers'), 0, STRESS_CAPS.towers),
  };
}

async function waitForAssets(canvas: HTMLCanvasElement): Promise<string> {
  for (;;) {
    const state = canvas.dataset.model ?? 'loading';
    if (state !== 'loading') return state;
    if (cancelled) throw new Error('Cancelled during asset warmup.');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}

function webglRenderer(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable or masked';
}

async function runCycle(cycle: number, settings: { map: MapId; seed: number; direction: number; tilt: number; warmup: number; duration: number; counts: StressCounts; goblins: boolean }): Promise<CycleResult> {
  const renderingSkipped = new URLSearchParams(location.search).get('rafOnly') === '1';
  const canvas = byId<HTMLCanvasElement>('benchmark-canvas');
  const prepareStart = performance.now();
  const renderer = new Renderer3D(canvas);
  renderer.configureCamera(settings.direction, settings.tilt);
  const fixture = createStressFixture({ map: settings.map, seed: settings.seed, counts: settings.counts, enemyKind: settings.goblins ? 'goblin' : 'mixed' });
  renderer.syncState(fixture.run);
  let assetState: string;
  try { assetState = await waitForAssets(canvas); }
  catch (error) { renderer.dispose(); throw error; }

  const prepareMs = performance.now() - prepareStart;
  const view = defaultView();
  const firstDrawStart = performance.now();
  renderer.draw(fixture.run, 1, 1 / 60, 0, view);
  const firstDrawMs = performance.now() - firstDrawStart;
  const runPhase = async (seconds: number, collect: boolean, samples: FrameSample[]): Promise<void> => {
    const start = performance.now();
    let previous = 0;
    while (performance.now() - start < seconds * 1000 && !cancelled) {
      const stamp = await waitFrame();
      if (cancelled) break;
      const elapsed = (stamp - start) / 1000;
      moveStressFixture(fixture, elapsed);
      const drawStart = performance.now();
      if (!renderingSkipped) renderer.draw(fixture.run, 1, 1 / 60, elapsed, view);
      const drawMs = performance.now() - drawStart;
      if (collect && previous > 0) samples.push({ intervalMs: stamp - previous, drawMs });
      previous = stamp;
      if (collect && samples.length % 120 === 0) status.textContent = `Cycle ${cycle}: ${samples.length} sampled frames…`;
    }
  };
  await runPhase(settings.warmup, false, []);
  const samples: FrameSample[] = [];
  const start = performance.now();
  await runPhase(settings.duration, true, samples);
  const actualSeconds = (performance.now() - start) / 1000;
  const diagnostics = renderer.getDiagnostics();
  const hardware = navigator.hardwareConcurrency;
  const webgl = webglRenderer(canvas);
  renderer.dispose();
  const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(replacement);
  return {
    cycle, renderingSkipped, prepareMs, firstDrawMs, counts: settings.counts, enemyKind: settings.goblins ? 'goblin' : 'mixed', warmupSeconds: settings.warmup,
    sampleSeconds: actualSeconds, frames: samples.length, rafIntervalMs: stats(samples.map(sample => sample.intervalMs)),
    cpuDrawMs: stats(samples.map(sample => sample.drawMs)), diagnostics, userAgent: navigator.userAgent,
    hardwareConcurrency: Number.isFinite(hardware) ? hardware : null, webglRenderer: webgl, assetStatus: assetState,
  };
}

async function run(): Promise<void> {
  cancelled = false; result = null;
  byId<HTMLButtonElement>('run').disabled = true;
  byId<HTMLButtonElement>('cancel').disabled = false;
  byId<HTMLButtonElement>('download-json').disabled = true;
  byId<HTMLButtonElement>('download-csv').disabled = true;
  const map = byId<HTMLSelectElement>('map').value as MapId;
  const settings = {
    map, seed: Math.floor(number('seed')), direction: clamp(number('direction'), 0, 3), tilt: clamp(number('tilt'), 0, 3),
    warmup: clamp(number('warmup'), 0, 30), duration: Math.max(10, clamp(number('duration'), 10, 180)),
    counts: readCounts(), goblins: byId<HTMLInputElement>('goblins').checked,
  };
  const params = new URLSearchParams(location.search);
  if (params.has('duration')) settings.duration = Math.max(0.1, Math.min(180, Number(params.get('duration')) || 10));
  const cycles = clamp(number('cycles'), 1, 5);
  const results: CycleResult[] = [];
  try {
    for (let cycle = 1; cycle <= cycles && !cancelled; cycle++) {
      status.textContent = `Cycle ${cycle}/${cycles}: preparing scene and waiting for model assets…`;
      results.push(await runCycle(cycle, settings));
    }
    if (cancelled) status.textContent = 'Sample cancelled.';
    else {
      result = { generatedAt: new Date().toISOString(), map, seed: settings.seed, direction: settings.direction, tilt: settings.tilt, cycles: results };
      byId<HTMLPreElement>('output').textContent = JSON.stringify(result, null, 2);
      byId<HTMLButtonElement>('download-json').disabled = false;
      byId<HTMLButtonElement>('download-csv').disabled = false;
      status.textContent = `Complete: ${results.length} cycle(s). No frame-rate pass/fail threshold is applied.`;
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    byId<HTMLButtonElement>('run').disabled = false;
    byId<HTMLButtonElement>('cancel').disabled = true;
  }
}

function download(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

parseUrl();
byId<HTMLButtonElement>('run').addEventListener('click', () => { void run(); });
byId<HTMLButtonElement>('cancel').addEventListener('click', () => { cancelled = true; });
byId<HTMLButtonElement>('download-json').addEventListener('click', () => {
  if (result) download('gloamward-render-benchmark.json', JSON.stringify(result, null, 2), 'application/json');
});
byId<HTMLButtonElement>('download-csv').addEventListener('click', () => {
  if (!result) return;
  const header = 'cycle,frames,sampleSeconds,intervalMeanMs,intervalP50Ms,intervalP95Ms,intervalP99Ms,drawMeanMs,drawP50Ms,drawP95Ms,drawP99Ms,calls,triangles,geometries,textures,programs,width,height,pixelRatio,model,assetStatus,webglRenderer';
  const rows = result.cycles.map(c => [c.cycle, c.frames, c.sampleSeconds, c.rafIntervalMs.mean, c.rafIntervalMs.p50, c.rafIntervalMs.p95, c.rafIntervalMs.p99,
    c.cpuDrawMs.mean, c.cpuDrawMs.p50, c.cpuDrawMs.p95, c.cpuDrawMs.p99, c.diagnostics.calls, c.diagnostics.triangles, c.diagnostics.geometries,
    c.diagnostics.textures, c.diagnostics.programs, c.diagnostics.width, c.diagnostics.height, c.diagnostics.pixelRatio, c.diagnostics.model, c.assetStatus,
    `"${c.webglRenderer.replaceAll('"', '""')}"`].join(','));
  download('gloamward-render-benchmark.csv', [header, ...rows].join('\n'), 'text/csv');
});
