import './style.css';
import { Synth } from './audio/synth';
import { STEP } from './data/balance';
import { BASE_WEAPONS, CharacterId, PASSIVE_IDS } from './data/content';
import { Controls } from './input/input';
import { Renderer } from './render/renderer';
import { loadSave, recordRun, writeSave } from './save/save';
import { botChoose, botInput } from './sim/bot';
import { createRun, Input, RunState } from './sim/state';
import { computeWax, stepRun } from './sim/step';
import { chooseUpgrade, recalcPassives, rerollChoices } from './sim/upgrades';
import { Screens } from './ui/screens';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const store = storage();
const save = loadSave(store);
const renderer = new Renderer(canvas);
const synth = new Synth();
const controls = new Controls(canvas);
synth.muted = save.muted;
renderer.reduceMotion = save.reduceMotion;

const params = new URLSearchParams(window.location.search);
const debugMode = params.has('debug');
renderer.debug = debugMode;

type Mode = 'menu' | 'run' | 'paused' | 'levelup' | 'ending';
let mode: Mode = 'menu';
let run: RunState | null = null;
let acc = 0;
let last = performance.now();
let timeScale = Number(params.get('speed')) || 1;
let useBot = params.has('bot');
const botIn: Input = { mx: 0, my: 0, dim: false };

function persist(): void {
  writeSave(store, save);
  synth.setMuted(save.muted);
  renderer.reduceMotion = save.reduceMotion;
}

const screens = new Screens(save, {
  start(character: CharacterId, newMoon: boolean) {
    startRun(character, newMoon);
  },
  resume() {
    setMode('run');
  },
  quit() {
    finishRun();
  },
  choose(i: number) {
    pick(i);
  },
  reroll() {
    if (run) { rerollChoices(run); if (run.choices) screens.levelUp(run.choices, run.rerolls); }
  },
  saveChanged: persist,
  click() {
    synth.unlock();
    synth.click();
  },
});

function setMode(m: Mode): void {
  mode = m;
  pauseBtn.hidden = m !== 'run';
  if (m === 'run') screens.hide();
  controls.clear();
  last = performance.now();
}

function startRun(character: CharacterId, newMoon: boolean): void {
  const view = renderer.viewHalf();
  const seedParam = Number(params.get('seed'));
  const seed = seedParam || (Date.now() ^ (performance.now() * 1000)) >>> 0;
  run = createRun({
    seed, character, newMoon, shop: { ...save.shop }, viewHalfW: view.w, viewHalfH: view.h,
    startAt: debugMode ? Number(params.get('start') ?? 0) * 60 : 0,
  });
  if (debugMode && params.has('kit')) {
    run.weapons = BASE_WEAPONS.map((id) => ({ id, rank: 5, cd: 0.3 }));
    run.passives = PASSIVE_IDS.slice(0, 6).map((id) => ({ id, rank: id === 'wick' ? 2 : 5 }));
    recalcPassives(run);
    run.player.hp = run.player.maxHp;
  }
  renderer.resetFx(seed);
  acc = 0;
  setMode('run');
}

function finishRun(): void {
  if (!run) return;
  const dawn = run.outcome === 'dawn';
  const wax = computeWax({ t: run.t, kills: run.kills, dawn, chandler: run.cfg.character === 'chandler', newMoon: run.cfg.newMoon });
  recordRun(save, { t: run.t, dawn, wax });
  persist();
  synth.stopRun();
  setMode('menu');
  screens.summary({ outcome: dawn ? 'dawn' : 'death', t: run.t, kills: run.kills, level: run.player.level, wax });
}

function pick(i: number): void {
  if (!run || !run.choices) return;
  chooseUpgrade(run, i);
  setMode('run');
}

controls.onKey = (key: string): void => {
  synth.unlock();
  const k = key.toLowerCase();
  if (mode === 'levelup') {
    if (k === '1' || k === '2' || k === '3') { synth.click(); pick(Number(k) - 1); }
    if (k === 'r' && run) { rerollChoices(run); if (run.choices) screens.levelUp(run.choices, run.rerolls); }
    return;
  }
  if (k === 'escape' || k === 'p') {
    if (mode === 'run') { setMode('paused'); screens.pause(); }
    else if (mode === 'paused') setMode('run');
    return;
  }
  if (!debugMode && k !== 'f3') return;
  if (k === 'f3' || k === '`') renderer.debug = !renderer.debug;
  if (!debugMode) return;
  if (k === ']') timeScale = Math.min(32, timeScale * 2);
  if (k === '[') timeScale = Math.max(0.125, timeScale / 2);
  if (k === 'n' && run) run.t += 60;
  if (k === 'b') useBot = !useBot;
};

canvas.addEventListener('pointerdown', () => synth.unlock());
pauseBtn.addEventListener('click', () => {
  if (mode === 'run') { synth.unlock(); setMode('paused'); screens.pause(); }
});
window.addEventListener('resize', () => {
  renderer.resize();
  if (run) {
    const v = renderer.viewHalf();
    run.cfg.viewHalfW = v.w;
    run.cfg.viewHalfH = v.h;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'run') { setMode('paused'); screens.pause(); }
});

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) renderer.fps += (1 / dt - renderer.fps) * 0.05;
  const wall = now / 1000;
  if (!run || (mode === 'menu')) {
    renderer.drawTitle(wall);
    return;
  }
  renderer.joystick = controls.joystick;
  if (mode === 'run') {
    const steps = dt * timeScale;
    acc += steps;
    const input = useBot ? botInput(run, botIn) : controls.poll();
    let guard = 0;
    while (acc >= STEP && guard++ < 600) {
      if (useBot && run.choices) chooseUpgrade(run, botChoose(run, run.choices));
      if (useBot) botInput(run, botIn);
      stepRun(run, input);
      acc -= STEP;
      if (run.over || run.choices) break;
    }
    if (acc > 0.5) acc = 0;
    renderer.consumeEvents(run);
    synth.update(run, dt);
    run.eventCount = 0;
    if (run.choices && !useBot) {
      setMode('levelup');
      screens.levelUp(run.choices, run.rerolls);
    } else if (run.over) {
      renderer.draw(run, 1, dt, wall);
      finishRun();
      return;
    }
  }
  renderer.draw(run, mode === 'run' ? acc / STEP : 1, mode === 'run' ? dt : 0, wall);
}

if (debugMode) (window as unknown as { __gw: unknown }).__gw = { get run() { return run; }, save };
pauseBtn.hidden = true;
screens.title();
requestAnimationFrame(frame);
