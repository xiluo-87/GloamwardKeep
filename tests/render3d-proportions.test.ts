import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildVoxelEnvironment } from '../src/camera-preview/environment';
import { disposeTerrain, tilePosition } from '../src/camera-preview/terrain';
import { BASE_SCENE, ROOMIER_SCENE } from '../src/render3d/scene-proportions';
import { ContentAssetLibrary } from '../src/render3d/asset-library';
import { DECORATION } from '../src/sim/decorations';
import { FEATURE, generateMap } from '../src/sim/mapgen';
import { GameCamera3D } from '../src/render3d/camera';

function sceneForEnvironment() {
  const root = new Group();
  const ids = [
    'keep/level-1', 'gate/level-1',
    ...[1, 2, 3].flatMap(sample => [`nature/forest/sample-${sample}`, `nature/rocks/sample-${sample}`]),
  ];
  for (const id of ids) {
    const prefab = new Group();
    prefab.name = id;
    prefab.add(new Mesh(new BoxGeometry(0.72, 1.1, 0.64), new MeshStandardMaterial()));
    root.add(prefab);
  }
  return root;
}

function closeTransformedBounds(base: { min: Vector3; max: Vector3 },
                                actual: { min: Vector3; max: Vector3 },
                                baseAnchor: Vector3, actualAnchor: Vector3, ratio: number): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(actual.min[axis]).toBeCloseTo(actualAnchor[axis] + (base.min[axis] - baseAnchor[axis]) * ratio, 5);
    expect(actual.max[axis]).toBeCloseTo(actualAnchor[axis] + (base.max[axis] - baseAnchor[axis]) * ratio, 5);
  }
}

function decorationMesh(environment: ReturnType<typeof buildVoxelEnvironment>): InstancedMesh {
  const mesh = environment.decorations.root.getObjectByName('Small map decoration instances');
  if (!(mesh instanceof InstancedMesh)) throw new Error('Expected a decoration instance mesh');
  return mesh;
}

describe('roomier scene proportions', () => {
  it('projects and picks the lowered raised-tile surface consistently before and after pointer zoom', () => {
    const terrain = generateMap('highlands', 5);
    const environment = buildVoxelEnvironment(terrain, 'artwork', null, 1, ROOMIER_SCENE);
    const camera = new GameCamera3D(0, 1, ROOMIER_SCENE);
    camera.layout(1100, 800);
    camera.setTerrain(terrain, environment.bounds);
    let checked = false;
    try {
      for (let index = 0; index < terrain.height.length; index++) {
        if (!terrain.height[index]) continue;
        const col=index%terrain.cols, row=Math.floor(index/terrain.cols);
        const screen=camera.tileToScreen(col,row);
        const picked=camera.screenToTile(screen.x,screen.y,environment.tiles);
        if (picked?.col!==col || picked.row!==row) continue;
        const ray=new Raycaster();
        ray.setFromCamera(new Vector2(screen.x/1100*2-1,1-screen.y/800*2),camera.camera);
        const hit=ray.intersectObject(environment.tiles,false)[0];
        const expected=tilePosition(terrain,index); expected.y/=ROOMIER_SCENE.tile;
        expect(hit.point.distanceTo(expected)).toBeLessThan(1e-5);
        camera.zoomAt(screen.x,screen.y,1.8,environment.tiles);
        expect(camera.screenToTile(screen.x,screen.y,environment.tiles)).toEqual({col,row});
        checked=true; break;
      }
      expect(checked).toBe(true);
    } finally { disposeTerrain(environment.root); }
  });
  it('keeps default geometry unchanged and scales nature/buildings around their tile anchors', () => {
    const terrain = generateMap('highlands', 27);
    const defaultLibrary = new ContentAssetLibrary(sceneForEnvironment());
    const explicitLibrary = new ContentAssetLibrary(sceneForEnvironment());
    const roomierLibrary = new ContentAssetLibrary(sceneForEnvironment());
    const defaultEnvironment = buildVoxelEnvironment(terrain, 'artwork', defaultLibrary);
    const explicitEnvironment = buildVoxelEnvironment(terrain, 'artwork', explicitLibrary, 1, BASE_SCENE);
    const roomierEnvironment = buildVoxelEnvironment(terrain, 'artwork', roomierLibrary, 1, ROOMIER_SCENE);

    expect(explicitEnvironment.bounds.min.toArray()).toEqual(defaultEnvironment.bounds.min.toArray());
    expect(explicitEnvironment.bounds.max.toArray()).toEqual(defaultEnvironment.bounds.max.toArray());
    expect(explicitEnvironment.structureBounds.map(bounds => [bounds.min.toArray(), bounds.max.toArray()]))
      .toEqual(defaultEnvironment.structureBounds.map(bounds => [bounds.min.toArray(), bounds.max.toArray()]));

    const buildingRatio = ROOMIER_SCENE.buildings / ROOMIER_SCENE.tile;
    for (let index = 0; index < defaultEnvironment.structureBounds.length; index++) {
      const tile = index === 0
        ? terrain.goal[1] * terrain.cols + terrain.goal[0]
        : terrain.spawns[index - 1][1] * terrain.cols + terrain.spawns[index - 1][0];
      const baseAnchor = tilePosition(terrain, tile);
      const roomierAnchor = baseAnchor.clone();
      roomierAnchor.y /= ROOMIER_SCENE.tile;
      closeTransformedBounds(defaultEnvironment.structureBounds[index], roomierEnvironment.structureBounds[index],
        baseAnchor, roomierAnchor, buildingRatio);
    }

    const vegetationRatio = ROOMIER_SCENE.vegetation / ROOMIER_SCENE.tile;
    expect(roomierEnvironment.features).toHaveLength(defaultEnvironment.features.length);
    for (let index = 0; index < defaultEnvironment.features.length; index++) {
      const base = defaultEnvironment.features[index];
      const roomy = roomierEnvironment.features[index];
      const tile = Number((base.mesh.name.match(/tile (\d+)$/)
        ?? base.mesh.parent?.name.match(/tile (\d+)$/))?.[1]);
      expect(roomy.mesh.name).toBe(base.mesh.name);
      const baseAnchor = tilePosition(terrain, tile);
      const roomierAnchor = baseAnchor.clone();
      roomierAnchor.y /= ROOMIER_SCENE.tile;
      closeTransformedBounds(base.bounds, roomy.bounds, baseAnchor, roomierAnchor, vegetationRatio);
    }

    const baseGround = defaultEnvironment.root.getObjectByName('Voxel terrain') as Mesh;
    const roomierGround = roomierEnvironment.root.getObjectByName('Voxel terrain') as Mesh;
    const baseGroundBounds = new Box3().setFromObject(baseGround);
    const roomierGroundBounds = new Box3().setFromObject(roomierGround);
    expect(roomierGround.scale.y).toBeCloseTo(1 / ROOMIER_SCENE.tile, 8);
    expect(roomierGroundBounds.max.y).toBeCloseTo(baseGroundBounds.max.y / ROOMIER_SCENE.tile, 5);

    disposeTerrain(defaultEnvironment.root);
    disposeTerrain(explicitEnvironment.root);
    disposeTerrain(roomierEnvironment.root);
    defaultLibrary.dispose();
    explicitLibrary.dispose();
    roomierLibrary.dispose();
  });

  it.each([DECORATION.bush, DECORATION.stones])('scales small tile dressing %s around the surface anchor', (kind) => {
    const terrain = generateMap('meadow', 19);
    const index = terrain.height.findIndex((height, tile) => height > 0
      && terrain.feature[tile] === FEATURE.none
      && tile !== terrain.goal[1] * terrain.cols + terrain.goal[0]
      && !terrain.spawns.some(([col, row]) => row * terrain.cols + col === tile));
    expect(index).toBeGreaterThanOrEqual(0);
    terrain.decoration.fill(DECORATION.none);
    terrain.decoration[index] = kind;
    const defaultEnvironment = buildVoxelEnvironment(terrain);
    const roomierEnvironment = buildVoxelEnvironment(terrain, 'artwork', null, 1, ROOMIER_SCENE);
    const base = decorationMesh(defaultEnvironment);
    const roomy = decorationMesh(roomierEnvironment);
    expect(roomy.count).toBe(base.count);
    const anchor = tilePosition(terrain, index);
    const roomierAnchor = anchor.clone();
    roomierAnchor.y /= ROOMIER_SCENE.tile;
    const vegetationRatio = ROOMIER_SCENE.vegetation / ROOMIER_SCENE.tile;
    const baseMatrix = base.getMatrixAt(0, new Matrix4());
    const roomyMatrix = roomy.getMatrixAt(0, new Matrix4());
    const basePosition = new Vector3(), baseQuaternion = new Quaternion(), baseScale = new Vector3();
    const roomyPosition = new Vector3(), roomyQuaternion = new Quaternion(), roomyScale = new Vector3();
    baseMatrix.decompose(basePosition, baseQuaternion, baseScale);
    roomyMatrix.decompose(roomyPosition, roomyQuaternion, roomyScale);
    expect(roomyScale.x).toBeCloseTo(baseScale.x * vegetationRatio, 5);
    expect(roomyScale.y).toBeCloseTo(baseScale.y * vegetationRatio, 5);
    expect(roomyScale.z).toBeCloseTo(baseScale.z * vegetationRatio, 5);
    expect(roomyPosition.x).toBeCloseTo(anchor.x + (basePosition.x - anchor.x) * vegetationRatio, 5);
    expect(roomyPosition.y).toBeCloseTo(roomierAnchor.y + (basePosition.y - anchor.y) * vegetationRatio, 5);
    expect(roomyPosition.z).toBeCloseTo(anchor.z + (basePosition.z - anchor.z) * vegetationRatio, 5);
    disposeTerrain(defaultEnvironment.root);
    disposeTerrain(roomierEnvironment.root);
  });
});
