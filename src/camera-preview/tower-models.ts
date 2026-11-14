import { Vector3 } from 'three';
import { HERO_IDS, TOWER_IDS, type TowerId } from '../data/balance';
import { FEATURE } from '../sim/mapgen';
import type { Tower } from '../sim/state';
import { paintArcherBowman, paintArcherPlatform } from './archer-tower';
import { Painter, type Voxel } from './voxel-model';
import { paintNature } from './nature-models';

const STONE = '#bcb9aa', PALE_STONE = '#ded8c6', DARK_STONE = '#727b7d';
const WOOD = '#956032', LIGHT_WOOD = '#bd8445', DARK_WOOD = '#60472e';
const BRASS = '#c3a65f', IRON = '#59666b', ICE = '#9acbd0', DEEP_ICE = '#638f9b';
const LEAF = '#607b42', PALE_LEAF = '#8ca05b';

type TowerShape = Pick<Tower, 'type' | 'tier' | 'fork' | 'forkTier'>;
type HeroShape = Pick<Tower, 'type' | 'heroLevel' | 'skills'>;

function box(p: Painter, o: Vector3, dx: number, dy: number, dz: number, w: number, h: number, d: number, color: string): void {
  p.box(o.x + dx, o.y + dy, o.z + dz, w, h, d, color);
}

function stageOf(t: TowerShape): number {
  return t.fork ? 3 + t.forkTier : t.tier;
}

function base(p: Painter, o: Vector3, color = DARK_STONE): void {
  box(p, o, 0, 0.08, 0, 0.94, 0.16, 0.94, color);
}

function stageBadge(p: Painter, o: Vector3, stage: number, fork: TowerShape['fork']): void {
  const hue = fork === 'a' ? '#789b70' : fork === 'b' ? '#bd8050' : BRASS;
  // Small stepped pennon at the back marks advancement without changing the footprint.
  box(p, o, -0.42, 0.54 + stage * 0.045, -0.32, 0.055, 0.42 + stage * 0.035, 0.055, DARK_WOOD);
  box(p, o, -0.33, 0.69 + stage * 0.07, -0.32, 0.2 + stage * 0.025, 0.15, 0.08, hue);
  if (stage >= 5) box(p, o, -0.31, 0.79 + stage * 0.07, -0.32, 0.08, 0.07, 0.08, PALE_STONE);
}

function archer(p: Painter, t: TowerShape, o: Vector3): void {
  paintArcherPlatform(p, o);
  const stage = stageOf(t);
  const accent = t.fork === 'a' ? '#769374' : t.fork === 'b' ? '#b86e48' : LIGHT_WOOD;
  // Roofless platform is kept clear so its independently rotating bowman has room to aim.
  for (let n = 0; n < stage; n++) {
    const side = n % 4;
    const offset = Math.floor(n / 4) * 0.13;
    const y = 1.56 + (n % 2) * 0.1;
    if (side === 0) box(p, o, -0.42 + offset, y, 0.43, 0.11, 0.12, 0.08, accent);
    else if (side === 1) box(p, o, 0.42 - offset, y, -0.43, 0.11, 0.12, 0.08, accent);
    else if (side === 2) box(p, o, 0.43, y, 0.42 - offset, 0.08, 0.12, 0.11, accent);
    else box(p, o, -0.43, y, -0.42 + offset, 0.08, 0.12, 0.11, accent);
  }
  stageBadge(p, o, stage, t.fork);
}

function palisade(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); const fortified = t.tier > 1 || !!t.fork;
  base(p, o, fortified ? DARK_STONE : DARK_WOOD);
  for (let i = -2; i <= 2; i++) {
    const h = 0.72 + (i % 2 === 0 ? 0.12 : 0) + Math.max(0, stage - 2) * 0.08;
    box(p, o, i * 0.18, 0.16 + h / 2, 0, 0.15, h, 0.3, fortified ? STONE : WOOD);
    if (fortified && stage >= 4) box(p, o, i * 0.18, 0.2 + h, 0, 0.18, 0.12, 0.34, t.fork === 'b' ? BRASS : PALE_STONE);
  }
  box(p, o, 0, 0.44, 0.17, 0.96, 0.13, 0.12, fortified ? IRON : DARK_WOOD);
  if (t.fork === 'a') {
    box(p, o, 0, 0.68, -0.2, 0.68, 0.3, 0.12, '#738e74');
    box(p, o, 0, 0.68, -0.27, 0.16, 0.16, 0.035, BRASS);
  } else if (t.fork === 'b') {
    for (const x of [-0.32, 0.32]) box(p, o, x, 0.86, -0.12, 0.14, 0.2, 0.14, '#c9854e');
  }
  stageBadge(p, o, stage, t.fork);
}

function catapult(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, DARK_WOOD);
  box(p, o, 0, 0.26, 0, 0.72, 0.2, 0.62, WOOD);
  for (const x of [-0.34, 0.34]) for (const z of [-0.24, 0.24]) {
    box(p, o, x, 0.27, z, 0.14, 0.36 + Math.max(0, stage - 3) * 0.04, 0.14, DARK_WOOD);
    box(p, o, x, 0.22, z, 0.24, 0.12, 0.24, IRON);
  }
  box(p, o, 0, 0.58 + stage * 0.045, 0, 0.15, 0.78 + stage * 0.05, 0.15, WOOD);
  for (let i = 0; i < 4 + Math.floor(stage / 2); i++) box(p, o, 0, 0.38 + i * 0.1, -0.25 + i * 0.11, 0.16, 0.15, 0.16, i % 2 ? LIGHT_WOOD : DARK_WOOD);
  if (t.fork === 'a') {
    box(p, o, -0.24, 0.63, 0.1, 0.2, 0.42, 0.26, IRON);
    box(p, o, 0.24, 0.63, 0.1, 0.2, 0.42, 0.26, IRON);
  } else if (t.fork === 'b') {
    box(p, o, 0, 1.06, 0.3, 0.36, 0.34, 0.36, stage >= 5 ? '#c47747' : '#9a8f70');
    if (stage >= 5) box(p, o, 0, 1.27, 0.3, 0.2, 0.1, 0.2, '#d8a15f');
  } else box(p, o, 0, 1.03 + stage * 0.04, 0.25, 0.3 + stage * 0.04, 0.28, 0.3 + stage * 0.04, '#9a9684');
  stageBadge(p, o, stage, t.fork);
}

function frost(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, '#768b8d');
  box(p, o, 0, 0.2, 0, 0.72, 0.15, 0.72, '#abc4c0');
  const count = 3 + stage;
  for (let i = 0; i < count; i++) {
    const x = (i % 3 - 1) * 0.22; const z = (Math.floor(i / 3) - 0.5) * 0.3;
    const h = 0.5 + ((i + stage) % 3) * 0.12 + stage * 0.05;
    box(p, o, x, 0.26 + h / 2, z, 0.16 + (i === 0 ? 0.05 : 0), h, 0.16, (i + stage) % 2 ? ICE : DEEP_ICE);
    box(p, o, x, 0.26 + h + 0.06, z, 0.1, 0.12, 0.1, PALE_STONE);
  }
  if (t.fork === 'a') for (const x of [-0.38, 0.38]) box(p, o, x, 0.47, 0, 0.12, 0.66, 0.12, DEEP_ICE);
  if (t.fork === 'b') for (let i = 0; i < 3; i++) box(p, o, -0.25 + i * 0.25, 0.31, -0.36, 0.1, 0.16 + i * 0.06, 0.1, '#b8d8d2');
  stageBadge(p, o, stage, t.fork);
}

function mage(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, DARK_STONE);
  box(p, o, 0, 0.58, 0, 0.5 + stage * 0.025, 0.92 + stage * 0.07, 0.5 + stage * 0.025, STONE);
  for (const x of [-0.26, 0.26]) box(p, o, x, 0.62, 0, 0.12, 0.98 + stage * 0.07, 0.56, DARK_STONE);
  for (let i = 0; i < 3 + Math.floor(stage / 2); i++) box(p, o, 0, 1.12 + i * 0.14, 0, i % 2 ? 0.31 : 0.18, 0.14, i % 2 ? 0.31 : 0.18, i % 2 ? '#6fabc0' : '#a4d7d4');
  if (t.fork === 'a') {
    for (const x of [-0.43, 0.43]) box(p, o, x, 1.04, 0, 0.15, 0.28, 0.15, BRASS);
  } else if (t.fork === 'b') {
    box(p, o, 0, 1.18, 0.34, 0.35, 0.35, 0.16, '#7197a6');
    box(p, o, 0, 1.18, 0.44, 0.16, 0.17, 0.04, '#d9c17a');
  }
  stageBadge(p, o, stage, t.fork);
}

function lightning(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, '#778084');
  box(p, o, 0, 0.62, 0, 0.26, 1.08 + stage * 0.06, 0.26, DARK_STONE);
  for (const x of [-0.34, 0.34]) {
    box(p, o, x, 1.16 + stage * 0.04, 0, 0.13, 0.45 + stage * 0.04, 0.13, BRASS);
    box(p, o, x / 2, 1.03 + stage * 0.04, 0, 0.32, 0.1, 0.15, IRON);
  }
  box(p, o, 0, 1.4 + stage * 0.07, 0, 0.18, 0.2, 0.18, '#b8d8d1');
  if (t.fork === 'a') for (const z of [-0.25, 0.25]) box(p, o, 0, 1.12, z, 0.1, 0.62, 0.1, '#c5b267');
  if (t.fork === 'b') {
    box(p, o, 0, 0.42, 0.36, 0.43, 0.32, 0.12, '#829293');
    box(p, o, 0, 0.42, 0.45, 0.16, 0.16, 0.04, '#e0c873');
  }
  stageBadge(p, o, stage, t.fork);
}

function aviary(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, DARK_WOOD);
  for (const x of [-0.31, 0.31]) box(p, o, x, 0.47, 0, 0.14, 0.68 + stage * 0.04, 0.14, WOOD);
  box(p, o, 0, 0.78 + stage * 0.05, 0, 0.76, 0.14, 0.65, LIGHT_WOOD);
  box(p, o, 0, 0.98 + stage * 0.05, -0.04, 0.68, 0.18, 0.64, DARK_WOOD);
  for (const x of [-0.24, 0.24]) {
    box(p, o, x, 0.66, 0.34, 0.11, 0.5, 0.08, WOOD);
    box(p, o, x, 0.71, 0.4, 0.16, 0.1, 0.1, BRASS);
  }
  for (let i = 0; i < 1 + Math.floor(stage / 2); i++) {
    const x = -0.19 + i * 0.19;
    box(p, o, x, 1.24 + stage * 0.035, 0, 0.2, 0.18, 0.24, t.fork === 'b' ? '#746c50' : LEAF);
    box(p, o, x + 0.09, 1.3 + stage * 0.035, 0.11, 0.13, 0.08, 0.2, PALE_LEAF);
  }
  if (t.fork === 'a') box(p, o, 0, 0.38, -0.41, 0.55, 0.13, 0.1, '#91a7a2');
  if (t.fork === 'b') for (const x of [-0.38, 0.38]) box(p, o, x, 1.18, 0, 0.12, 0.3, 0.12, BRASS);
  stageBadge(p, o, stage, t.fork);
}

function shrine(p: Painter, t: TowerShape, o: Vector3): void {
  const stage = stageOf(t); base(p, o, DARK_STONE);
  for (const x of [-0.34, 0.34]) {
    box(p, o, x, 0.5, 0, 0.17, 0.82 + stage * 0.045, 0.2, STONE);
    box(p, o, x, 0.95 + stage * 0.045, 0, 0.24, 0.12, 0.25, PALE_STONE);
  }
  box(p, o, 0, 0.95 + stage * 0.045, 0, 0.78, 0.17, 0.2, STONE);
  box(p, o, 0, 0.42, 0.13, 0.34, 0.35, 0.18, '#9b895b');
  box(p, o, 0, 0.65, 0.25, 0.16, 0.16, 0.08, BRASS);
  if (t.fork === 'a') {
    box(p, o, 0, 1.22 + stage * 0.045, 0, 0.16, 0.34, 0.16, '#9b895b');
    box(p, o, 0, 1.42 + stage * 0.045, 0, 0.3, 0.11, 0.3, BRASS);
  } else if (t.fork === 'b') {
    for (const x of [-0.18, 0.18]) box(p, o, x, 1.03, 0, 0.11, 0.35, 0.11, '#81988a');
  }
  stageBadge(p, o, stage, t.fork);
}

/** Authored working models for every base tower and its seven progression states. */
export function paintTowerModel(p: Painter, t: TowerShape, origin: Vector3): void {
  switch (t.type as TowerId) {
    case 'archer': archer(p, t, origin); break;
    case 'palisade': palisade(p, t, origin); break;
    case 'catapult': catapult(p, t, origin); break;
    case 'frost': frost(p, t, origin); break;
    case 'mage': mage(p, t, origin); break;
    case 'lightning': lightning(p, t, origin); break;
    case 'aviary': aviary(p, t, origin); break;
    case 'shrine': shrine(p, t, origin); break;
  }
}

function heroAccent(p: Painter, o: Vector3, skills: readonly number[], level: number): void {
  const colors = [BRASS, '#79a995', '#a18cbd'];
  const counts = [0, 0, 0];
  for (const code of skills) if (Number.isInteger(code) && code >= 0 && code < 12) counts[Math.floor(code / 4)]++;
  for (let branch = 0; branch < 3; branch++) for (let i = 0; i < counts[branch]; i++) {
    box(p, o, -0.24 + i * 0.12, 0.49 + branch * 0.08, 0.205, 0.075, 0.07, 0.045, colors[branch]);
  }
  for (let i = 1; i < Math.min(level, 5); i++) box(p, o, -0.26 + i * 0.13, 0.92, -0.15, 0.06, 0.1, 0.06, BRASS);
}

/** Distinct provisional voxel silhouettes; skill branches and level are visible as small gear marks. */
export function paintHeroModel(p: Painter, t: HeroShape, o: Vector3): void {
  base(p, o, '#665947');
  if (t.type === 'knight') {
    box(p, o, 0, 0.57, 0, 0.46, 0.7, 0.32, '#53697d');
    box(p, o, 0, 1.02, 0, 0.42, 0.28, 0.36, '#687f8c');
    box(p, o, 0, 1.22, 0, 0.3, 0.16, 0.3, '#879699');
    box(p, o, 0.32, 0.62, 0.08, 0.14, 0.64, 0.1, IRON);
    box(p, o, 0.39, 0.94, 0.08, 0.08, 0.14, 0.2, BRASS);
    box(p, o, -0.36, 0.66, 0, 0.2, 0.42, 0.32, '#8e7557');
    box(p, o, -0.36, 0.66, 0.18, 0.1, 0.22, 0.07, BRASS);
  } else if (t.type === 'cleric') {
    box(p, o, 0, 0.54, 0, 0.55, 0.72, 0.4, '#d0c9b6');
    box(p, o, 0, 1.0, 0, 0.31, 0.28, 0.3, '#cda779');
    box(p, o, 0, 1.2, 0, 0.39, 0.13, 0.34, PALE_STONE);
    box(p, o, 0.36, 0.62, 0, 0.1, 1.05, 0.1, WOOD);
    box(p, o, 0.36, 1.18, 0, 0.3, 0.1, 0.1, BRASS);
    box(p, o, 0.36, 1.18, 0, 0.1, 0.3, 0.1, BRASS);
    box(p, o, -0.18, 0.5, 0.22, 0.12, 0.24, 0.06, '#81988a');
  } else if (t.type === 'sorcerer') {
    box(p, o, 0, 0.56, 0, 0.46, 0.73, 0.36, '#555c79');
    box(p, o, 0, 1.02, 0, 0.3, 0.27, 0.3, '#cba776');
    box(p, o, 0, 1.24, 0, 0.45, 0.14, 0.38, '#655f83');
    box(p, o, 0, 1.36, 0, 0.22, 0.14, 0.22, '#655f83');
    box(p, o, 0.34, 0.63, 0, 0.09, 0.99, 0.09, DARK_WOOD);
    box(p, o, 0.34, 1.19, 0, 0.21, 0.21, 0.21, '#9db9c1');
  } else if (t.type === 'ranger') {
    box(p, o, 0, 0.58, 0, 0.4, 0.68, 0.32, '#586d4d');
    box(p, o, 0, 1.0, 0, 0.32, 0.28, 0.3, '#9b795a');
    box(p, o, 0, 1.19, 0, 0.39, 0.14, 0.34, '#536b49');
    box(p, o, 0.29, 0.65, 0.1, 0.07, 0.82, 0.07, DARK_WOOD);
    box(p, o, 0.36, 0.82, 0.1, 0.1, 0.06, 0.1, LIGHT_WOOD);
    box(p, o, -0.34, 0.58, -0.12, 0.14, 0.36, 0.14, WOOD);
  } else {
    box(p, o, 0, 0.55, 0, 0.48, 0.69, 0.38, '#6b7250');
    box(p, o, 0, 1.0, 0, 0.3, 0.29, 0.3, '#b98d62');
    box(p, o, 0, 1.2, 0, 0.42, 0.14, 0.34, LEAF);
    box(p, o, 0.32, 0.6, 0, 0.11, 0.95, 0.11, DARK_WOOD);
    for (const x of [-0.12, 0.12]) box(p, o, x, 1.38, 0, 0.08, 0.28, 0.08, DARK_WOOD);
    box(p, o, 0.33, 1.15, 0, 0.25, 0.21, 0.25, PALE_LEAF);
  }
  heroAccent(p, o, t.skills, t.heroLevel);
}

/** Keep appearance for levels 1..4; level 4 is supported for future/preview use. */
export function paintKeepUpgrade(p: Painter, level: 1 | 2 | 3 | 4, origin: Vector3): void {
  const o = origin;
  box(p, o, 0, 0.5, 0, 1.05, 1, 0.85, STONE);
  box(p, o, 0, 0.22, 0.44, 0.28, 0.45, 0.05, DARK_WOOD);
  const height = 0.92 + level * 0.12;
  for (const x of [-0.44, 0.44]) for (const z of [-0.35, 0.35]) {
    box(p, o, x, height / 2, z, 0.32, height, 0.32, level >= 3 ? PALE_STONE : STONE);
    for (const dx of [-0.1, 0.1]) for (const dz of [-0.1, 0.1]) {
      box(p, o, x + dx, height + 0.08 + level * 0.025, z + dz, 0.12, 0.16, 0.12, level >= 4 ? BRASS : PALE_STONE);
    }
  }
  for (let n = 1; n < level; n++) box(p, o, -0.48 + n * 0.27, 1.12 + n * 0.13, -0.44, 0.14, 0.14, 0.08, [BRASS, '#81988a', '#a58161'][n - 1]);
  if (level >= 3) box(p, o, 0, 1.3, -0.39, 0.48, 0.22, 0.12, '#81988a');
  if (level >= 4) box(p, o, 0, 1.48, -0.42, 0.14, 0.18, 0.14, BRASS);
}

/** A gate frame aligned around the level-0 road opening. */
export function paintGateModel(p: Painter, origin: Vector3, level = 1): void {
  const o = origin;
  for (const dz of [-0.37, 0.37]) {
    box(p, o, 0, 0.43 + level * 0.035, dz, 0.3, 0.86 + level * 0.07, 0.26, level >= 3 ? PALE_STONE : STONE);
    for (const dx of [-0.1, 0.1]) for (const dz2 of [-0.08, 0.08]) {
      box(p, o, dx, 0.9 + level * 0.07, dz + dz2, 0.08, 0.16 + level * 0.025, 0.08, level >= 4 ? BRASS : PALE_STONE);
    }
  }
  box(p, o, 0, 0.9 + level * 0.07, 0, 0.3, 0.18, 1, STONE);
  if (level >= 2) box(p, o, 0, 1.14, 0, 0.18, 0.22, 0.18, BRASS);
}

export interface ContentLibraryEntry {
  id: string;
  category: 'tower' | 'hero' | 'keep' | 'gate' | 'terrain' | 'nature';
  origin: { x: number; y: number; z: number };
  parts: Voxel[];
  attachments?: { id: string; parts: Voxel[] }[];
}

const cloneParts = (parts: readonly Voxel[]): Voxel[] => parts.map(part => ({ ...part }));

/** Stable, exportable authored source library for Blender/GLB asset production. */
export function exportContentLibrary(): ContentLibraryEntry[] {
  const entries: ContentLibraryEntry[] = [];
  const zero = new Vector3();
  const towerStates = [
    { id: 'tier-1', tier: 1, fork: 0 as const, forkTier: 0 },
    { id: 'tier-2', tier: 2, fork: 0 as const, forkTier: 0 },
    { id: 'tier-3', tier: 3, fork: 0 as const, forkTier: 0 },
    { id: 'fork-a-1', tier: 3, fork: 'a' as const, forkTier: 1 },
    { id: 'fork-a-2', tier: 3, fork: 'a' as const, forkTier: 2 },
    { id: 'fork-b-1', tier: 3, fork: 'b' as const, forkTier: 1 },
    { id: 'fork-b-2', tier: 3, fork: 'b' as const, forkTier: 2 },
  ];
  for (const type of TOWER_IDS) for (const state of towerStates) {
    const painter = new Painter();
    paintTowerModel(painter, { type, tier: state.tier, fork: state.fork, forkTier: state.forkTier }, zero);
    const entry: ContentLibraryEntry = {
      id: `tower/${type}/${state.id}`, category: 'tower', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(painter.parts),
    };
    if (type === 'archer') {
      const aim = new Painter(); paintArcherBowman(aim, zero);
      entry.attachments = [{ id: 'aim-bowman', parts: cloneParts(aim.parts) }];
    }
    entries.push(entry);
  }
  for (const type of HERO_IDS) {
    const variants = [
      { id: 'base', heroLevel: 1, skills: [] },
      { id: 'level-4', heroLevel: 4, skills: [] },
      ...[0, 1, 2].map(branch => ({ id: `skill-branch-${branch}`, heroLevel: 4, skills: [branch * 4] })),
    ];
    for (const variant of variants) {
      const painter = new Painter();
      paintHeroModel(painter, { type, heroLevel: variant.heroLevel, skills: variant.skills }, zero);
      entries.push({ id: `hero/${type}/${variant.id}`, category: 'hero', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(painter.parts) });
    }
  }
  for (const level of [1, 2, 3, 4] as const) {
    const keep = new Painter(); paintKeepUpgrade(keep, level, zero);
    entries.push({ id: `keep/level-${level}`, category: 'keep', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(keep.parts) });
    const gate = new Painter(); paintGateModel(gate, zero, level);
    entries.push({ id: `gate/level-${level}`, category: 'gate', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(gate.parts) });
  }
  const levelColors = ['#bf9b59', '#6b8729', '#5e7e27', '#818b8e', '#dce5e8'];
  for (let level = 0; level < 5; level++) {
    const terrain = new Painter();
    terrain.box(0, -0.07, 0, 0.98, 0.14, 0.98, levelColors[level]);
    if (level > 0) terrain.box(0, -0.21, 0, 0.98, 0.14, 0.98, level <= 2 ? '#815a3d' : '#737c82');
    entries.push({ id: `terrain/level-${level}`, category: 'terrain', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(terrain.parts) });
  }
  for (const [name, kind] of [['forest', FEATURE.forest], ['rocks', FEATURE.rocks]] as const) {
    for (const sample of [0, 1, 2]) {
      const nature = new Painter(); paintNature(nature, kind, zero, sample, 1701 + sample);
      entries.push({ id: `nature/${name}/sample-${sample + 1}`, category: 'nature', origin: { x: 0, y: 0, z: 0 }, parts: cloneParts(nature.parts) });
    }
  }
  return entries;
}
