import {
  Box3, BufferGeometry, CylinderGeometry, Group, InstancedMesh, LineBasicMaterial,
  LineLoop, Matrix4, Mesh, MeshStandardMaterial, Vector3,
  AlwaysStencilFunc, ReplaceStencilOp,
} from 'three';
import { FEATURE, type Terrain } from '../sim/mapgen';
import { type Landmark, type PreviewTerrain, tilePosition } from './terrain';
import { Painter, type Voxel } from './voxel-model';
import { buildSolidVoxels } from './solid-voxels';
import { buildTerrainGround, type TerrainLook } from './terrain-look';
import { paintNature } from './nature-models';
import { buildDecorations, type DecorationLayer } from './decorations';
import { ContentAssetLibrary } from '../render3d/asset-library';
import { hashCell } from '../sim/rng';
import { BASE_SCENE, type SceneProportions } from '../render3d/scene-proportions';

const STONE = '#c2bca5', DARK_WOOD = '#60472e';

export interface EnvironmentFeature {
  mesh: Mesh;
  bounds: Box3;
  material: MeshStandardMaterial;
  tree: boolean;
}

export interface VoxelEnvironment extends PreviewTerrain {
  structures: InstancedMesh;
  decorations: DecorationLayer;
  features: EnvironmentFeature[];
  structureBounds: Box3[];
}

export function writeOccluderMask(material: MeshStandardMaterial, tower: boolean): void {
  material.stencilWrite = true;
  material.stencilRef = tower ? 1 : 0;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilZPass = ReplaceStencilOp;
}

export function partBounds(parts: readonly Voxel[]): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  for (const part of parts) {
    bounds.expandByPoint(point.set(part.x - part.w / 2, part.y - part.h / 2, part.z - part.d / 2));
    bounds.expandByPoint(point.set(part.x + part.w / 2, part.y + part.h / 2, part.z + part.d / 2));
  }
  return bounds;
}

function prepareStaticPrefab(prefab: Group, parent: Group | InstancedMesh, tile: { col: number; row: number }, tower: boolean): void {
  prefab.userData.tile = tile;
  prefab.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) writeOccluderMask(material as MeshStandardMaterial, tower);
    object.castShadow = true;
    object.receiveShadow = true;
  });
  parent.add(prefab);
  prefab.updateMatrixWorld(true);
}

function firstMesh(root: Group): Mesh | null {
  let found: Mesh | null = null;
  root.traverse(object => { if (!found && object instanceof Mesh) found = object; });
  return found;
}

function rescaleParts(parts: Voxel[], start: number, anchor: Vector3, scale: number): void {
  if (scale === 1) return;
  for (let index = start; index < parts.length; index++) {
    const part = parts[index];
    part.x = anchor.x + (part.x - anchor.x) * scale;
    part.y = anchor.y + (part.y - anchor.y) * scale;
    part.z = anchor.z + (part.z - anchor.z) * scale;
    part.w *= scale;
    part.h *= scale;
    part.d *= scale;
  }
}

function tree(p: Painter, x: number, y: number, z: number): void {
  p.box(x, y + 0.21, z, 0.12, 0.42, 0.12, DARK_WOOD);
  for (let n = 0; n < 4; n++) {
    const size = 0.66 - n * 0.13;
    p.box(x, y + 0.43 + n * 0.2, z, size, 0.23, size, n % 2 ? '#426438' : '#345b36');
  }
}

/** Shared static scene geometry used by the preview and the live renderer. */
export function buildVoxelEnvironment(
  terrain: Terrain,
  terrainLook: TerrainLook = 'artwork',
  library: ContentAssetLibrary | null = null,
  keepLevel = 1,
  proportions: SceneProportions = BASE_SCENE,
): VoxelEnvironment {
  const root = new Group();
  const structures = new Painter();
  const structureBounds: Box3[] = [];
  const features: EnvironmentFeature[] = [];
  const positions = Array.from(terrain.height.keys(), (i) => {
    const position = tilePosition(terrain, i);
    position.y /= proportions.tile;
    return position;
  });
  const decorations = buildDecorations(terrain, proportions);
  decorations.root.visible = terrainLook === 'artwork';
  root.add(decorations.root);
  positions.forEach(({ x, y, z }, i) => {
    const kind = terrain.feature[i];
    if (terrainLook === 'artwork' && library && (kind === FEATURE.forest || kind === FEATURE.rocks)) {
      const col = i % terrain.cols, row = Math.floor(i / terrain.cols);
      const sample = 1 + Math.floor(hashCell(terrain.seed, col, row) * 3);
      const name = kind === FEATURE.forest ? `nature/forest/sample-${sample}` : `nature/rocks/sample-${sample}`;
      const prefab = library.instantiate(name, true);
      if (prefab) {
        const size = 0.92 + hashCell(terrain.seed ^ 0x4129b, col, row) * 0.13;
        prefab.name = `${kind === FEATURE.forest ? 'Forest' : 'Rocks'} tile ${i}`;
        prefab.position.set(x, y, z);
        prefab.rotation.y = Math.floor(hashCell(terrain.seed ^ 0x2be51, row, col) * 4) * Math.PI / 2;
        const width = 0.96 + hashCell(terrain.seed ^ 0x783fa, col, row) * 0.08;
        const height = 0.94 + hashCell(terrain.seed ^ 0x1bef4, row, col) * 0.12;
        const scale = proportions.vegetation / proportions.tile;
        prefab.scale.set(size * width * scale, size * height * scale, size * scale);
        const mesh = firstMesh(prefab);
        if (mesh) {
          const material = mesh.material as MeshStandardMaterial;
          material.transparent = true;
          material.opacity = 1;
          material.depthWrite = true;
          writeOccluderMask(material, false);
          mesh.renderOrder = 10;
          const bounds = new Box3().setFromObject(prefab);
          features.push({ mesh, material, bounds, tree: kind === FEATURE.forest });
          prefab.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
          root.add(prefab);
          return;
        }
      }
    }
    const feature = new Painter();
    if (terrainLook === 'artwork') paintNature(feature, terrain.feature[i], positions[i], i, terrain.seed);
    else if (terrain.feature[i] === FEATURE.forest) {
      tree(feature, x - 0.25, y, z - 0.1);
      tree(feature, x + 0.23, y, z + 0.15);
    } else if (terrain.feature[i] === FEATURE.rocks) {
      feature.box(x - 0.18, y + 0.15, z, 0.42, 0.3, 0.42, '#a6a495');
      feature.box(x + 0.2, y + 0.11, z + 0.1, 0.28, 0.22, 0.28, '#b4b2a3');
      feature.box(x - 0.15, y + 0.36, z, 0.24, 0.12, 0.27, '#c0bfae');
    }
    if (!feature.parts.length) return;
    const mesh = terrainLook === 'artwork' ? buildSolidVoxels(feature.parts) : feature.mesh();
    mesh.name = `${terrain.feature[i] === FEATURE.forest ? 'Forest' : 'Rocks'} tile ${i}`;
    const featureScale = proportions.vegetation / proportions.tile;
    mesh.scale.setScalar(featureScale);
    mesh.position.set(x * (1 - featureScale), y * (1 - featureScale), z * (1 - featureScale));
    const material = mesh.material as MeshStandardMaterial;
    material.transparent = true;
    writeOccluderMask(material, false);
    mesh.renderOrder = 10;
    features.push({ mesh, material, bounds: new Box3().setFromObject(mesh), tree: terrain.feature[i] === FEATURE.forest });
    root.add(mesh);
  });

  const landmarks: Landmark[] = [];
  const keep = positions[terrain.goal[1] * terrain.cols + terrain.goal[0]];
  const structuresPrefabs: Group[] = [];
  const buildingScale = proportions.buildings / proportions.tile;
  const level = Math.max(1, Math.min(4, Math.round(keepLevel)));
  const keepParts = structures.parts.length;
  const keepPrefab = library?.instantiate(`keep/level-${level}`);
  if (keepPrefab) {
    keepPrefab.name = `Keep level ${level}`;
    keepPrefab.scale.multiplyScalar(buildingScale);
    keepPrefab.position.copy(keep);
    prepareStaticPrefab(keepPrefab, root, { col: terrain.goal[0], row: terrain.goal[1] }, true);
    structuresPrefabs.push(keepPrefab);
    const bounds = new Box3().setFromObject(keepPrefab);
    structureBounds.push(bounds);
    const label = keep.clone(); label.y = bounds.max.y + 0.1;
    landmarks.push({ label: 'K', kind: 'keep', position: label });
  } else {
    structures.box(keep.x, keep.y + 0.5, keep.z, 1.05, 1, 0.85, STONE);
    structures.box(keep.x, keep.y + 0.22, keep.z + 0.44, 0.28, 0.45, 0.05, DARK_WOOD);
    for (const dx of [-0.44, 0.44]) for (const dz of [-0.35, 0.35]) {
      structures.box(keep.x + dx, keep.y + 0.7, keep.z + dz, 0.32, 1.4, 0.32, STONE);
      for (const x of [-0.1, 0.1]) for (const z of [-0.1, 0.1]) structures.box(keep.x + dx + x, keep.y + 1.5, keep.z + dz + z, 0.12, 0.2, 0.12, '#ded5bd');
    }
    rescaleParts(structures.parts, keepParts, keep, buildingScale);
    structureBounds.push(partBounds(structures.parts.slice(keepParts)));
    landmarks.push({ label: 'K', kind: 'keep', position: keep.clone().add(new Vector3(0, 1.85, 0)) });
  }
  terrain.spawns.forEach(([col, row], i) => {
    const g = positions[row * terrain.cols + col];
    const gateParts = structures.parts.length;
    const gatePrefab = library?.instantiate(`gate/level-${level}`);
    if (gatePrefab) {
      gatePrefab.name = `Gate ${i + 1} level ${level}`;
      gatePrefab.scale.multiplyScalar(buildingScale);
      gatePrefab.position.copy(g);
      prepareStaticPrefab(gatePrefab, root, { col, row }, true);
      structuresPrefabs.push(gatePrefab);
      const bounds = new Box3().setFromObject(gatePrefab);
      structureBounds.push(bounds);
      const label = g.clone(); label.y = bounds.max.y + 0.1;
      landmarks.push({ label: terrain.spawns.length > 1 ? `G${i + 1}` : 'G', kind: 'gate', position: label });
    } else {
      for (const dz of [-0.37, 0.37]) structures.box(g.x, g.y + 0.43, g.z + dz, 0.3, 0.86, 0.26, STONE);
      structures.box(g.x, g.y + 0.89, g.z, 0.3, 0.18, 1, STONE);
      rescaleParts(structures.parts, gateParts, g, buildingScale);
      structureBounds.push(partBounds(structures.parts.slice(gateParts)));
      landmarks.push({ label: terrain.spawns.length > 1 ? `G${i + 1}` : 'G', kind: 'gate', position: g.clone().add(new Vector3(0, 1.2, 0)) });
    }
  });

  const ground = buildTerrainGround(terrain, terrainLook);
  ground.scale.y = 1 / proportions.tile;
  const defenses = structures.mesh();
  defenses.name = 'Static structure pick container';
  for (const prefab of structuresPrefabs) defenses.add(prefab);
  writeOccluderMask(ground.material as MeshStandardMaterial, false);
  writeOccluderMask(defenses.material as MeshStandardMaterial, true);
  ground.receiveShadow = true;
  defenses.castShadow = true;
  defenses.receiveShadow = true;
  features.forEach(({ mesh }) => { mesh.castShadow = true; mesh.receiveShadow = true; });
  root.add(ground, defenses);
  const tiles = new InstancedMesh(new CylinderGeometry(0.985, 0.985, 1, 6), new MeshStandardMaterial(), positions.length);
  const matrix = new Matrix4();
  positions.forEach((position, i) => {
    const h = position.y + 0.14;
    matrix.makeScale(1, h, 1).setPosition(position.x, position.y - h / 2, position.z);
    tiles.setMatrixAt(i, matrix);
  });
  tiles.visible = false; // Raycasting uses the original tile IDs; the visible surface is the voxel raster.
  root.add(tiles);
  const points = Array.from({ length: 6 }, (_, i) => new Vector3(Math.sin(i * Math.PI / 3), 0.03, Math.cos(i * Math.PI / 3)));
  const highlight = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: '#fff2a0' }));
  highlight.visible = false;
  root.add(highlight);
  const bounds = new Box3().setFromObject(root);
  return { root, tiles, bounds, landmarks, highlight, features, structureBounds, structures: defenses, decorations };
}
