import { readFileSync } from 'node:fs';
import { Box3, Group, Mesh, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { disposeTerrain } from '../src/camera-preview/terrain';
import { ARCHER_TOWER_STATES, LEGACY_STATIC_LIBRARY, PROOF_ARCHER_LIBRARY } from '../src/render3d/proof-catalog';
import { RuntimeModelRegistry, type ModelLoader } from '../src/render3d/model-registry';
import { ContentAssetLibrary } from '../src/render3d/asset-library';
import { LiveTowers } from '../src/render3d/towers';
import { createDensityFixture } from '../src/camera-preview/fixture';
import { BASE_SCENE, ROOMIER_SCENE } from '../src/render3d/scene-proportions';

const parseGlb = async (path: string): Promise<GLTF> => {
  const bytes = readFileSync(path);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
};

function component(root: Group, id: string): Group[] {
  const results: Group[] = [];
  root.traverse(object => { if (object.userData.component_id === id) results.push(object as Group); });
  return results;
}

function structureSignature(mesh: Mesh): string {
  const position = mesh.geometry.getAttribute('position');
  const box = new Box3().setFromObject(mesh);
  const size = box.getSize(new Vector3());
  const points: string[] = [];
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    points.push([
      Math.round((point.x - box.min.x) / size.x * 10_000),
      Math.round((point.y - box.min.y) / size.y * 10_000),
      Math.round((point.z - box.min.z) / size.z * 10_000),
    ].join(','));
  }
  points.sort();
  return `${position.count}|${points.join(';')}`;
}

async function proofGLTF(): Promise<GLTF> {
  return parseGlb(new URL('../assets-src/rework/proof/archers/archers.glb', import.meta.url).pathname);
}

describe('native archer proof export', () => {
  it.each([BASE_SCENE, ROOMIER_SCENE])('seats actual animated crew on all seven decks with scene proportions %o', async (proportions) => {
    const [proof, crew] = await Promise.all([proofGLTF(), parseGlb(new URL('../assets-src/rework/refined/characters/archer-crew.glb', import.meta.url).pathname)]);
    const library = new ContentAssetLibrary(proof.scene);
    const { run, routes } = createDensityFixture('highlands', 5, 7, true);
    expect(routes.every(route => route.length > 1)).toBe(true);
    expect(run.towers.map(tower => tower.fork ? `tower/archer/fork-${tower.fork}-${tower.forkTier}` : `tower/archer/tier-${tower.tier}`)).toEqual(ARCHER_TOWER_STATES);
    const towers = new LiveTowers(new Group(), proportions);
    towers.setLibrary(library); towers.setCrewTemplate(crew);
    for (const tower of run.towers) tower.fired = 999;
    towers.update(run.towers, run.terrain, 0);
    try {
      expect([...towers.visuals.values()].map(visual => visual.crew.length)).toEqual([1, 1, 1, 1, 1, 2, 3]);
      for (const visual of towers.visuals.values()) for (const character of visual.crew) {
        const socket = character.root.parent!;
        const deckY = socket.getWorldPosition(new Vector3()).y;
        const height = (socket.userData.presentation_height as number) * proportions.buildings / proportions.tile;
        for (const time of [0, .4, 1.3]) {
          character.setClip(time ? 'Attack1' : 'Idle');
          character.update(time, new Vector3(), 0);
          visual.root.updateMatrixWorld(true);
          const bounds = new Box3();
          character.root.traverse(object => {
            if (!(object instanceof SkinnedMesh) || object.name === 'Hidden imported mob silhouette') return;
            for (let i = 0; i < object.geometry.getAttribute('position').count; i++) bounds.expandByPoint(object.getVertexPosition(i, new Vector3()).applyMatrix4(object.matrixWorld));
          });
          expect(bounds.min.y, `${visual.root.name} crew feet`).toBeGreaterThan(deckY-height*.1);
          expect(bounds.min.y).toBeLessThan(deckY+height*.1);
          expect(bounds.getSize(new Vector3()).y).toBeGreaterThan(height*.85);
          expect(bounds.getSize(new Vector3()).y).toBeLessThan(height*1.15);
        }
      }
    } finally { towers.reset(); library.dispose(); disposeTerrain(crew.scene, true); }
  });
  it('contains seven unique, bounded roofless tower states with valid structure and socket anchors', async () => {
    const gltf = await proofGLTF();
    const roots = gltf.scene.children.filter(object => object.userData.asset_id) as Group[];
    const ids = roots.map(root => root.userData.asset_id as string);
    expect(ids).toEqual(ARCHER_TOWER_STATES);
    expect(new Set(ids).size).toBe(7);
    expect(ARCHER_TOWER_STATES).toEqual([
      'tower/archer/tier-1', 'tower/archer/tier-2', 'tower/archer/tier-3',
      'tower/archer/fork-a-1', 'tower/archer/fork-a-2', 'tower/archer/fork-b-1', 'tower/archer/fork-b-2',
    ]);
    gltf.scene.updateMatrixWorld(true);

    const expectedCrew = [1, 1, 1, 1, 1, 2, 3];
    const signatures = new Set<string>();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const structures = component(root, 'structure').filter(object => object instanceof Mesh) as Mesh[];
      const feet = component(root, 'feet') as Group[];
      const aim = component(root, 'aim') as Group[];
      const muzzle = component(root, 'muzzle') as Group[];
      const crew = root.children.filter(child => child.userData.character_id === 'archer-crew') as Group[];
      expect(structures, `${ids[i]} structure component`).toHaveLength(1);
      expect(feet, `${ids[i]} feet anchor`).toHaveLength(1);
      expect(aim, `${ids[i]} aim anchor`).toHaveLength(1);
      expect(muzzle, `${ids[i]} muzzle anchor`).toHaveLength(1);
      expect(crew, `${ids[i]} crew sockets`).toHaveLength(expectedCrew[i]);

      const structure = structures[0];
      const position = structure.geometry.getAttribute('position');
      const triangleCount = (structure.geometry.index?.count ?? position.count) / 3;
      expect(position.count).toBeGreaterThan(0);
      expect(triangleCount).toBeGreaterThan(0);
      for (const attribute of Object.values(structure.geometry.attributes)) {
        const values = attribute.array as ArrayLike<number>;
        for (let j = 0; j < values.length; j++) expect(Number.isFinite(values[j]), `${ids[i]} finite ${attribute.name}`).toBe(true);
      }

      const bounds = new Box3().setFromObject(structure);
      const size = bounds.getSize(new Vector3());
      expect(size.x).toBeGreaterThan(0.2); expect(size.y).toBeGreaterThan(0.2); expect(size.z).toBeGreaterThan(0.2);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-0.8); expect(bounds.max.x).toBeLessThanOrEqual(0.8);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-0.8); expect(bounds.max.z).toBeLessThanOrEqual(0.8);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-5);
      expect(bounds.max.y).toBeLessThan(3);

      const feetPosition = feet[0].getWorldPosition(new Vector3());
      const aimPosition = aim[0].getWorldPosition(new Vector3());
      const muzzlePosition = muzzle[0].getWorldPosition(new Vector3());
      expect(feetPosition.y).toBeCloseTo(0, 5);
      expect(aimPosition.y).toBeGreaterThan(0.3); expect(aimPosition.y).toBeLessThan(3.2);
      expect(muzzlePosition.y).toBeGreaterThanOrEqual(0.3); expect(muzzlePosition.y).toBeLessThanOrEqual(3.2);
      for (const socket of crew) {
        expect(socket.userData.presentation_height).toBeGreaterThan(0);
        const p = socket.getWorldPosition(new Vector3());
        expect(p.y).toBeGreaterThan(feetPosition.y);
      }

      const roofNodes: string[] = [];
      root.traverse(object => {
        const name = `${object.name} ${String(object.userData.component_id ?? '')}`;
        if (/roof|cover/i.test(name)) roofNodes.push(name);
      });
      expect(roofNodes, `${ids[i]} has no separately authored roof component`).toEqual([]);

      const signature = structureSignature(structure);
      expect(signatures.has(signature), `${ids[i]} has a distinct normalized vertex distribution`).toBe(false);
      signatures.add(signature);
    }
    expect(signatures.size).toBe(7);
    disposeTerrain(gltf.scene, true);
  });

  it('keeps seven prefab IDs and duplicate component sockets named and positioned through the merged content-library path', async () => {
    const [legacy, proof] = await Promise.all([
      parseGlb(new URL('../assets-src/models/library/library.glb', import.meta.url).pathname),
      proofGLTF(),
    ]);
    const loader: ModelLoader = {
      loadAsync: async url => url === LEGACY_STATIC_LIBRARY ? legacy : url === PROOF_ARCHER_LIBRARY ? proof : Promise.reject(new Error(`Unexpected URL: ${url}`)),
    };
    const registry = new RuntimeModelRegistry({ loader });
    try {
      const library = await registry.loadStaticLibrary();
      for (const id of ARCHER_TOWER_STATES) {
        const prefab = library.instantiate(id);
        expect(prefab, `${id} is registered`).not.toBeNull();
        expect(prefab!.name).toBe(id);
        const source = proof.scene.children.find(object => object.userData.asset_id === id) as Group;
        source.updateMatrixWorld(true); prefab!.updateMatrixWorld(true);
        const expectedCrew = source.children.filter(child => child.userData.character_id === 'archer-crew');
        const actualCrew = prefab!.children.filter(child => child.userData.character_id === 'archer-crew');
        expect(actualCrew).toHaveLength(expectedCrew.length);
        for (const componentId of ['feet', 'aim', 'muzzle']) {
          const sourceSocket = source.children.find(child => child.userData.component_id === componentId)!;
          const instanceSocket = prefab!.children.find(child => child.name === componentId)!;
          expect(instanceSocket).toBeDefined();
          expect(instanceSocket.name).toBe(componentId);
          expect(instanceSocket.getWorldPosition(new Vector3()).distanceTo(sourceSocket.getWorldPosition(new Vector3()))).toBeLessThan(1e-6);
        }
        const crewIds = actualCrew.map(socket => socket.name);
        expect(new Set(crewIds).size).toBe(expectedCrew.length);
        for (const socket of actualCrew) expect(socket.name).toBe(socket.userData.component_id);
      }
    } finally {
      registry.dispose();
    }
  });
});
