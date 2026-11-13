import './style.css';
import { Synth } from './audio/synth';
import { DEBUG, STEP } from './data/balance';
import { Controls } from './input/input';
import { fixLoadout, levelOf, loadProfile, recordRun, writeProfile } from './meta/profile';
import { Renderer } from './render/renderer';
import { debugSkipTo } from './sim/actions';
import { Bot } from './sim/bot';
import { generateMap } from './sim/mapgen';
import { createRun, RunState } from './sim/state';
import { clearEvents, runXp, stepRun } from './sim/step';
import { MapId, MAP_BALANCE } from './data/balance';
import { Hud } from './ui/hud';
import { Panel } from './ui/panel';
import { Ring } from './ui/ring';
import { loadUi, SLOW_FACTOR } from './ui/settings';
import { Screens } from './ui/screens';
import { Session } from './ui/session';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const store = storage();
const profile = loadProfile(store);
const renderer = new Renderer(canvas);
const synth = new Synth();
const session = new Session();
const ui = loadUi();
const params = new URLSearchParams(window.location.search);
const debugMode = params.has('debug');
const speeds = debugMode ? DEBUG.speeds : [1, 2, 3];

synth.muted = profile.muted;
renderer.reduceMotion = profile.reduceMotion;

type Mode = 'menu' | 'run' | 'ended';
let mode: Mode = 'menu';
let run: RunState | null = null;
let bot: Bot | null = null;
let acc = 0;
let last = performance.now();
let endAt = 0;
let fpsAvg = 60;
let fpsShown = 0;
const titleTerrain = generateMap('meadow', Math.floor(Math.random() * 90000) + 10000);

function persist(): void {
  writeProfile(store, profile);
  synth.setMuted(profile.muted);
  renderer.reduceMotion = profile.reduceMotion;
}

// -- layout: tell the renderer how much of the screen the HUD covers ------------------------------

const hudRoot = document.getElementById('hud') as HTMLElement;
const panelEl = document.getElementById('panel') as HTMLElement;

function layout(): void {
  renderer.resize();
  if (mode !== 'run') { renderer.setInsets(0, 0, 0, 0); return; }
  const H = window.innerHeight;
  const W = window.innerWidth;
  const top = hud.top.getBoundingClientRect().bottom;
  const bottom = H - hud.bar.getBoundingClientRect().top;
  let right = 0;
  if (panel.visible) {
    const r = panelEl.getBoundingClientRect();
    if (W >= 820) right = W - r.left;
  }
  const rs = document.documentElement.style;
  rs.setProperty('--top-h', `${Math.round(top)}px`);
  rs.setProperty('--bar-h', `${Math.round(H - hud.bar.getBoundingClientRect().top)}px`);
  renderer.setInsets(Math.max(0, top), Math.max(0, bottom), 0, right);
}

const hud = new Hud(hudRoot, session, {
  togglePause: () => togglePause(),
  cycleSpeed: () => stepSpeed(1),
  fitMap: () => renderer.fitBoard(),
});
const ring = new Ring(hud.ringEl, hud.descEl, session, renderer);
const panel = new Panel(panelEl, session, () => layout());
hudRoot.hidden = true;
panelEl.hidden = true;
new ResizeObserver(() => layout()).observe(hud.top);
new ResizeObserver(() => layout()).observe(hud.bar);
window.addEventListener('resize', layout);
window.addEventListener('popstate', () => session.handlePop());

session.onToast = (m, bad) => hud.toast(m, bad);

// -- screens ----------------------------------------------------------------------------------

const screens = new Screens(profile, renderer, ui, {
  start: (map, seed) => startRun(map, seed),
  resume: () => setPaused(false),
  restart: () => { if (run) startRun(run.cfg.map, run.cfg.mapSeed); },
  giveUp: () => finish(true),
  saved: persist,
  click: () => undefined,
  onTitle: () => { mode = 'menu'; endAt = 0; hud.hide(); panelEl.hidden = true; session.end(); layout(); },
});

// -- run lifecycle ----------------------------------------------------------------------------

function startRun(map: MapId, mapSeed: number): void {
  fixLoadout(profile);
  persist();
  const seed = debugMode && Number(params.get('seed')) ? Number(params.get('seed')) : Date.now() >>> 0;
  run = createRun({ seed, map, mapSeed, heroes: [...profile.heroes], perks: [...profile.perks] });
  const w = Number(params.get('wave'));
  if (debugMode && w > 0) debugSkipTo(run, w);
  bot = debugMode && params.has('bot') ? new Bot(run) : null;
  screens.mapSeed = mapSeed;
  renderer.resetFx();
  controls.reset();
  acc = 0;
  endAt = 0;
  mode = 'run';
  session.begin(run);
  screens.hide();
  hud.show(run);
  layout();
}

function finish(gaveUp: boolean): void {
  const s = run;
  if (!s || mode !== 'run') return;
  const won = s.outcome === 'won';
  const xp = runXp(s);
  const lv = recordRun(profile, { map: s.cfg.map, cleared: s.cleared, won, xp });
  persist();
  mode = 'ended';
  endAt = 0;
  synth.stopRun();
  hud.hide();
  panelEl.hidden = true;
  session.end();
  layout();
  screens.end({ won, gaveUp, cleared: s.cleared, kills: s.kills, xp, before: lv.before, after: lv.after, map: s.cfg.map });
}

function setPaused(p: boolean): void {
  if (mode !== 'run' || session.paused === p) return;
  session.paused = p;
  last = performance.now();
  if (p) { session.closeOverlays(); synth.stopRun(); screens.pause(); } else screens.hide();
}

const togglePause = (): void => { if (endAt === 0) setPaused(!session.paused); };

function stepSpeed(dir: number): void {
  const i = speeds.indexOf(session.speed);
  session.speed = speeds[(Math.max(0, i) + dir + speeds.length) % speeds.length];
  session.view.speed = session.speed;
}

// -- input ------------------------------------------------------------------------------------

const controls = new Controls(canvas, session, renderer, {
  active: () => mode === 'run' && !session.paused && endAt === 0,
  inRun: () => mode === 'run' && endAt === 0,
  togglePause,
  toggleDebug: () => { if (debugMode) session.view.debug = !session.view.debug; },
  stepSpeed: (d) => { if (debugMode) stepSpeed(d); },
  anyKey: () => synth.unlock(),
});

document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  synth.unlock();
  synth.click();
  // Keep Space for "call wave": a focused button would otherwise swallow it.
  if (mode === 'run') b.blur();
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// -- main loop --------------------------------------------------------------------------------

function toastEvents(s: RunState): void {
  for (let i = 0; i < s.eventCount; i++) {
    const e = s.events[i];
    if (e.type === 'destroyed') session.onToast(e.a ? 'Your hero was struck down' : 'A tower was destroyed', true);
    else if (e.type === 'heroLevel') session.onToast(`Hero reached level ${e.a}`);
    else if (e.type === 'waveClear') session.onToast(`Wave ${e.a} cleared +${e.b} gold`);
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
  if (now - fpsShown > 500) { fpsShown = now; session.view.fps = Math.round(fpsAvg); }
  const t = now / 1000;
  const s = run;
  if (mode === 'run' && s) {
    const paused = session.paused;
    if (!paused && endAt === 0) {
      acc += dt * session.speed * (session.menuOpen ? SLOW_FACTOR[ui.slow] : 1);
      let n = 0;
      while (acc >= STEP && n < 60) {
        bot?.update(STEP);
        stepRun(s);
        acc -= STEP;
        n++;
        if (s.outcome) break;
      }
      if (n >= 60) acc = 0;
      if (s.outcome) endAt = now + (bot ? 400 : 1800);
    }
    session.refreshView();
    renderer.consumeEvents(s);
    if (!paused) synth.update(s, dt);
    toastEvents(s);
    hud.update(s);
    panel.update(s, now);
    const pr = panelEl.getBoundingClientRect();
    ring.update(s, {
      left: 8, right: panel.visible && window.innerWidth >= 820 ? pr.left - 8 : window.innerWidth - 8,
      top: hud.top.getBoundingClientRect().bottom + 6, bottom: hud.bar.getBoundingClientRect().top - 6,
    });
    if (session.sheetFocus && panel.visible && session.tile) {
      session.sheetFocus = false;
      renderer.focusTile(session.tile.col, session.tile.row, panelEl.getBoundingClientRect().height);
    }
    renderer.draw(s, Math.min(1, acc / STEP), paused ? 0 : dt, t, session.view);
    clearEvents(s);
    if (endAt && now >= endAt) finish(false);
  } else if (mode === 'ended' && s) {
    renderer.draw(s, 0, 0, t, session.view);
    clearEvents(s);
  } else {
    renderer.drawTitle(t, titleTerrain);
  }
}

// -- boot -------------------------------------------------------------------------------------

if (debugMode) {
  (window as unknown as { __gk: unknown }).__gk = { session, profile, renderer, get run() { return run; }, startRun, screens };
}
if (debugMode && Number(params.get('speed'))) session.speed = Number(params.get('speed'));
layout();
const wantMap = params.get('map');
if (debugMode && (params.has('bot') || params.has('autostart'))) {
  const map = wantMap && wantMap in MAP_BALANCE && levelOf(profile.xp) >= 0 ? (wantMap as MapId) : profile.map;
  startRun(map, Number(params.get('mapseed')) || screens.mapSeed);
} else {
  if (debugMode && wantMap && wantMap in MAP_BALANCE) profile.map = wantMap as MapId;
  if (debugMode && params.has('mapseed')) screens.mapSeed = Number(params.get('mapseed'));
  screens.title();
}
requestAnimationFrame(frame);
