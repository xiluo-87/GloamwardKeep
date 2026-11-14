import {
  Box3, Color, DirectionalLight, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap,
  Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createArtCharacter, type ArtCharacter } from '../camera-preview/art-character';
import { DIRECTIONS, fitCamera, TILTS } from '../camera-preview/camera';
import { createStudyLighting } from '../camera-preview/lighting';
import { disposeTerrain } from '../camera-preview/terrain';
import { ENEMIES, type MapId } from '../data/balance';
import { defaultView } from '../render/view';
import type { BakedModel } from '../render3d/baked-model';
import { RuntimeModelRegistry } from '../render3d/model-registry';
import { ARCHER_TOWER_STATES, PROOF_CHARACTER_CATALOG, type ProofCharacterId } from '../render3d/proof-catalog';
import { Renderer3D } from '../render3d/renderer';
import { createStressFixture, moveStressFixture, type StressFixture } from '../render3d/stress-fixture';
import { buildTowerVisual, type TowerVisual } from '../render3d/towers';
import { ROOMIER_SCENE } from '../render3d/scene-proportions';

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const cards = get('cards');
const status = get('status');
const registry = new RuntimeModelRegistry();
const canvas = get<HTMLCanvasElement>('proof-canvas');
const mapCanvas = get<HTMLCanvasElement>('map-canvas');
const renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
const originalMaterials = new Map<MeshStandardMaterial, { color: Color; emissive: Color; emissiveIntensity: number; vertexColors: boolean }>();
type Mode = 'characters' | 'towers' | 'map' | 'replacements';
interface Card {
  mode: Mode; element: HTMLElement; port: HTMLElement; scene: Scene; camera: OrthographicCamera;
  bounds: Box3; character?: ArtCharacter; batch?: BakedModel; height?: number;
  tower?: TowerVisual; clips?: Map<string, number>;
}
const views: Card[] = [];
let mode: Mode = 'characters';
let live: Renderer3D | undefined;
let fixture: StressFixture | undefined;
let time = 0;
let previous = performance.now();
let disposed = false;
let raf = 0;
const origin = new Vector3();
const scale = new Vector3();
const clipInput = get<HTMLSelectElement>('clip');
const direction = get<HTMLSelectElement>('direction');
const tilt = get<HTMLSelectElement>('tilt');
const pause = get<HTMLInputElement>('pause');
const silhouette = get<HTMLInputElement>('silhouette');

function createCard(cardMode: Mode, title: string, subtitle: string, height: number, tag: string): Card {
  const element = document.createElement('article');
  const heading = document.createElement('h2'); heading.textContent = title;
  const description = document.createElement('p'); description.textContent = subtitle;
  const port = document.createElement('div'); port.className = 'port';
  const provenance = document.createElement('div'); provenance.className = 'tag'; provenance.textContent = tag;
  element.append(heading, description, port, provenance); cards.append(element);
  const scene = new Scene(); scene.background = new Color('#22312e');
  const lighting = createStudyLighting();
  lighting.sun.position.set(-10, 22, 10); lighting.sun.castShadow = true;
  lighting.sun.shadow.mapSize.set(1024, 1024); lighting.sun.shadow.normalBias = .015;
  lighting.sun.shadow.camera.left = lighting.sun.shadow.camera.bottom = -4;
  lighting.sun.shadow.camera.right = lighting.sun.shadow.camera.top = 4;
  scene.add(lighting.sky, lighting.ambient, lighting.sun, lighting.sun.target);
  const card: Card = { mode: cardMode, element, port, scene, camera: new OrthographicCamera(),
    bounds: new Box3(new Vector3(-height*.55, -.06, -height*.55), new Vector3(height*.55, height*1.05, height*.55)) };
  views.push(card); return card;
}

function reframe(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  for (const view of views) {
    const rect = view.port.getBoundingClientRect();
    fitCamera(view.camera, view.bounds, Math.max(1, rect.width)/Math.max(1, rect.height),
      DIRECTIONS[Number(direction.value)].azimuth, TILTS[Number(tilt.value)]);
  }
  live?.resize();
  live?.configureCamera(Number(direction.value), Number(tilt.value));
  live?.setInsets(get('map-controls').getBoundingClientRect().bottom + 12, 60, 12, 12);
  if (document.body.dataset.proof === 'ready') status.textContent = `Ready · ${DIRECTIONS[Number(direction.value)].short} / ${TILTS[Number(tilt.value)].toFixed(1)}° · crisp neutral daylight`;
}

function colorMode(): void {
  for (const view of views) view.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(mat instanceof MeshStandardMaterial)) continue;
      if (!originalMaterials.has(mat)) originalMaterials.set(mat, { color: mat.color.clone(), emissive: mat.emissive.clone(), emissiveIntensity: mat.emissiveIntensity, vertexColors: mat.vertexColors });
      const original = originalMaterials.get(mat)!;
      mat.color.copy(silhouette.checked ? new Color('#000000') : original.color);
      mat.emissive.copy(silhouette.checked ? new Color('#ded8c8') : original.emissive);
      mat.emissiveIntensity = silhouette.checked ? 1 : original.emissiveIntensity;
      mat.vertexColors = silhouette.checked ? false : original.vertexColors; mat.needsUpdate = true;
    }
  });
}

async function characters(): Promise<void> {
  const names = { goblin: 'Goblin', orc: 'Orc', troll: 'Hill Troll', 'archer-crew': 'Hood Archer' };
  for (const id of Object.keys(PROOF_CHARACTER_CATALOG) as ProofCharacterId[]) {
    const definition = registry.definition(id);
    for (const revision of ['source', 'adapted'] as const) {
      const character = await registry.createNativeCharacter(id, revision);
      const template = await registry.loadCharacter(id, revision);
      let triangles = 0;
      template.scene.traverse(object => {
        if (object instanceof Mesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count)/3;
      });
      const view = createCard('characters', `${names[id]} · ${revision === 'source' ? 'original pack' : 'reduced & refined'}`,
        revision === 'source' ? 'Original geometry, colors and native rig' : 'Chunkier source mesh, simpler surfaces; original rig', definition.presentationHeight,
        `${triangles.toLocaleString()} triangles · ${template.animations.length} native clips · review height ${definition.presentationHeight}`);
      view.character = character; view.scene.add(character.root);
      view.clips = new Map(template.animations.map(c => [c.name, c.duration]));
    }
    const batch = await registry.createCrowdBatch(id, 1);
    const view = createCard('characters', `${names[id]} · crowd rendering`, 'Same adapted model through the live animation bake', definition.presentationHeight,
      `${batch.stats.triangles} triangles · ${Math.round(batch.stats.poseBytes/1024)} KB pose data`);
    view.batch = batch; view.height = definition.presentationHeight; view.scene.add(batch.root);
  }
}

async function towers(): Promise<void> {
  const library = await registry.loadStaticLibrary();
  const crew = await registry.loadCharacter('archer-crew');
  const names = ['Timber lookout', 'Stone-footed watchstand', 'Masonry watchtower', 'Longbow perch', 'Eagle-eye gantry', 'Twin volley stand', 'Arrow-storm battery'];
  const descriptions = ['Exposed X braces · one firing deck', 'Stone plinth · cantilever braces · access ladder', 'Masonry shaft · stepped buttresses · stone corners', 'Narrow tall trestles · open single marksman perch', 'Offset pier · cantilever deck · split-level access', 'Two firing bays · shared Y-braced trestle', 'Three staggered platforms · rear raised marksman'];
  ARCHER_TOWER_STATES.forEach((id, i) => {
    const fork = i >= 5 ? 'b' : i >= 3 ? 'a' : 0;
    const tower = buildTowerVisual({ type: 'archer', tier: Math.min(i+1, 3), fork,
      forkTier: fork ? (i >= 5 ? i-4 : i-2) : 0, heroLevel: 1, skills: [] }, false, library, crew);
    const view = createCard('towers', `${['I', 'II', 'III', 'A · I', 'A · II', 'B · I', 'B · II'][i]} — ${names[i]}`,
      descriptions[i], 3.05, `${id} · ${tower.crew.length} actual pack archer${tower.crew.length === 1 ? '' : 's'}`);
    view.bounds = new Box3(new Vector3(-1, -.04, -1), new Vector3(1, 3.1, 1));
    view.tower = tower; view.scene.add(tower.root);
  });
}

async function replacements(): Promise<void> {
  const choices = [
    { name: 'Barrel Knight', role: 'Wagon → armored carrier', file: new URL('../../blocky-pack/dcc/tiny-characters-blocky-barrel-knight.glb', import.meta.url).href,
      note: 'Actual wooden armored character. Keeps a heavy ground role; no wheels or wagon claim.' },
    { name: 'Pit Demon', role: 'Bat → flying demon', file: new URL('../../blocky-pack/dcc/tiny-characters-blocky-pit-demon.glb', import.meta.url).href,
      note: 'Actual demon silhouette. Later needs a flight pose; native clips contain no flight loop.' },
    { name: 'Ghost', role: 'Hawk → bound spirit', file: new URL('../../blocky-pack/dcc/tiny-characters-blocky-ghost.glb', import.meta.url).href,
      note: 'Actual draped spirit model. Later needs a float animation and its own familiar effects.' },
  ];
  for (const choice of choices) {
    const template = await new GLTFLoader().loadAsync(choice.file);
    if (disposed) { disposeTerrain(template.scene, true); return; }
    const character = createArtCharacter(template, 'Idle');
    // These untouched originals are presented for choosing replacements, not claimed as finished adaptations.
    const view = createCard('replacements', choice.name, choice.role, 1.02, choice.note);
    view.character = character; view.scene.add(character.root);
    view.clips = new Map(template.animations.map(c => [c.name, c.duration]));
    disposeTerrain(template.scene, true);
  }
}

function rebuildMap(): void {
  const map = get<HTMLSelectElement>('map').value as MapId;
  const seed = Number(get<HTMLInputElement>('seed').value) >>> 0;
  const count = Number(get<HTMLSelectElement>('density').value);
  fixture = createStressFixture({ map, seed, counts: { towers: count, enemies: count === 7 ? 12 : 90,
    projectiles: 0, pools: 0, pets: 0 }, enemyKind: 'goblin', archersOnly: true });
  const kinds = ['goblin', 'orc', 'troll'] as const;
  for (let i = 0; i < fixture.run.enemies.count; i++) fixture.run.enemies.items[i].def = ENEMIES[kinds[i % 3]];
  for (const tower of fixture.run.towers) tower.fired = 999;
  live?.syncState(fixture.run); live?.fitBoard();
  get('map-stats').textContent = `${map} seed ${seed} · ${fixture.run.towers.length} legally placed archers · ${fixture.run.enemies.count} moving mobs`;
}

async function setMode(next: Mode): Promise<void> {
  mode = next;
  if (mode === 'map' && silhouette.checked) { silhouette.checked = false; colorMode(); }
  clipInput.disabled = mode === 'map' || mode === 'replacements';
  // Characters can walk; a tower crew stays on its platform.
  const walk = Array.from(clipInput.options).find(option => option.value === 'Walk')!;
  walk.disabled = mode === 'towers';
  if (mode === 'towers' && clipInput.value === 'Walk') clipInput.value = 'Idle';
  silhouette.disabled = mode === 'map';
  get<HTMLInputElement>('large').disabled = mode === 'map';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  cards.hidden = canvas.hidden = mode === 'map';
  mapCanvas.hidden = get('map-controls').hidden = get('map-note').hidden = mode !== 'map';
  cards.classList.toggle('towers', mode === 'towers');
  for (const view of views) view.element.hidden = view.mode !== mode;
  if (mode === 'map' && !live) {
    live = new Renderer3D(mapCanvas, registry, ROOMIER_SCENE);
    await live.assetsReady;
    if (mapCanvas.dataset.model !== 'ready') throw new Error('Live proof assets failed to load.');
    rebuildMap();
  }
  reframe();
}

function animate(now: number): void {
  if (disposed) return;
  const dt = Math.min(.05, (now-previous)/1000); previous = now;
  if (!pause.checked) time += dt;
  if (mode === 'map' && live && fixture && mapCanvas.dataset.model === 'ready') {
    moveStressFixture(fixture, time);
    for (const tower of fixture.run.towers) tower.angle = Math.sin(time*.22+tower.uid*.2)*.35;
    live.draw(fixture.run, 1, dt, time, defaultView());
  } else {
    renderer.setScissorTest(false); renderer.setClearColor('#1c2a2b'); renderer.clear(); renderer.setScissorTest(true);
    for (const view of views) {
      if (view.mode !== mode) continue;
      const rect = view.port.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const clip = view.mode === 'replacements' ? 'Idle' : clipInput.value;
      if (view.character) {
        view.character.setClip(clip);
        const duration = view.clips?.get(clip) ?? 1;
        view.character.update(time % duration, origin, 0);
      }
      if (view.batch) {
        view.batch.beginFrame(); scale.setScalar((view.height ?? 1.02)/1.02);
        view.batch.append(origin, 0, scale, time % view.batch.clipDuration(clip), clip); view.batch.endFrame();
      }
      if (view.tower) for (const character of view.tower.crew) {
        const crewClip = clip === 'Attack1' ? 'Attack1' : 'Idle';
        character.setClip(crewClip); character.update(time, origin, .1);
      }
      renderer.setViewport(rect.left, innerHeight-rect.bottom, rect.width, rect.height);
      renderer.setScissor(rect.left, innerHeight-rect.bottom, rect.width, rect.height);
      renderer.render(view.scene, view.camera);
    }
  }
  raf = requestAnimationFrame(animate);
}

const fail = (error: unknown): void => {
  get('failure').hidden = false; get('failure').textContent = String(error); status.textContent = 'Proof load failed — see error';
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => { void setMode(button.dataset.view as Mode).catch(fail); };
get('large').onchange = () => { cards.classList.toggle('focus', get<HTMLInputElement>('large').checked); reframe(); };
direction.onchange = tilt.onchange = reframe;
silhouette.onchange = colorMode;
get('rebuild').onclick = () => { rebuildMap(); reframe(); };
get('fit').onclick = () => live?.fitBoard();
get('restart').onclick = () => { time = 0; };
mapCanvas.addEventListener('wheel', event => { event.preventDefault(); live?.zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY*.001)); }, { passive: false });
get<HTMLImageElement>('reference-image').src = new URL('../../assets-src/rework/reference.png', import.meta.url).href;
get('reference').onclick = () => get<HTMLDialogElement>('reference-dialog').showModal();
get('close-reference').onclick = () => get<HTMLDialogElement>('reference-dialog').close();
window.addEventListener('resize', reframe);
window.addEventListener('pagehide', () => {
  disposed = true; cancelAnimationFrame(raf); live?.dispose();
  for (const view of views) {
    view.character?.stop(); view.batch?.dispose(); view.tower?.crew.forEach(c => c.stop());
    view.scene.traverse(object => { if (object instanceof DirectionalLight) object.shadow.dispose(); });
    disposeTerrain(view.scene);
  }
  registry.dispose(); renderer.dispose();
});
async function initialize(): Promise<void> {
  await characters(); await towers(); await replacements();
  if (disposed) return;
  const requested = new URLSearchParams(location.search).get('view');
  await setMode(['characters','towers','map','replacements'].includes(requested ?? '') ? requested as Mode : 'characters');
  status.textContent = 'Ready · SE / 35.3° · crisp neutral daylight';
  document.body.dataset.proof = 'ready';
  raf = requestAnimationFrame(animate);
}
void initialize().catch(error => { if (!disposed) fail(error); });
