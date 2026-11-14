import {
  AlwaysStencilFunc, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute,
  Group, InstancedMesh, LineBasicMaterial, LineSegments, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, ReplaceStencilOp, RingGeometry, Vector3,
} from 'three';
import { disposeTerrain } from '../camera-preview/terrain';
import { HEROES, RUN, TOWERS, WORLD } from '../data/balance';
import { tileCenter } from '../sim/hex';
import { EVENT_CAP, type RunState, type Tower } from '../sim/state';
import { groundHeightAt } from '../camera-preview/surface';
import { enemyGroundingOffset, enemyHeight, EnemyPresentation } from './model-scale';
import { currentProjectileTarget, enemyBodyCenterHeight, groundPoint, muzzleHeight, projectilePoint } from './mapping';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

interface EventFx {
  family: 'none' | 'ring' | 'disk' | 'marker' | 'line';
  left: number; life: number; x: number; y: number; z: number; radius: number;
  x2: number; y2: number; z2: number; color: Color;
}

function mask(material: MeshBasicMaterial | MeshStandardMaterial | LineBasicMaterial): void {
  material.stencilWrite = true;
  material.stencilRef = 0;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilZPass = ReplaceStencilOp;
  material.depthTest = true;
  material.depthWrite = material instanceof MeshStandardMaterial;
}

/** Bounded render-only feedback. Pool indexes are read afresh because simulation swap-removes. */
export class LiveEffects {
  readonly root = new Group();
  private bolts = new InstancedMesh(new BoxGeometry(0.045, 0.045, 0.35), new MeshStandardMaterial({ color: '#ead9a2', roughness: 0.78 }), RUN.projectileCap);
  private stones = new InstancedMesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial({ color: '#c1a58a', roughness: 1 }), RUN.projectileCap);
  private pets = new InstancedMesh(new BoxGeometry(0.35, 0.16, 0.48), new MeshStandardMaterial({ color: '#956b3f', roughness: 0.85 }), RUN.petCap);
  private leftWings = new InstancedMesh(new BoxGeometry(0.32, 0.045, 0.19), new MeshStandardMaterial({ color: '#b98c50', roughness: 0.9 }), RUN.petCap);
  private rightWings = new InstancedMesh(new BoxGeometry(0.32, 0.045, 0.19), new MeshStandardMaterial({ color: '#b98c50', roughness: 0.9 }), RUN.petCap);
  private pools = new InstancedMesh(new CylinderGeometry(1, 1, 0.035, 12), new MeshBasicMaterial({ color: '#e47732', transparent: true, opacity: 0.34, depthWrite: false }), RUN.poolCap);
  private poolRings = new InstancedMesh(new RingGeometry(0.87, 1, 12), new MeshBasicMaterial({ color: '#f8b34a', transparent: true, opacity: 0.68, depthWrite: false }), RUN.poolCap);
  private burn = new InstancedMesh(new ConeGeometry(0.07, 0.2, 4), new MeshBasicMaterial({ color: '#f27a36' }), RUN.enemyCap);
  private slow = new InstancedMesh(new OctahedronGeometry(0.11, 0), new MeshBasicMaterial({ color: '#8cdae8' }), RUN.enemyCap);
  private stun = new InstancedMesh(new OctahedronGeometry(0.1, 0), new MeshBasicMaterial({ color: '#edcd66' }), RUN.enemyCap);
  private shields = new InstancedMesh(new RingGeometry(0.17, 0.2, 8), new MeshBasicMaterial({ color: '#68d1e4', transparent: true, opacity: 0.78, depthWrite: false }), RUN.enemyCap);
  private shred = new InstancedMesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial({ color: '#ba73cc' }), RUN.enemyCap);
  private jinx = new InstancedMesh(new OctahedronGeometry(0.12, 0), new MeshBasicMaterial({ color: '#bb72d0' }), WORLD.cols * WORLD.rows);
  private silence = new InstancedMesh(new RingGeometry(0.22, 0.28, 8), new MeshBasicMaterial({ color: '#7e83cf', transparent: true, opacity: 0.8, depthWrite: false }), WORLD.cols * WORLD.rows);
  private rally = new InstancedMesh(new OctahedronGeometry(0.12, 0), new MeshBasicMaterial({ color: '#f1d67a' }), WORLD.cols * WORLD.rows);
  private eventRings = new InstancedMesh(new RingGeometry(0.78, 1, 12), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.76 }), EVENT_CAP);
  private eventDisks = new InstancedMesh(new CylinderGeometry(1, 1, 0.035, 12), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.48 }), EVENT_CAP);
  private eventMarkers = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: '#ffffff', transparent: true }), EVENT_CAP);
  private eventLines = new LineSegments(new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(new Float32Array(EVENT_CAP * 6), 3))
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(EVENT_CAP * 6), 3)),
  new LineBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false }));
  private readonly visualMeshes: InstancedMesh[] = [
    this.bolts, this.stones, this.pets, this.leftWings, this.rightWings, this.pools, this.poolRings,
    this.burn, this.slow, this.stun, this.shields, this.shred, this.jinx, this.silence, this.rally,
    this.eventRings, this.eventDisks, this.eventMarkers,
  ];
  private readonly eventFx: EventFx[] = Array.from({ length: EVENT_CAP }, () => ({
    family: 'none', left: 0, life: 0.42, x: 0, y: 0, z: 0, radius: 0,
    x2: 0, y2: 0, z2: 0, color: new Color(),
  }));
  private nextEventFx = 0;
  private transform = new Object3D();
  private point = new Vector3();
  private target = new Vector3();
  private wingLeft = new Object3D();
  private wingRight = new Object3D();
  private color = new Color();
  reduceMotion = false;
  private beams = new LineSegments(new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(new Float32Array(WORLD.cols * WORLD.rows * 6), 3))
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(WORLD.cols * WORLD.rows * 6), 3)),
  new LineBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false }));

  constructor(private readonly proportions: SceneProportions = BASE_SCENE,
    private readonly presentation = new EnemyPresentation()) {
    this.root.name = 'Live effects';
    this.beams.name = 'Live beam lines';
    this.eventLines.name = 'Batched event lines';
    this.beams.frustumCulled = false;
    this.beams.geometry.setDrawRange(0, 0);
    this.beams.material.stencilWrite = true;
    this.beams.material.stencilRef = 0;
    this.beams.material.stencilFunc = AlwaysStencilFunc;
    this.beams.material.stencilZPass = ReplaceStencilOp;
    this.beams.material.depthTest = true;
    this.beams.material.depthWrite = false;
    this.root.add(this.beams);
    this.eventLines.frustumCulled = false;
    mask(this.eventLines.material);
    this.eventLines.renderOrder = 6;
    this.root.add(this.eventLines);
    for (const mesh of this.visualMeshes) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mask(mesh.material as MeshBasicMaterial | MeshStandardMaterial);
      mesh.renderOrder = 5;
      mesh.name = mesh === this.bolts ? 'bolts' : mesh === this.stones ? 'stones'
        : mesh === this.pets ? 'pets' : mesh === this.leftWings ? 'leftWings' : mesh === this.rightWings ? 'rightWings'
          : mesh === this.pools ? 'pools' : mesh === this.poolRings ? 'poolRings'
            : mesh === this.burn ? 'burn' : mesh === this.slow ? 'slow' : mesh === this.stun ? 'stun'
              : mesh === this.shields ? 'shields' : mesh === this.shred ? 'shred'
                : mesh === this.jinx ? 'jinx' : mesh === this.silence ? 'silence' : mesh === this.rally ? 'rally'
                  : mesh === this.eventRings ? 'Batched event rings'
                    : mesh === this.eventDisks ? 'Batched event disks' : 'Batched event markers';
      this.root.add(mesh);
    }
  }

  consume(s: RunState): void {
    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      const tower = e.type === 'shot' ? this.towerByUid(s, e.b) : this.towerAt(s, e.x, e.y);
      switch (e.type) {
        case 'shot': {
          if (!tower) break;
          groundPoint(tower.x, tower.y, muzzleHeight(tower, s.terrain, this.proportions), this.point);
          const length = 0.36;
          this.target.set(this.point.x + Math.cos(e.a) * length, this.point.y, this.point.z + Math.sin(e.a) * length);
          this.queueEventFx('line', this.point.x, this.point.y, this.point.z, 0,
            this.attackColor(tower), 0.18, this.target.x, this.target.y, this.target.z);
          break;
        }
        case 'hit': this.showFlash('marker', e.x, e.y, 0.5, 0.18, '#f1dfae'); break;
        case 'kill':
          this.showFlash('ring', e.x, e.y, 0.08, Math.max(0.34, e.b / WORLD.hex * 0.7), e.c ? '#f0c36d' : '#d7b47c');
          this.showFlash('marker', e.x, e.y, 0.52, e.c ? 0.34 : 0.2, e.c ? '#f1c260' : '#e4d7b4');
          break;
        case 'leak': this.showFlash('marker', e.x, e.y, 0.26, 0.42, '#d64b48'); break;
        case 'splash': case 'cluster':
          this.showFlash('disk', e.x, e.y, 0.035, Math.max(0.3, e.a / WORLD.hex), '#e77737');
          this.showFlash('ring', e.x, e.y, 0.06, Math.max(0.3, e.a / WORLD.hex), '#ffd27a');
          break;
        case 'pulse': {
          const frost = tower?.type === 'frost';
          this.showFlash('ring', e.x, e.y, 0.06, Math.max(0.32, e.a / WORLD.hex), frost ? '#8fdaeb' : '#f4d98a');
          break;
        }
        case 'chain': {
          const source = this.towerAt(s, e.x, e.y) ?? this.towerAt(s, e.x, e.y + 16);
          if (source && Math.abs(e.y - (source.y - 16)) < 1) groundPoint(source.x, source.y, muzzleHeight(source, s.terrain, this.proportions), this.point);
          else groundPoint(e.x, e.y, source ? muzzleHeight(source, s.terrain, this.proportions) : 0.62 / this.proportions.tile, this.point);
          groundPoint(e.a, e.b, 0.62, this.target);
          this.queueEventFx('line', this.point.x, this.point.y, this.point.z, 0,
            source ? this.attackColor(source) : '#81e1f2', 0.19, this.target.x, this.target.y, this.target.z);
          break;
        }
        case 'cleave': {
          const len = Math.min(0.95, Math.max(0.5, e.b / WORLD.hex * 0.22));
          groundPoint(e.x, e.y, tower ? muzzleHeight(tower, s.terrain, this.proportions) : 0.72 / this.proportions.tile, this.point);
          this.target.set(this.point.x + Math.cos(e.a) * len, this.point.y + 0.08, this.point.z + Math.sin(e.a) * len);
          this.queueEventFx('line', this.point.x, this.point.y, this.point.z, 0,
            '#e6d0a4', 0.21, this.target.x, this.target.y, this.target.z);
          break;
        }
        case 'bite': this.showFlash('marker', e.x, e.y, 0.62, 0.2, '#d5a66b'); break;
        case 'build': this.showFlash('marker', e.x, e.y, 0.28, e.a ? 0.32 : 0.24, '#97bd78'); break;
        case 'upgrade': case 'skill': case 'heroLevel':
          this.showFlash('ring', e.x, e.y, 0.12, 0.42, '#f1d276'); break;
        case 'sell': this.showFlash('marker', e.x, e.y, 0.27, 0.25, '#b79c7a'); break;
        case 'clear': this.showFlash('disk', e.x, e.y, 0.025, 0.35, e.a === 1 ? '#52683a' : '#788087'); break;
        case 'wave': case 'waveClear': case 'gold': case 'win': case 'lose': {
          const [col, row] = s.terrain.goal;
          const ground = tileCenter(col, row);
          const color = e.type === 'lose' ? '#cf6157' : e.type === 'win' || e.type === 'waveClear' ? '#f1d276' : '#b8d08a';
          this.showFlash('ring', ground.x, ground.y, 0.1, 0.55, color);
          break;
        }
        case 'ability': {
          const color = e.b === 0 ? '#d49a54' : e.b === 1 ? '#f5d578' : e.b === 2 ? '#a897ed' : e.b === 3 ? '#e4c976' : '#94bd72';
          const radius = Math.max(0.34, e.a / WORLD.hex);
          this.showFlash(e.a > 0 ? 'ring' : 'marker', e.x, e.y, 0.12, radius, color);
          break;
        }
        case 'shield': this.showFlash('disk', e.x, e.y, 0.035, Math.max(0.35, e.a / WORLD.hex), '#5ec4dc'); break;
        case 'silence': this.showFlash('ring', e.x, e.y, 0.12, Math.max(0.35, e.a / WORLD.hex), '#8d85d1'); break;
        case 'jinx': this.showFlash('marker', e.x, e.y, 1, 0.22, '#b46cc7'); break;
        case 'boss': this.showFlash('ring', e.x, e.y, 0.08, Math.max(0.6, e.a / WORLD.hex), '#d6574c'); break;
        case 'shed': this.showFlash('marker', e.x, e.y, 0.65, 0.28, '#d89d55'); break;
        case 'smash': this.showFlash('marker', e.x, e.y, 0.55, 0.24, '#cc6b4e'); break;
        case 'destroyed': this.showFlash('disk', e.x, e.y, 0.04, e.a ? 0.52 : 0.34, '#8f7667'); break;
        case 'keep': this.showFlash('ring', e.x, e.y, 0.16, 0.72, '#f4d276'); break;
      }
    }
  }

  private towerByUid(s: RunState, uid: number): Tower | undefined {
    for (const tower of s.towers) if (tower.uid === uid) return tower;
    return undefined;
  }

  private towerAt(s: RunState, x: number, y: number): Tower | undefined {
    for (const tower of s.towers) if (Math.abs(tower.x - x) < 1
      && (Math.abs(tower.y - y) < 1 || Math.abs(tower.y - 16 - y) < 1)) return tower;
    return undefined;
  }

  private attackColor(tower: Tower): string {
    const def = tower.hero ? HEROES[tower.type as keyof typeof HEROES] : TOWERS[tower.type as keyof typeof TOWERS];
    if (def.dmgType === 'fire') return '#e9803c';
    if (tower.type === 'lightning') return '#7edbf3';
    if (tower.type === 'mage' || tower.type === 'sorcerer') return '#a398e6';
    if (def.dmgType === 'magic') return tower.type === 'frost' ? '#8fd9e9' : '#e6d78e';
    return tower.type === 'palisade' ? '#b69a73' : '#e1c17d';
  }

  private showFlash(family: Exclude<EventFx['family'], 'none' | 'line'>, x: number, z: number, y: number, radius: number, color: string): void {
    this.queueEventFx(family, x / WORLD.hex, y, z / WORLD.hex, radius, color, 0.42);
  }

  private queueEventFx(family: EventFx['family'], x: number, y: number, z: number, radius: number,
    color: string, life: number, x2 = 0, y2 = 0, z2 = 0): void {
    const fx = this.eventFx[this.nextEventFx++ % this.eventFx.length];
    fx.family = family;
    fx.life = this.reduceMotion ? Math.min(life, 0.14) : life;
    fx.left = fx.life;
    fx.x = x; fx.y = y; fx.z = z; fx.radius = radius;
    fx.x2 = x2; fx.y2 = y2; fx.z2 = z2;
    fx.color.set(color);
  }

  update(s: RunState, alpha: number, dt: number): void {
    const beamPositions = this.beams.geometry.getAttribute('position');
    const beamColors = this.beams.geometry.getAttribute('color');
    let beamCount = 0;
    for (const tower of s.towers) {
      if (!tower.beamUid || tower.stats.beam <= 0) continue;
      const target = this.enemyByUid(s, tower.beamUid);
      if (!target) continue;
      groundPoint(tower.x, tower.y, muzzleHeight(tower, s.terrain, this.proportions), this.point);
      const x = target.px + (target.x - target.px) * alpha + target.ox;
      const y = target.py + (target.y - target.py) * alpha + target.oy;
      groundPoint(x, y, enemyBodyCenterHeight(target, s.terrain, x, y, this.proportions, this.presentation), this.target);
      beamPositions.setXYZ(beamCount++, this.point.x, this.point.y, this.point.z);
      beamPositions.setXYZ(beamCount++, this.target.x, this.target.y, this.target.z);
      this.color.set(this.attackColor(tower));
      beamColors.setXYZ(beamCount - 2, this.color.r, this.color.g, this.color.b);
      beamColors.setXYZ(beamCount - 1, this.color.r, this.color.g, this.color.b);
    }
    this.beams.geometry.setDrawRange(0, beamCount);
    beamPositions.needsUpdate = beamColors.needsUpdate = true;
    let bolts = 0, stones = 0;
    for (let i = 0; i < s.projectiles.count; i++) {
      const p = s.projectiles.items[i];
      projectilePoint(p, alpha, this.transform.position, s.terrain, this.proportions, this.presentation);
      const target = currentProjectileTarget(p);
      if (target) groundPoint(target.x + target.ox, target.y + target.oy,
        enemyBodyCenterHeight(target, s.terrain, undefined, undefined, this.proportions, this.presentation), this.target);
      else groundPoint(p.tx, p.ty, 0.55, this.target);
      this.transform.lookAt(this.target);
      this.transform.scale.set(1, 1, 1);
      this.transform.updateMatrix();
      if (p.kind === 'lob') {
        this.stones.setMatrixAt(stones, this.transform.matrix);
        this.color.set(p.owner ? this.attackColor(p.owner) : '#bfa78e');
        this.stones.setColorAt(stones++, this.color);
      } else {
        this.bolts.setMatrixAt(bolts, this.transform.matrix);
        this.color.set(p.owner ? this.attackColor(p.owner) : '#ead9a2');
        this.bolts.setColorAt(bolts++, this.color);
      }
    }
    this.bolts.count = bolts; this.stones.count = stones;
    this.pets.count = s.pets.count;
    let petIndex = 0;
    for (let i = 0; i < s.pets.count; i++) {
      const p = s.pets.items[i];
      const target = p.target && p.target.uid === p.targetUid && !p.target.dead ? p.target : null;
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha + (target ? 0 : 10); // cancel the simulation's orbit -10
      const elevation = target
        ? enemyBodyCenterHeight(target, s.terrain, target.x + target.ox, target.y + target.oy, this.proportions, this.presentation)
        : muzzleHeight(p.owner, s.terrain, this.proportions) + 0.45 / this.proportions.tile;
      groundPoint(x, y, elevation, this.transform.position);
      const dx = target ? target.x - x : p.x - p.px;
      const dz = target ? target.y - y : p.y - p.py;
      const yaw = dx || dz ? Math.atan2(dx, dz) : 0;
      const flap = this.reduceMotion ? 0 : Math.sin(s.t * 18 + p.phase) * 0.48;
      this.transform.rotation.set(0, yaw, 0);
      this.transform.updateMatrix(); this.pets.setMatrixAt(i, this.transform.matrix);
      this.color.set(p.temp ? '#c59a59' : '#8f6841');
      this.pets.setColorAt(i, this.color);
      this.wingLeft.position.set(this.transform.position.x - Math.cos(yaw) * 0.15, elevation + Math.abs(flap) * 0.035, this.transform.position.z + Math.sin(yaw) * 0.15);
      this.wingLeft.rotation.set(0, yaw, -0.24 - flap);
      this.wingLeft.scale.set(1, 1, 1); this.wingLeft.updateMatrix(); this.leftWings.setMatrixAt(i, this.wingLeft.matrix);
      this.wingRight.position.set(this.transform.position.x + Math.cos(yaw) * 0.15, elevation + Math.abs(flap) * 0.035, this.transform.position.z - Math.sin(yaw) * 0.15);
      this.wingRight.rotation.set(0, yaw, 0.24 + flap);
      this.wingRight.scale.set(1, 1, 1); this.wingRight.updateMatrix(); this.rightWings.setMatrixAt(i, this.wingRight.matrix);
      petIndex++;
    }
    this.leftWings.count = this.rightWings.count = petIndex;
    this.pools.count = s.pools.count;
    this.poolRings.count = s.pools.count;
    for (let i = 0; i < s.pools.count; i++) {
      const p = s.pools.items[i];
      groundPoint(p.x, p.y, 0.035, this.transform.position);
      const scale = p.r / WORLD.hex;
      this.transform.rotation.set(0, 0, 0);
      this.transform.scale.set(scale, 1, scale);
      this.transform.updateMatrix(); this.pools.setMatrixAt(i, this.transform.matrix);
      this.transform.position.y += 0.008;
      this.transform.rotation.x = -Math.PI / 2;
      this.transform.scale.set(scale * (0.98 + (this.reduceMotion ? 0 : Math.sin(p.t * 7) * 0.025)), 1, scale * (0.98 + (this.reduceMotion ? 0 : Math.sin(p.t * 7) * 0.025)));
      this.transform.updateMatrix(); this.poolRings.setMatrixAt(i, this.transform.matrix);
    }
    let burnCount = 0, slowCount = 0, stunCount = 0, shieldCount = 0, shredCount = 0;
    for (let i = 0; i < s.enemies.count; i++) {
      const e = s.enemies.items[i];
      if (e.dead) continue;
      const x = e.px + (e.x - e.px) * alpha + e.ox;
      const y = e.py + (e.y - e.py) * alpha + e.oy;
      const sceneX = x / WORLD.hex, sceneZ = y / WORLD.hex;
      const ground = groundHeightAt(s.terrain, sceneX, sceneZ) / this.proportions.tile;
      const base = ground + (e.def.flying ? 0.8 / this.proportions.tile : 0)
        + enemyGroundingOffset(e.def.id, e.uid, this.proportions, this.presentation);
      const height = enemyHeight(e.def.id, e.uid, this.proportions);
      const size = Math.max(0.12, Math.min(0.22, height * 0.14));
      if (e.burnT > 0) this.writeGlyph(this.burn, burnCount++, x - e.def.radius * 0.45, y, base + height * 0.92, size);
      if (e.slowT > 0) this.writeGlyph(this.slow, slowCount++, x, y, base + height * 1.08, size);
      if (e.stunT > 0) this.writeGlyph(this.stun, stunCount++, x + e.def.radius * 0.45, y, base + height * 1.01, size, this.reduceMotion ? 0 : s.t * 3);
      if (e.shield > 0) this.writeGlyph(this.shields, shieldCount++, x, y, base + height * 0.48, size * 1.45, 0);
      if (e.shred > 0) this.writeGlyph(this.shred, shredCount++, x + e.def.radius * 0.5, y, base + height * 0.9, size * 0.8);
    }
    this.burn.count = burnCount; this.slow.count = slowCount; this.stun.count = stunCount;
    this.shields.count = shieldCount; this.shred.count = shredCount;
    let jinxCount = 0, silenceCount = 0, rallyCount = 0;
    for (const tower of s.towers) {
      const y = muzzleHeight(tower, s.terrain, this.proportions) + 0.18 / this.proportions.tile;
      if (tower.jinxT > 0) this.writeGlyph(this.jinx, jinxCount++, tower.x, tower.y, y, 0.85);
      if (tower.silenceT > 0) this.writeGlyph(this.silence, silenceCount++, tower.x, tower.y, y, 0.9);
      if (s.rallyT > 0) this.writeGlyph(this.rally, rallyCount++, tower.x, tower.y, y + 0.14, 0.85);
    }
    this.jinx.count = jinxCount; this.silence.count = silenceCount; this.rally.count = rallyCount;
    this.updateEventFx(dt);
    for (const mesh of this.visualMeshes) mesh.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    if (this.stones.instanceColor) this.stones.instanceColor.needsUpdate = true;
    if (this.pets.instanceColor) this.pets.instanceColor.needsUpdate = true;
  }

  private enemyByUid(s: RunState, uid: number) {
    for (let i = 0; i < s.enemies.count; i++) {
      const enemy = s.enemies.items[i];
      if (enemy.uid === uid && !enemy.dead) return enemy;
    }
    return null;
  }

  private writeGlyph(mesh: InstancedMesh, index: number, x: number, y: number, elevation: number, scale: number, rotation = 0): void {
    groundPoint(x, y, elevation, this.transform.position);
    this.transform.rotation.set(mesh === this.shields || mesh === this.silence ? -Math.PI / 2 : 0, rotation, 0);
    this.transform.scale.set(scale, mesh === this.shields || mesh === this.silence ? 1 : scale, scale);
    this.transform.updateMatrix();
    mesh.setMatrixAt(index, this.transform.matrix);
  }

  private updateEventFx(dt: number): void {
    let rings = 0, disks = 0, markers = 0, lines = 0;
    const positions = this.eventLines.geometry.getAttribute('position');
    const colors = this.eventLines.geometry.getAttribute('color');
    for (const fx of this.eventFx) {
      if (fx.left <= 0 || fx.family === 'none') continue;
      fx.left = Math.max(0, fx.left - dt);
      const life = fx.left / fx.life;
      if (fx.left <= 0) continue;
      if (fx.family === 'ring') {
        const radius = fx.radius * (1 + (this.reduceMotion ? 0 : (1 - life) * 0.28));
        this.transform.position.set(fx.x, fx.y, fx.z);
        this.transform.rotation.set(-Math.PI / 2, 0, 0);
        this.transform.scale.set(radius, radius, radius);
        this.transform.updateMatrix(); this.eventRings.setMatrixAt(rings, this.transform.matrix); this.eventRings.setColorAt(rings++, fx.color);
      } else if (fx.family === 'disk') {
        const radius = fx.radius * (1 + (1 - life) * 0.12);
        this.transform.position.set(fx.x, fx.y, fx.z);
        this.transform.rotation.set(0, 0, 0);
        this.transform.scale.set(radius, 1, radius);
        this.transform.updateMatrix(); this.eventDisks.setMatrixAt(disks, this.transform.matrix); this.eventDisks.setColorAt(disks++, fx.color);
      } else if (fx.family === 'marker') {
        const scale = fx.radius * (0.8 + 0.2 * life);
        this.transform.position.set(fx.x, fx.y + (1 - life) * 0.08, fx.z);
        this.transform.rotation.set(0, (1 - life) * 0.8, 0);
        this.transform.scale.setScalar(scale);
        this.transform.updateMatrix(); this.eventMarkers.setMatrixAt(markers, this.transform.matrix); this.eventMarkers.setColorAt(markers++, fx.color);
      } else {
        positions.setXYZ(lines * 2, fx.x, fx.y, fx.z);
        positions.setXYZ(lines * 2 + 1, fx.x2, fx.y2, fx.z2);
        colors.setXYZ(lines * 2, fx.color.r, fx.color.g, fx.color.b);
        colors.setXYZ(lines * 2 + 1, fx.color.r, fx.color.g, fx.color.b);
        lines++;
      }
    }
    this.eventRings.count = rings; this.eventDisks.count = disks; this.eventMarkers.count = markers;
    this.eventLines.geometry.setDrawRange(0, lines * 2);
    positions.needsUpdate = colors.needsUpdate = true;
    if (this.eventRings.instanceColor) this.eventRings.instanceColor.needsUpdate = true;
    if (this.eventDisks.instanceColor) this.eventDisks.instanceColor.needsUpdate = true;
    if (this.eventMarkers.instanceColor) this.eventMarkers.instanceColor.needsUpdate = true;
  }

  reset(): void {
    this.beams.geometry.setDrawRange(0, 0);
    this.eventLines.geometry.setDrawRange(0, 0);
    for (const fx of this.eventFx) { fx.family = 'none'; fx.left = 0; }
    this.nextEventFx = 0;
    for (const mesh of this.visualMeshes) mesh.count = 0;
  }

  dispose(): void {
    this.beams.geometry.dispose();
    this.beams.material.dispose();
    this.eventLines.geometry.dispose();
    this.eventLines.material.dispose();
    disposeTerrain(this.root);
    this.root.removeFromParent();
  }
}
