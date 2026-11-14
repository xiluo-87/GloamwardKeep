import './style.css';
import { Box3, Color, OrthographicCamera, PCFShadowMap, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { type MapId, MAP_BALANCE } from '../data/balance';
import { DIRECTIONS, fitCamera, TILTS, tiltLabel, zoomCameraAt } from './camera';
import { disposeTerrain, tilePosition } from './terrain';
import { createArtFixture, createDensityFixture, type ArtFixture, type DensityFixture } from './fixture';
import { buildVoxelStudy } from './voxel-study';
import { createArtCharacter } from './art-character';
import type { TerrainLook } from './terrain-look';
import { createStudyLighting, LIGHTING_LABEL } from './lighting';

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = get<HTMLCanvasElement>('scene');
const stage = get('stage');
const grid = get('views');
const error = get('error');
const mapInput = get<HTMLSelectElement>('map');
const seedInput = get<HTMLInputElement>('seed');
const densityInput = get<HTMLSelectElement>('density');
const studyInput = get<HTMLSelectElement>('study');
const terrainLookInput = get<HTMLSelectElement>('terrain-look');
const motionInput = get<HTMLInputElement>('motion');
const visibilityInput = get<HTMLInputElement>('visibility-aid');
const lifecycle = new AbortController();
const params = new URLSearchParams(location.search);
let terrainLook: TerrainLook = params.get('terrain') === 'blockout' ? 'blockout' : 'artwork';
if (params.has('lighting') || params.get('compare') === 'lighting') {
  const url = new URL(location.href);
  url.searchParams.delete('lighting');
  if (url.searchParams.get('compare') === 'lighting') url.searchParams.delete('compare');
  history.replaceState(null, '', url);
}
let artMode = params.get('study') === 'art';
let inspectPair = artMode;
let characterTemplate: GLTF | null = null;
let characterLoading = false;
let characterFailed = false;
const requestedMap = params.get('map');
let map: MapId = requestedMap && Object.hasOwn(MAP_BALANCE, requestedMap) ? requestedMap as MapId : 'highlands';
const requestedSeed = Number(params.get('seed') ?? 5);
let seed = Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xffffffff ? requestedSeed : 5;
let mode: 'directions' | 'tilts' = params.get('compare') === 'tilts' ? 'tilts' : 'directions';
let tiltIndex = 1;
let directionIndex = 0;
let focused: number | null = params.get('focus') === 'all' ? null : 0;
const requestedDensity = Number(params.get('towers') ?? 40);
let density = [0, 12, 40, 80].includes(requestedDensity) ? requestedDensity : 40;

interface Spec { direction: number; tilt: number; candidate: number }
interface View {
  spec: Spec;
  port: HTMLElement;
  camera: OrthographicCamera;
  zoomLabel: HTMLElement;
  labels: HTMLElement[];
  width: number;
  height: number;
}
let views: View[] = [];
let viewEvents = new AbortController();
let fixture: ArtFixture | DensityFixture = artMode ? createArtFixture(map, seed) : createDensityFixture(map, seed, density);
let terrain = fixture.run.terrain;
let blockout = makeBlockout();
let selected: number | null = null;
let frame: number | null = null;
let disposed = false;
let visualTime = 0;
let previousFrame = 0;

let renderer: WebGLRenderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor('#111a1c');
} catch {
  error.hidden = false;
  error.textContent = 'This camera study needs WebGL2. Try a browser with hardware graphics enabled. The 2D game is available on the main page.';
  grid.hidden = true;
  throw new Error('Camera preview could not create a WebGL2 renderer.');
}
const scene = new Scene();
scene.background = new Color('#1c2a2b');
const studyLighting = createStudyLighting();
const { sun } = studyLighting;
scene.add(studyLighting.sky, studyLighting.ambient);
sun.position.set(-10, 22, 10);
scene.add(sun, sun.target, blockout.root);
renderer.shadowMap.type = PCFShadowMap;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.025;
sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
sun.shadow.camera.right = sun.shadow.camera.top = 8;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
configureLighting();

function makeBlockout() {
  return buildVoxelStudy(fixture, 0.35, 'sampleTowerUid' in fixture ? {
    character: characterTemplate ? createArtCharacter(characterTemplate) : null,
    towerUid: fixture.sampleTowerUid,
    route: fixture.sampleRoute,
  } : undefined, terrainLook);
}

function configureLighting(): void {
  renderer.shadowMap.enabled = artMode;
  sun.castShadow = artMode;
  const tower = fixture.run.towers.find((t) => 'sampleTowerUid' in fixture && t.uid === fixture.sampleTowerUid);
  sun.target.position.copy(tower ? tilePosition(terrain, tower.ty * terrain.cols + tower.tx) : new Vector3());
  sun.position.copy(sun.target.position).add(new Vector3(-10, 22, 10));
  sun.target.updateMatrixWorld();
}

function frameBounds(): Box3 {
  if (!artMode || !inspectPair || !('sampleTowerUid' in fixture)) return blockout.bounds;
  const uid = fixture.sampleTowerUid;
  const tower = fixture.run.towers.find((t) => t.uid === uid)!;
  const p = tilePosition(terrain, tower.ty * terrain.cols + tower.tx);
  const bounds = new Box3().setFromCenterAndSize(p.clone().add(new Vector3(0, 1.4, 0)), new Vector3(2.8, 3.4, 2.8));
  for (const index of fixture.sampleRoute) {
    const road = tilePosition(terrain, index);
    bounds.expandByPoint(road.clone().add(new Vector3(-0.7, 0, -0.7)));
    bounds.expandByPoint(road.clone().add(new Vector3(0.7, 1.2, 0.7)));
  }
  return bounds;
}

async function loadCharacter(): Promise<void> {
  if (characterTemplate || characterLoading || disposed) return;
  characterLoading = true;
  characterFailed = false;
  renderViews();
  try {
    const template = await new GLTFLoader().loadAsync(new URL('../../assets-src/models/goblin/goblin.glb', import.meta.url).href);
    if (disposed) { disposeTerrain(template.scene); return; }
    characterTemplate = template;
    if (artMode) rebuildStudy();
  } catch {
    characterFailed = true;
  } finally {
    characterLoading = false;
    if (!disposed && artMode) renderViews();
  }
}

function schedule(): void {
  if (!disposed && frame === null) frame = requestAnimationFrame(draw);
}

function fit(view: View): void {
  const rect = view.port.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  fitCamera(view.camera, frameBounds(), rect.width / rect.height, DIRECTIONS[view.spec.direction].azimuth, TILTS[view.spec.tilt]);
  view.width = rect.width;
  view.height = rect.height;
  view.zoomLabel.textContent = '100%';
}

function draw(now: number): void {
  frame = null;
  if (disposed || renderer.getContext().isContextLost()) return;
  const frameDt = previousFrame ? Math.min(0.1, (now - previousFrame) / 1000) : 1 / 60;
  if (motionInput.checked) visualTime += frameDt;
  previousFrame = now;
  blockout.update(visualTime);
  const bounds = stage.getBoundingClientRect();
  if (canvas.clientWidth !== Math.round(bounds.width) || canvas.clientHeight !== Math.round(bounds.height)) return;
  const size = renderer.getSize(new Vector2());
  if (size.x !== Math.round(bounds.width) || size.y !== Math.round(bounds.height)) renderer.setSize(Math.round(bounds.width), Math.round(bounds.height), false);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  let visibilitySettling = false;
  for (const view of views) {
    const rect = view.port.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.width !== view.width || rect.height !== view.height) fit(view);
    const x = Math.round(rect.left - bounds.left);
    const y = Math.round(bounds.bottom - rect.bottom);
    renderer.setViewport(x, y, Math.round(rect.width), Math.round(rect.height));
    renderer.setScissor(x, y, Math.round(rect.width), Math.round(rect.height));
    const visibility = blockout.prepareView(view.camera, frameDt, now / 1000, visibilityInput.checked);
    visibilitySettling ||= visibility.settling;
    view.port.dataset.fadedProps = String(visibility.fadedProps);
    view.port.dataset.hiddenMobs = String(visibility.hiddenMobs);
    renderer.render(scene, view.camera);
    blockout.landmarks.forEach((landmark, i) => {
      const p = landmark.position.clone().project(view.camera);
      const label = view.labels[i];
      label.hidden = p.x < -0.96 || p.x > 0.96 || p.y < -0.94 || p.y > 0.94;
      label.style.left = `${(p.x + 1) * rect.width / 2}px`;
      label.style.top = `${(1 - p.y) * rect.height / 2}px`;
    });
  }
  if ((motionInput.checked && blockout.enemyCount) || visibilitySettling) schedule();
}

function screenPoint(view: View, x: number, y: number): Vector2 {
  const rect = view.port.getBoundingClientRect();
  return new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
}

function rayAt(view: View, point: Vector2): Raycaster {
  const ray = new Raycaster();
  ray.setFromCamera(point, view.camera);
  return ray;
}

function zoom(view: View, x: number, y: number, factor: number): void {
  const point = screenPoint(view, x, y);
  const ray = rayAt(view, point);
  const anchor = ray.intersectObject(blockout.tiles, false)[0]?.point
    ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
  if (!anchor) return;
  zoomCameraAt(view.camera, point, anchor, factor);
  if (view.camera.zoom === 1) fit(view);
  view.zoomLabel.textContent = `${Math.round(view.camera.zoom * 100)}%`;
  schedule();
}

function selectTile(view: View, x: number, y: number): void {
  const hit = rayAt(view, screenPoint(view, x, y)).intersectObject(blockout.tiles, false)[0];
  selected = hit?.instanceId ?? null;
  blockout.highlight.visible = selected !== null;
  if (selected !== null) {
    blockout.highlight.position.copy(tilePosition(terrain, selected));
    get('selection').textContent = `Tile ${selected % terrain.cols}, ${Math.floor(selected / terrain.cols)} · height ${terrain.height[selected]}`;
  } else get('selection').textContent = 'Click a tile to inspect it across views';
  schedule();
}

function bindInput(view: View): void {
  const signal = viewEvents.signal;
  const port = view.port;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let previousDistance = 0;
  let pinched = false;
  port.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? port.clientHeight : 1);
    zoom(view, event.clientX, event.clientY, Math.exp(-pixels * 0.0015));
  }, { passive: false, signal });
  port.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    port.setPointerCapture(event.pointerId);
    if (pointers.size === 1) pinched = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      previousDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinched = true;
    }
  }, { signal });
  port.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX; p.y = event.clientY;
    if (pointers.size !== 2) return;
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (previousDistance > 0 && distance > 0) zoom(view, (a.x + b.x) / 2, (a.y + b.y) / 2, distance / previousDistance);
    previousDistance = distance;
  }, { signal });
  const release = (event: PointerEvent): void => {
    const p = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (event.type === 'pointerup' && p && !pinched && Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < 8) selectTile(view, event.clientX, event.clientY);
    previousDistance = 0;
  };
  port.addEventListener('pointerup', release, { signal });
  port.addEventListener('pointercancel', release, { signal });
  port.addEventListener('lostpointercapture', (event) => { pointers.delete(event.pointerId); previousDistance = 0; }, { signal });
  port.addEventListener('keydown', (event) => {
    if (!['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === '0') { fit(view); schedule(); return; }
    const rect = port.getBoundingClientRect();
    zoom(view, rect.left + rect.width / 2, rect.top + rect.height / 2, event.key === '-' ? 1 / 1.25 : 1.25);
  }, { signal });
}

function renderViews(): void {
  viewEvents.abort();
  viewEvents = new AbortController();
  const candidates: Spec[] = mode === 'directions'
    ? DIRECTIONS.map((_, direction) => ({ direction, tilt: tiltIndex, candidate: direction }))
    : TILTS.map((_, tilt) => ({ direction: directionIndex, tilt, candidate: tilt }));
  const visible = focused === null ? candidates : [candidates[focused]];
  grid.classList.toggle('focused', focused !== null);
  grid.replaceChildren();
  views = visible.map((spec) => {
    const title = `From ${DIRECTIONS[spec.direction].label.toLowerCase()} · ${tiltLabel(TILTS[spec.tilt])}`;
    const footer = `${TILTS[spec.tilt] === TILTS[1] ? 'Classic isometric tilt' : 'Tilt candidate'} · ${LIGHTING_LABEL}`;
    const card = document.createElement('article');
    card.className = 'view';
    card.innerHTML = `<header class="view-header"><span class="candidate">${String.fromCharCode(65 + spec.candidate)}</span><h2>${title}</h2><button type="button" class="enlarge">${focused === null ? 'Enlarge' : 'Compare four'}</button></header><div class="viewport" role="img" tabindex="0" aria-label="${title} map preview. Wheel or pinch to zoom. Keyboard plus/minus zooms; zero fits."></div><div class="view-footer"><span>${footer}</span><span class="zoom-level">100%</span><button type="button" class="view-fit">Fit</button></div>`;
    const port = card.querySelector<HTMLElement>('.viewport')!;
    port.dataset.lighting = 'crisp';
    const labels = blockout.landmarks.map((landmark) => {
      const label = document.createElement('span');
      label.className = `landmark ${landmark.kind}`;
      label.textContent = landmark.label;
      port.append(label);
      return label;
    });
    const view: View = { spec, port, camera: new OrthographicCamera(), labels, zoomLabel: card.querySelector('.zoom-level')!, width: 0, height: 0 };
    card.querySelector('.enlarge')!.addEventListener('click', () => { focused = focused === null ? spec.candidate : null; renderViews(); }, { signal: viewEvents.signal });
    card.querySelector('.view-fit')!.addEventListener('click', () => { fit(view); schedule(); }, { signal: viewEvents.signal });
    bindInput(view);
    grid.append(card);
    return view;
  });
  get('directions-mode').setAttribute('aria-pressed', String(mode === 'directions'));
  get('tilts-mode').setAttribute('aria-pressed', String(mode === 'tilts'));
  get('tilt-controls').hidden = mode === 'tilts';
  get('direction-controls').hidden = mode === 'directions';
  const title = focused === null
    ? mode === 'directions' ? `Four directions · ${tiltLabel(TILTS[tiltIndex])} above ground` : `Four tilts · from ${DIRECTIONS[directionIndex].label.toLowerCase()}`
    : `From ${DIRECTIONS[visible[0].direction].label.toLowerCase()} · ${tiltLabel(TILTS[visible[0].tilt])} above ground`;
  get('comparison-description').textContent = `${title} · ${map} / seed ${seed}`;
  get('density-summary').textContent = `${fixture.towerCount} ${fixture.towerCount === 1 ? 'tower' : 'towers'} · ${fixture.wallCount} walls · ${blockout.enemyCount} ${blockout.enemyCount === 1 ? 'enemy' : 'enemies'} · ${fixture.cleared} tiles cleared`;
  get('fit').textContent = artMode ? 'Fit whole map' : focused === null ? 'Fit all views' : 'Fit view';
  densityInput.disabled = artMode;
  get('inspect-pair').hidden = !artMode;
  get('inspect-pair').setAttribute('aria-pressed', String(inspectPair));
  get('art-status').hidden = !artMode;
  get('art-status').textContent = characterTemplate
    ? 'Art sample · custom timber archer tower + simplified animated goblin · full generated map, provisional scale and materials'
    : characterFailed ? 'The goblin model could not load. Retry to load the local art sample.' : 'Loading the animated goblin…';
  get('retry-model').hidden = !artMode || !characterFailed;
  schedule();
}

function rebuildStudy(resetMotion = true): void {
  scene.remove(blockout.root);
  blockout.dispose();
  blockout = makeBlockout();
  scene.add(blockout.root);
  configureLighting();
  if (resetMotion) visualTime = 0;
  previousFrame = 0;
  selected = null;
  get('selection').textContent = 'Click a tile to inspect it across views';
  renderViews();
}

function changeMap(): void {
  fixture = artMode ? createArtFixture(map, seed) : createDensityFixture(map, seed, density);
  terrain = fixture.run.terrain;
  rebuildStudy();
  const url = new URL(location.href);
  url.searchParams.set('map', map);
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('towers', String(density));
  if (artMode) url.searchParams.set('study', 'art');
  else url.searchParams.delete('study');
  history.replaceState(null, '', url);
  if (artMode) void loadCharacter();
}

function choiceButtons(host: HTMLElement, labels: string[], active: () => number, choose: (index: number) => void): void {
  labels.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(active() === index));
    button.addEventListener('click', () => {
      choose(index);
      focused = null;
      [...host.children].forEach((child, i) => child.setAttribute('aria-pressed', String(active() === i)));
      renderViews();
    }, { signal: lifecycle.signal });
    host.append(button);
  });
}

mapInput.value = map;
seedInput.value = String(seed);
densityInput.value = String(density);
studyInput.value = artMode ? 'art' : 'density';
terrainLookInput.value = terrainLook;
choiceButtons(get('tilt-buttons'), TILTS.map(tiltLabel), () => tiltIndex, (i) => { tiltIndex = i; });
choiceButtons(get('direction-buttons'), DIRECTIONS.map((d) => d.short), () => directionIndex, (i) => { directionIndex = i; });
mapInput.addEventListener('change', () => { map = mapInput.value as MapId; changeMap(); }, { signal: lifecycle.signal });
densityInput.addEventListener('change', () => { density = Number(densityInput.value); changeMap(); }, { signal: lifecycle.signal });
studyInput.addEventListener('change', () => { artMode = studyInput.value === 'art'; inspectPair = artMode; changeMap(); }, { signal: lifecycle.signal });
terrainLookInput.addEventListener('change', () => {
  terrainLook = terrainLookInput.value as TerrainLook;
  rebuildStudy(false);
  const url = new URL(location.href);
  if (terrainLook === 'blockout') url.searchParams.set('terrain', 'blockout');
  else url.searchParams.delete('terrain');
  history.replaceState(null, '', url);
}, { signal: lifecycle.signal });
motionInput.addEventListener('change', () => { previousFrame = 0; schedule(); }, { signal: lifecycle.signal });
visibilityInput.addEventListener('change', () => { previousFrame = 0; schedule(); }, { signal: lifecycle.signal });
seedInput.addEventListener('change', () => {
  const value = Number(seedInput.value);
  if (!seedInput.reportValidity() || !Number.isInteger(value) || value < 0 || value > 0xffffffff) { seedInput.value = String(seed); return; }
  if (value === seed) return;
  seed = value;
  changeMap();
}, { signal: lifecycle.signal });
seedInput.addEventListener('input', () => {
  const value = Number(seedInput.value);
  if (seedInput.value.trim() === '' || !seedInput.checkValidity() || !Number.isInteger(value) || value === seed) return;
  seed = value;
  changeMap();
}, { signal: lifecycle.signal });
get('new-map').addEventListener('click', () => { seed = crypto.getRandomValues(new Uint32Array(1))[0]; seedInput.value = String(seed); changeMap(); }, { signal: lifecycle.signal });
for (const nextMode of ['directions', 'tilts'] as const) get(`${nextMode}-mode`).addEventListener('click', () => {
  mode = nextMode;
  focused = null;
  renderViews();
  const url = new URL(location.href);
  if (mode === 'directions') url.searchParams.delete('compare');
  else url.searchParams.set('compare', mode);
  url.searchParams.set('focus', 'all');
  history.replaceState(null, '', url);
}, { signal: lifecycle.signal });
get('inspect-pair').addEventListener('click', () => { inspectPair = true; renderViews(); }, { signal: lifecycle.signal });
get('retry-model').addEventListener('click', () => { void loadCharacter(); }, { signal: lifecycle.signal });
get('fit').addEventListener('click', () => { if (artMode) inspectPair = false; views.forEach(fit); renderViews(); }, { signal: lifecycle.signal });
canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); error.hidden = false; error.textContent = 'Graphics interrupted. Waiting for the browser to restore this preview.'; }, { signal: lifecycle.signal });
canvas.addEventListener('webglcontextrestored', () => { error.hidden = true; schedule(); }, { signal: lifecycle.signal });
const resize = new ResizeObserver(schedule);
resize.observe(stage);
renderViews();
if (artMode) void loadCharacter();

function dispose(): void {
  disposed = true;
  lifecycle.abort();
  viewEvents.abort();
  resize.disconnect();
  if (frame !== null) cancelAnimationFrame(frame);
  blockout.dispose();
  if (characterTemplate) disposeTerrain(characterTemplate.scene);
  sun.shadow.dispose();
  renderer.dispose();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: lifecycle.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
