import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { paintArcherBowman } from '../camera-preview/archer-tower';
import { writeOccluderMask } from '../camera-preview/environment';
import { disposeTerrain, tilePosition } from '../camera-preview/terrain';
import { Painter } from '../camera-preview/voxel-model';
import { paintHeroModel, paintTowerModel } from '../camera-preview/tower-models';
import { HEROES, type HeroId, type TowerId } from '../data/balance';
import type { Terrain } from '../sim/mapgen';
import type { Tower } from '../sim/state';
import { ContentAssetLibrary } from './asset-library';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createArtCharacter, type ArtCharacter } from '../camera-preview/art-character';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

export interface TowerVisual { root: Group; bowman: Group | null; bounds: Box3; signature: string; crew: ArtCharacter[] }
const origin = new Vector3();

function prefabId(t: Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier' | 'heroLevel' | 'skills'>): string {
  if (t.type in HEROES) {
    const branch = t.skills.reduce((best, code) => Math.max(best, Math.floor(code / 4)), -1);
    return branch >= 0 ? `hero/${t.type}/skill-branch-${branch}`
      : `hero/${t.type}/${t.heroLevel >= 4 ? 'level-4' : 'base'}`;
  }
  return t.fork ? `tower/${t.type}/fork-${t.fork}-${t.forkTier}` : `tower/${t.type}/tier-${t.tier}`;
}

function prepareTowerRoot(root: Group, ghost: boolean, crewTemplate?: GLTF): TowerVisual {
  let bowman: Group | null = null;
  const aim = root.children.find(child => child.name === 'aim-bowman');
  if (aim) {
    root.remove(aim);
    bowman = new Group();
    bowman.name = 'aim-bowman';
    aim.name = 'aim-bowman-mesh';
    bowman.add(aim);
    root.add(bowman);
  }
  const crew: ArtCharacter[] = [];
  if (crewTemplate) for (const socket of root.children.filter(child => /^crew-\d+$/.test(child.name))) {
    const character = createArtCharacter(crewTemplate, 'Idle');
    character.setHidden(0, false);
    socket.add(character.root);
    crew.push(character);
  }
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object.name === 'Hidden imported mob silhouette') return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      writeOccluderMask(material as MeshStandardMaterial, !ghost);
      material.stencilWrite = !ghost;
      material.transparent = ghost;
      material.opacity = ghost ? 0.4 : 1;
      material.depthWrite = !ghost;
    }
    object.castShadow = !ghost;
    object.receiveShadow = !ghost;
  });
  root.updateMatrixWorld(true);
  return { root, bowman, bounds: new Box3().setFromObject(root), signature: '', crew };
}

/** Procedural working art for live tower and hero progression states. */
export function buildTowerVisual(t: Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier' | 'heroLevel' | 'skills'>, ghost = false, library?: ContentAssetLibrary | null, crewTemplate?: GLTF): TowerVisual {
  const prefab = library?.instantiate(prefabId(t), ghost);
  if (prefab) return prepareTowerRoot(prefab, ghost, crewTemplate);

  const root = new Group();
  const add = (p: Painter, parent = root): void => {
    const mesh = p.mesh();
    const material = mesh.material as MeshStandardMaterial;
    writeOccluderMask(material, !ghost);
    material.stencilWrite = !ghost;
    material.transparent = ghost;
    material.opacity = ghost ? 0.4 : 1;
    material.depthWrite = !ghost;
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    parent.add(mesh);
  };
  let bowman: Group | null = null;
  const p = new Painter();
  if (t.type === 'archer') {
    paintTowerModel(p, t as Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier'>, origin);
    add(p);
    bowman = new Group();
    const figure = new Painter();
    paintArcherBowman(figure, origin);
    add(figure, bowman);
    root.add(bowman);
  } else if (t.type in HEROES) {
    paintHeroModel(p, t as Pick<Tower, 'type' | 'heroLevel' | 'skills'>, origin);
    add(p);
  } else {
    paintTowerModel(p, t as Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier'>, origin);
    add(p);
  }
  root.updateMatrixWorld(true);
  return { root, bowman, bounds: new Box3().setFromObject(root), signature: '', crew: [] };
}

export class LiveTowers {
  readonly visuals = new Map<number, TowerVisual>();
  /** Incremented whenever opaque static tower geometry changes; the renderer can refresh its shadow map. */
  shadowRevision = 0;
  private library: ContentAssetLibrary | null = null;
  private libraryRevision = 0;
  private crewTemplate?: GLTF;
  constructor(private parent: Group, private proportions: SceneProportions = BASE_SCENE) {}

  setCrewTemplate(template: GLTF): void { this.crewTemplate = template; this.libraryRevision++; }

  setLibrary(library: ContentAssetLibrary | null): void {
    if (this.library === library) return;
    this.library = library;
    this.libraryRevision++;
    this.shadowRevision++;
  }

  update(towers: readonly Tower[], terrain: Terrain, time = 0, demonstrateAttack = false): void {
    for (const [uid, visual] of this.visuals) if (!towers.some(t => t.uid === uid)) {
      this.parent.remove(visual.root);
      visual.crew.forEach(character => character.stop());
      disposeTerrain(visual.root);
      this.visuals.delete(uid);
      this.shadowRevision++;
    }
    for (const tower of towers) {
      const signature = `${tower.type}/${tower.tier}/${tower.fork}/${tower.forkTier}/${tower.heroLevel}/${tower.skills.join('.')}/library-${this.libraryRevision}`;
      let visual = this.visuals.get(tower.uid);
      if (!visual || visual.signature !== signature) {
        if (visual) { this.parent.remove(visual.root); visual.crew.forEach(character => character.stop()); disposeTerrain(visual.root); }
        visual = buildTowerVisual(tower, false, this.library, this.crewTemplate);
        visual.root.scale.multiplyScalar(this.proportions.buildings / this.proportions.tile);
        visual.signature = signature;
        visual.root.position.copy(tilePosition(terrain, tower.ty * terrain.cols + tower.tx));
        visual.root.position.y /= this.proportions.tile;
        visual.root.userData.tile = { col: tower.tx, row: tower.ty };
        this.parent.add(visual.root);
        this.visuals.set(tower.uid, visual);
        this.shadowRevision++;
      }
      if (visual.bowman) visual.bowman.rotation.y = Math.PI / 2 - tower.angle;
      for (const character of visual.crew) {
        const attacking = demonstrateAttack || tower.fired < .8;
        character.setClip(attacking ? 'Attack1' : 'Idle');
        character.update(attacking && !demonstrateAttack ? tower.fired * 2.5 : time, origin, Math.PI / 2 - tower.angle);
      }
      visual.root.updateMatrixWorld(true);
      visual.bounds.setFromObject(visual.root);
    }
  }

  reset(): void {
    if (this.visuals.size) this.shadowRevision++;
    for (const visual of this.visuals.values()) { this.parent.remove(visual.root); visual.crew.forEach(character => character.stop()); disposeTerrain(visual.root); }
    this.visuals.clear();
  }

  static ghost(type: TowerId | HeroId, library?: ContentAssetLibrary | null, proportions = BASE_SCENE): TowerVisual {
    const visual = buildTowerVisual({ type, tier: 1, fork: 0, forkTier: 0, heroLevel: 1, skills: [] }, true, library);
    visual.root.scale.multiplyScalar(proportions.buildings / proportions.tile);
    visual.root.updateMatrixWorld(true);
    visual.bounds.setFromObject(visual.root);
    return visual;
  }
}
