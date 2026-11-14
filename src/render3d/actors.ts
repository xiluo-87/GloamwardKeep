import {
  BoxGeometry, CircleGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, Quaternion, Vector3,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RUN, WORLD } from '../data/balance';
import type { RunState } from '../sim/state';
import { groundHeightAt } from '../camera-preview/surface';
import { disposeTerrain } from '../camera-preview/terrain';
import { BakedModel } from './baked-model';
import { enemyGroundingOffset, enemyHeight, EnemyPresentation } from './model-scale';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

export interface MobVisual {
  root: Group;
  uid: number;
  samples: [Vector3, Vector3];
  treeSamples: [Vector3, Vector3, Vector3, Vector3];
  hiddenOpacity: number;
  setHidden(opacity: number): void;
}
interface OwnedMob extends MobVisual { kind: string; facingYaw: number; batch: BakedModel | null; slot: number; lastSeen: number }
const PALETTE: Record<string, string> = {
  goblin: '#789258', hexer: '#7375a6', orc: '#9c674c', stalker: '#5b777a', bat: '#80648e',
  troll: '#756b54', wagon: '#b18b4b', shaman: '#759785', ogreking: '#9d574b', lich: '#b2a66b',
};
function fallback(kind: string): GLTF {
  const scene = new Group();
  const material = new MeshStandardMaterial({ color: PALETTE[kind] ?? '#8b8065' });
  for (const [x, y, w, h] of [[0, 0.42, 0.4, 0.45], [0, 0.8, 0.32, 0.3], [-0.14, 0.1, 0.12, 0.2], [0.14, 0.1, 0.12, 0.2]]) {
    const part = new Mesh(new BoxGeometry(w, h, 0.3), material);
    part.position.set(x, y, 0); scene.add(part);
  }
  return { scene, animations: [] } as unknown as GLTF;
}

/** One animated instance batch per species; UID metadata never owns GPU resources. */
export class LiveActors {
  readonly mobs: MobVisual[] = [];
  private readonly byUid = new Map<number, OwnedMob>();
  private readonly free: OwnedMob[] = [];
  private readonly batches = new Map<string, BakedModel>();
  private readonly loaded = new Set<string>();
  private state: RunState | null = null;
  private disposed = false;
  private frame = 0;
  private readonly scale = new Vector3();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly matrix = new Matrix4();
  private readonly back: InstancedMesh;
  private readonly hp: InstancedMesh;
  private readonly shields: InstancedMesh;
  private readonly shadows: InstancedMesh;

  constructor(private readonly parent: Group, private readonly proportions: SceneProportions = BASE_SCENE,
    private readonly presentation = new EnemyPresentation()) {
    const bar = (name: string, color: string): InstancedMesh => {
      const mesh = new InstancedMesh(new BoxGeometry(1, 1, 0.025), new MeshBasicMaterial({ color, depthTest: true, depthWrite: false, toneMapped: false }), RUN.enemyCap);
      mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 10;
      parent.add(mesh); return mesh;
    };
    this.back = bar('Mob health bar backgrounds', '#342c28');
    this.hp = bar('Mob health fills', '#80b85f');
    this.shields = bar('Mob shield fills', '#73c8d6');
    this.shadows = new InstancedMesh(new CircleGeometry(0.24, 12), new MeshBasicMaterial({ color: '#18221a', transparent: true, opacity: 0.17, depthWrite: false }), RUN.enemyCap);
    this.shadows.name = 'Mob ground shadows'; this.shadows.count = 0; this.shadows.frustumCulled = false;
    parent.add(this.shadows);
  }

  setTemplate(template: GLTF, kind = 'goblin'): void {
    if (this.disposed) return;
    const batch = new BakedModel(template);
    this.presentation.setLocomotionFloor(kind, batch.locomotionFloor);
    this.batches.get(kind)?.dispose();
    this.batches.set(kind, batch); this.loaded.add(kind); this.parent.add(batch.root);
  }

  getStats(): { species: number; vertices: number; poseBytes: number } {
    let vertices = 0, poseBytes = 0;
    for (const batch of this.batches.values()) { vertices += batch.stats.vertices; poseBytes += batch.stats.poseBytes; }
    return { species: this.loaded.size, vertices, poseBytes };
  }

  update(s: RunState, alpha: number, camera: OrthographicCamera): void {
    if (this.disposed) return;
    if (this.state !== s) { this.reset(); this.state = s; }
    this.frame++;
    // Retire before acquiring so metadata stays bounded even when every pool slot changes UID.
    for (let i = 0; i < s.enemies.count; i++) {
      const enemy = s.enemies.items[i];
      if (!enemy.dead) { const mob = this.byUid.get(enemy.uid); if (mob) mob.lastSeen = this.frame; }
    }
    for (const [uid, mob] of this.byUid) if (mob.lastSeen !== this.frame) {
      this.byUid.delete(uid); mob.root.visible = false; this.free.push(mob);
    }
    for (const batch of this.batches.values()) batch.beginFrame();
    this.mobs.length = 0;
    let shieldCount = 0;
    for (let i = 0; i < s.enemies.count; i++) {
      const enemy = s.enemies.items[i];
      if (enemy.dead) continue;
      let mob = this.byUid.get(enemy.uid);
      if (!mob) {
        mob = this.free.pop() ?? this.createVisual();
        mob.uid = enemy.uid; mob.kind = enemy.def.id; mob.hiddenOpacity = 0; mob.facingYaw = 0;
        this.byUid.set(enemy.uid, mob);
      }
      mob.kind = enemy.def.id;
      let batch = this.batches.get(mob.kind);
      if (!batch) {
        const source = fallback(mob.kind); batch = new BakedModel(source);
        this.presentation.setLocomotionFloor(mob.kind, batch.locomotionFloor);
        disposeTerrain(source.scene); this.batches.set(mob.kind, batch); this.parent.add(batch.root); batch.beginFrame();
      }
      mob.batch = batch;
      const x = (enemy.px + (enemy.x - enemy.px) * alpha + enemy.ox) / WORLD.hex;
      const z = (enemy.py + (enemy.y - enemy.py) * alpha + enemy.oy) / WORLD.hex;
      const ground = groundHeightAt(s.terrain, x, z) / this.proportions.tile;
      const height = enemyHeight(mob.kind, mob.uid, this.proportions);
      const contactCorrection = enemyGroundingOffset(mob.kind, mob.uid, this.proportions, this.presentation);
      const y = ground + (enemy.def.flying ? 0.8 / this.proportions.tile : 0) + contactCorrection;
      mob.root.position.set(x, y, z); mob.root.visible = true;
      if (enemy.vx !== 0 || enemy.vy !== 0) mob.facingYaw = Math.atan2(enemy.vx, enemy.vy);
      mob.root.rotation.y = mob.facingYaw;
      // Stable, restrained proportions; no simulation random numbers are consumed.
      this.scale.setScalar(height / 1.02);
      const moving = Math.abs(enemy.vx) + Math.abs(enemy.vy) > 0.01;
      const clip = enemy.stunT > 0 ? 'Idle' : enemy.smashing ? 'Attack1' : moving ? 'Walk' : 'Idle';
      const phase = (mob.uid % 113) * 0.071;
      mob.slot = batch.append(mob.root.position, mob.facingYaw, this.scale, enemy.smashing ? s.t % batch.clipDuration('Attack1') : s.t, clip, enemy.smashing ? 0 : phase);
      mob.samples[0].set(x, y + height * 0.48, z); mob.samples[1].set(x, y + height * 0.88, z);
      mob.treeSamples[0].copy(mob.samples[0]); mob.treeSamples[1].copy(mob.samples[1]);
      const lookX = (enemy.x + enemy.vx * 0.35 + enemy.ox) / WORLD.hex;
      const lookZ = (enemy.y + enemy.vy * 0.35 + enemy.oy) / WORLD.hex;
      const lookY = groundHeightAt(s.terrain, lookX, lookZ) / this.proportions.tile
        + (enemy.def.flying ? 0.8 / this.proportions.tile : 0) + contactCorrection;
      mob.treeSamples[2].set(lookX, lookY + height * 0.48, lookZ); mob.treeSamples[3].set(lookX, lookY + height * 0.88, lookZ);
      const slot = this.mobs.length;
      const hp = enemy.maxHp > 0 ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : 0;
      this.position.set(x, y + height + 0.16, z);
      this.scale.set(0.66, 0.075, 1); this.matrix.compose(this.position, camera.quaternion, this.scale); this.back.setMatrixAt(slot, this.matrix);
      this.position.addScaledVector(this.scale.set(1, 0, 0).applyQuaternion(camera.quaternion), -0.3 * (1 - hp));
      this.scale.set(0.6 * hp, 0.045, 1); this.matrix.compose(this.position, camera.quaternion, this.scale); this.hp.setMatrixAt(slot, this.matrix);
      if (enemy.shield > 0) {
        const shield = Math.min(1, enemy.shield / Math.max(1, enemy.maxHp));
        this.position.set(x, y + height + 0.095, z).addScaledVector(this.scale.set(1, 0, 0).applyQuaternion(camera.quaternion), -0.3 * (1 - shield));
        this.scale.set(0.6 * shield, 0.035, 1); this.matrix.compose(this.position, camera.quaternion, this.scale); this.shields.setMatrixAt(shieldCount++, this.matrix);
      }
      this.position.set(x, ground + 0.023, z); this.quaternion.setFromAxisAngle(this.scale.set(1, 0, 0), -Math.PI / 2);
      this.scale.set(height, height * 0.75, 1); this.matrix.compose(this.position, this.quaternion, this.scale); this.shadows.setMatrixAt(slot, this.matrix);
      this.mobs.push(mob);
    }
    this.back.count = this.hp.count = this.shadows.count = this.mobs.length; this.shields.count = shieldCount;
    for (const mesh of [this.back, this.hp, this.shields, this.shadows]) mesh.instanceMatrix.needsUpdate = true;
    for (const batch of this.batches.values()) batch.endFrame();
  }

  private createVisual(): OwnedMob {
    const mob: OwnedMob = {
      root: new Group(), uid: 0, kind: '', facingYaw: 0, batch: null, slot: -1, lastSeen: 0,
      samples: [new Vector3(), new Vector3()], treeSamples: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
      hiddenOpacity: 0, setHidden: opacity => { mob.hiddenOpacity = opacity; mob.batch?.setHidden(mob.slot, opacity); },
    };
    return mob;
  }
  reset(): void {
    for (const mob of this.byUid.values()) { mob.root.visible = false; this.free.push(mob); }
    this.byUid.clear(); this.mobs.length = 0; this.state = null;
    for (const batch of this.batches.values()) { batch.beginFrame(); batch.endFrame(); }
    this.back.count = this.hp.count = this.shields.count = this.shadows.count = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.reset(); this.disposed = true; this.free.length = 0;
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    for (const mesh of [this.back, this.hp, this.shields, this.shadows]) {
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose();
    }
  }
}
