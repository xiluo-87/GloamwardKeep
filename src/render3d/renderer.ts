import { Color, Group, MeshStandardMaterial, PCFShadowMap, Ray, Raycaster, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { buildVoxelEnvironment, type VoxelEnvironment } from '../camera-preview/environment';
import { createStudyLighting } from '../camera-preview/lighting';
import { disposeTerrain } from '../camera-preview/terrain';
import { blocksView, fadeToward } from '../camera-preview/visibility';
import type { GameRenderer, ViewState } from '../render/view';
import type { Terrain } from '../sim/mapgen';
import type { RunState } from '../sim/state';
import { LiveActors } from './actors';
import { ENEMY_MODELS, LIBRARY_MODEL } from './model-catalog';
import { ContentAssetLibrary } from './asset-library';
import { GameCamera3D, type CameraInsets } from './camera';
import { LiveEffects } from './effects';
import { LiveOverlays } from './overlays';
import { LiveTowers } from './towers';
import { pickWorldTile } from './picking';
import { RuntimeModelRegistry } from './model-registry';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';
import { EnemyPresentation } from './model-scale';

type ProofEnemyKind = 'goblin' | 'orc' | 'troll';

/** Initial live backend. It reads the real run; there is no fixture budget or scripted combat. */
export class Renderer3D implements GameRenderer {
  readonly assetsReady: Promise<void>;
  reduceMotion = false;
  onGraphicsInterrupted?: () => void;
  private graphics: WebGLRenderer;
  private scene = new Scene();
  private cameraRig: GameCamera3D;
  private lighting = createStudyLighting();
  private environment: VoxelEnvironment | null = null;
  private terrain: Terrain | null = null;
  private terrainVersion = -1;
  private run: RunState | null = null;
  private actorsRoot = new Group();
  private towersRoot = new Group();
  private actors: LiveActors;
  private towers: LiveTowers;
  private effects: LiveEffects;
  private overlays: LiveOverlays;
  private templates: GLTF[] = [];
  private library: ContentAssetLibrary | null = null;
  private keepLevel = 1;
  private shadowRevision = -1;
  private insets: CameraInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  private temporaryInset = false;
  private width = 0;
  private height = 0;
  private disposed = false;
  private lost = false;
  private events = new AbortController();
  private towardCamera = new Vector3();
  private ray = new Ray();
  private hit = new Vector3();
  private raycaster = new Raycaster();
  private hits: ReturnType<Raycaster['intersectObject']> = [];
  private propHold = new Float64Array(0);
  private clearedDecor = new Set<number>();
  private notice: HTMLDivElement;

  constructor(private canvas: HTMLCanvasElement, private proofRegistry?: RuntimeModelRegistry,
    private proportions: SceneProportions = BASE_SCENE,
    private proofSpecies: readonly ProofEnemyKind[] = ['goblin', 'orc', 'troll']) {
    const presentation = new EnemyPresentation();
    this.cameraRig = new GameCamera3D(0, 1, proportions);
    this.actors = new LiveActors(this.actorsRoot, proportions, presentation);
    this.towers = new LiveTowers(this.towersRoot, proportions);
    this.effects = new LiveEffects(proportions, presentation);
    this.overlays = new LiveOverlays(proportions);
    this.graphics = new WebGLRenderer({ canvas, antialias: true, stencil: true });
    this.graphics.shadowMap.enabled = true;
    this.graphics.shadowMap.type = PCFShadowMap;
    this.graphics.shadowMap.autoUpdate = false;
    this.scene.background = new Color('#1c2a2b');
    const { sky, ambient, sun } = this.lighting;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.025;
    this.scene.add(sky, ambient, sun, sun.target, this.actorsRoot, this.towersRoot, this.effects.root, this.overlays.root);
    this.notice = document.createElement('div');
    this.notice.className = 'graphics-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    canvas.after(this.notice);
    const signal = this.events.signal;
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true;
      this.notice.textContent = 'Graphics interrupted. Restoring the view…';
      this.notice.hidden = false;
      this.onGraphicsInterrupted?.();
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.notice.hidden = true;
      sun.shadow.needsUpdate = true;
      this.graphics.shadowMap.needsUpdate = true;
    }, { signal });
    this.resize();
    this.assetsReady = this.proofRegistry ? this.loadProof() : this.loadCharacter();
  }

  /** Review mode uses the production scene/actors/towers with only the approved proof assets. */
  private async loadProof(): Promise<void> {
    const registry = this.proofRegistry!;
    this.canvas.dataset.model = 'loading';
    try {
      const [characters, crew, library] = await Promise.all([
        Promise.all(this.proofSpecies.map(async kind => [kind, await registry.loadCharacter(kind)] as const)),
        registry.loadCharacter('archer-crew'), registry.loadStaticLibrary(),
      ]);
      if (this.disposed) return;
      for (const [kind, template] of characters) this.actors.setTemplate(template, kind);
      this.library = library;
      this.towers.setLibrary(library);
      this.towers.setCrewTemplate(crew);
      this.overlays.setLibrary(library);
      this.terrainVersion = -1;
      this.canvas.dataset.model = 'ready';
    } catch (error) {
      if (this.disposed) return;
      this.canvas.dataset.model = 'error';
      this.notice.textContent = `Art proof could not load: ${String(error)}`;
      this.notice.hidden = false;
    }
  }

  private async loadCharacter(): Promise<void> {
    this.canvas.dataset.model = 'loading';
    const results = await Promise.allSettled([...Object.entries(ENEMY_MODELS).map(async ([kind, url]) => {
      const template = await new GLTFLoader().loadAsync(url);
      if (this.disposed) { disposeTerrain(template.scene); return; }
      try { this.actors.setTemplate(template, kind); this.templates.push(template); }
      catch (error) { disposeTerrain(template.scene); throw error; }
    }), (async () => {
      const source = await new GLTFLoader().loadAsync(LIBRARY_MODEL);
      if (this.disposed) { disposeTerrain(source.scene); return; }
      this.library = new ContentAssetLibrary(source.scene);
      this.towers.setLibrary(this.library);
      this.overlays.setLibrary(this.library);
      this.terrainVersion = -1;
    })()]);
    if (this.disposed) return;
    const failures = results.filter(result => result.status === 'rejected');
    this.canvas.dataset.model = failures.length ? 'partial' : 'ready';
    if (failures.length) console.warn('Some authored models could not load; using voxel stand-ins for those species.', failures);
  }

  get rotated(): boolean { return false; }
  get zoom(): number { return this.cameraRig.zoom; }
  configureCamera(directionIndex: number, tiltIndex: number): void { this.cameraRig.configure(directionIndex, tiltIndex); }
  getDiagnostics(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; width: number; height: number; pixelRatio: number; model: string; crowdPoseBytes: number } {
    const info = this.graphics.info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries,
      textures: info.memory.textures, programs: info.programs?.length ?? 0, width: this.width, height: this.height,
      pixelRatio: this.graphics.getPixelRatio(), model: this.canvas.dataset.model ?? 'loading', crowdPoseBytes: this.actors.getStats().poseBytes };
  }
  // The existing input contract still sends drag deltas; the confirmed 3D camera does not pan.
  panBy(): void {}
  /** The art-proof viewer opts into inspection panning without changing player camera controls. */
  panForInspection(dx: number, dy: number): void { this.cameraRig.panBy(dx, dy); }
  focusTile(_col: number, _row: number, avoidBottom = 0): void {
    this.temporaryInset = avoidBottom > this.insets.bottom;
    // Until the UI redesign, reserve the existing touch sheet without adding camera panning.
    this.cameraRig.layout(this.width, this.height, { ...this.insets, bottom: Math.max(this.insets.bottom, avoidBottom) });
  }
  edgeArrowAt(): null { return null; }
  fitBoard(): void {
    this.temporaryInset = false;
    this.cameraRig.layout(this.width, this.height, this.insets);
  }
  zoomAt(x: number, y: number, factor: number): void { if (this.environment) this.cameraRig.zoomAt(x, y, factor, this.environment.tiles); }
  tileToScreen(col: number, row: number): { x: number; y: number; r: number } { return this.cameraRig.tileToScreen(col, row); }
  screenToTile(x: number, y: number): { col: number; row: number } | null {
    if (!this.environment || !this.terrain) return null;
    return pickWorldTile(this.cameraRig.camera, this.width, this.height, x, y, this.terrain,
      this.environment.tiles, this.environment.structures, [...this.towers.visuals.values()].map(tower => tower.root));
  }
  screenToWorld(x: number, y: number): { x: number; y: number } { return this.environment ? this.cameraRig.screenToWorld(x, y, this.environment.tiles) : { x: 0, y: 0 }; }

  resize(): void {
    const width = window.innerWidth, height = window.innerHeight;
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.graphics.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.graphics.setSize(width, height, false);
    this.cameraRig.layout(width, height, this.insets);
  }

  setInsets(top: number, bottom: number, left: number, right: number): void {
    if (!this.temporaryInset && this.insets.top === top && this.insets.bottom === bottom && this.insets.left === left && this.insets.right === right) return;
    this.temporaryInset = false;
    this.insets = { top, bottom, left, right };
    this.cameraRig.layout(this.width, this.height, this.insets);
  }

  resetFx(): void { this.effects.reset(); }
  consumeEvents(s: RunState): void { this.effects.reduceMotion = this.reduceMotion; this.effects.consume(s); }

  syncState(s: RunState): void {
    if (this.run !== s) {
      this.actors.reset(); this.towers.reset(); this.overlays.reset(); this.effects.reset();
      this.clearedDecor.clear();
      this.run = s;
    }
    if (this.keepLevel !== s.keep) { this.keepLevel = s.keep; this.terrainVersion = -1; }
    this.ensureEnvironment(s.terrain, s.terrainVersion);
    for (const tower of s.towers) {
      const tile = tower.ty * s.terrain.cols + tower.tx;
      if (this.clearedDecor.has(tile)) continue;
      this.clearedDecor.add(tile);
      this.environment!.decorations.removeAt(tile);
    }
  }

  private ensureEnvironment(terrain: Terrain, version: number): void {
    if (terrain === this.terrain && version === this.terrainVersion) return;
    const changedMap = terrain !== this.terrain;
    if (this.environment) { this.scene.remove(this.environment.root); disposeTerrain(this.environment.root); }
    this.environment = buildVoxelEnvironment(terrain, 'artwork', this.library, this.keepLevel, this.proportions);
    for (const tile of this.clearedDecor) this.environment.decorations.removeAt(tile);
    this.terrain = terrain; this.terrainVersion = version;
    this.scene.add(this.environment.root);
    this.propHold = new Float64Array(this.environment.features.length);
    const bounds = this.environment.bounds.clone();
    bounds.max.y += 2;
    if (changedMap) this.cameraRig.setTerrain(terrain, bounds);
    const { sun } = this.lighting;
    bounds.getCenter(sun.target.position);
    sun.position.copy(sun.target.position).add(new Vector3(-30, 66, 30));
    const span = bounds.getSize(new Vector3()).length() / 2 + 4;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
    sun.shadow.camera.right = sun.shadow.camera.top = span;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 160;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld(true);
    sun.shadow.needsUpdate = true;
    this.graphics.shadowMap.needsUpdate = true;
  }

  private visibility(dt: number, wallTime: number): void {
    const environment = this.environment!;
    this.cameraRig.camera.getWorldDirection(this.towardCamera).negate();
    for (const mob of this.actors.mobs) {
      let hidden = environment.structureBounds.some(bounds => mob.samples.some(sample => blocksView(bounds, sample, this.towardCamera, this.ray, this.hit)));
      if (!hidden) for (const tower of this.towers.visuals.values()) {
        if (mob.samples.some(sample => blocksView(tower.bounds, sample, this.towardCamera, this.ray, this.hit))) { hidden = true; break; }
      }
      mob.hiddenOpacity = fadeToward(mob.hiddenOpacity, hidden ? 1 : 0, dt || 1 / 60, hidden ? 0.15 : 0.25);
      mob.setHidden(mob.hiddenOpacity);
    }
    for (let index = 0; index < environment.features.length; index++) {
      const feature = environment.features[index];
      let blocked = false;
      for (const mob of this.actors.mobs) {
        for (const sample of feature.tree ? mob.treeSamples : mob.samples) {
          if (!blocksView(feature.bounds, sample, this.towardCamera, this.ray, this.hit)) continue;
          this.raycaster.ray.set(sample, this.towardCamera);
          this.hits.length = 0;
          this.raycaster.intersectObject(feature.mesh, false, this.hits);
          if (this.hits.length) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (blocked) this.propHold[index] = wallTime + 0.12;
      const held = wallTime < this.propHold[index];
      const material = feature.material as MeshStandardMaterial;
      material.opacity = fadeToward(material.opacity, held ? 0.22 : 1, dt || 1 / 60, held ? 0.14 : 0.28);
      material.depthWrite = material.stencilWrite = material.opacity >= 0.995;
    }
  }

  draw(s: RunState, alpha: number, frameDt: number, wallTime: number, view: ViewState): void {
    if (this.disposed || this.lost) return;
    this.syncState(s);
    this.towers.update(s.towers, s.terrain, s.t);
    if (this.shadowRevision !== this.towers.shadowRevision) {
      this.shadowRevision = this.towers.shadowRevision; this.graphics.shadowMap.needsUpdate = true;
    }
    this.actors.update(s, alpha, this.cameraRig.camera);
    this.effects.root.visible = this.overlays.root.visible = true;
    this.effects.reduceMotion = this.reduceMotion;
    this.effects.update(s, alpha, frameDt);
    this.overlays.update(s, view);
    this.scene.updateMatrixWorld(true);
    this.visibility(frameDt, wallTime);
    this.canvas.dataset.enemies = String(this.actors.mobs.length);
    this.canvas.dataset.towers = String(this.towers.visuals.size);
    this.canvas.dataset.projectiles = String(s.projectiles.count);
    this.canvas.dataset.zoom = String(this.zoom);
    this.graphics.render(this.scene, this.cameraRig.camera);
  }

  drawTitle(_time: number, terrain?: Terrain): void {
    if (this.disposed || this.lost || !terrain) return;
    if (this.run) { this.actors.reset(); this.towers.reset(); this.effects.reset(); this.run = null; }
    if (this.keepLevel !== 1) { this.keepLevel = 1; this.terrainVersion = -1; }
    this.ensureEnvironment(terrain, 0);
    this.overlays.root.visible = this.effects.root.visible = false;
    this.graphics.render(this.scene, this.cameraRig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.events.abort();
    this.actors.dispose(); this.towers.reset(); this.effects.dispose(); this.overlays.dispose();
    if (this.environment) disposeTerrain(this.environment.root);
    for (const template of this.templates) disposeTerrain(template.scene);
    this.templates.length = 0;
    if (!this.proofRegistry) this.library?.dispose();
    this.library = null;
    this.lighting.sun.shadow.dispose();
    this.notice.remove(); this.graphics.dispose();
  }
}
