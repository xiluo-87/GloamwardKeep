import { MeshStandardMaterial, type InstancedMesh } from 'three';
import { WORLD } from '../data/balance';
import { boardHeight, boardWidth, pixelToTile } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';
import { hashCell } from '../sim/rng';
import { groundHeightAt, SURFACE_CELL } from './surface';
import { Painter } from './voxel-model';

export type TerrainLook = 'artwork' | 'blockout';
export const TERRAIN_CELL = SURFACE_CELL;
const EARLIER_TOPS = ['#d2b77d', '#87a45c', '#708c53', '#969687', '#d9ded2'];
const EARLIER_SIDES = ['#a58d60', '#776e55', '#73715e', '#777a70', '#969d92'];
// A comparison palette based on the first concept; these are not final production colours.
const TOPS = ['#bf9b59', '#6b8729', '#5e7e27', '#818b8e', '#dce5e8'];
const SOIL = '#815a3d', STONE = '#737c82';

/** World-aligned cube seams and quiet per-block variation, without splitting every flat run. */
function defineVoxels(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 terrainPoint = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          terrainPoint = instanceMatrix * terrainPoint;
        #endif
        vTerrainWorld = (modelMatrix * terrainPoint).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 terrainNormal = abs(normalize(cross(dFdx(vTerrainWorld), dFdy(vTerrainWorld))));
        vec2 terrainPlane = terrainNormal.y > 0.5 ? vTerrainWorld.xz
          : terrainNormal.x > 0.5 ? vTerrainWorld.zy : vTerrainWorld.xy;
        vec2 terrainGrid = terrainPlane / ${TERRAIN_CELL.toFixed(2)};
        vec2 terrainUv = fract(terrainGrid);
        vec2 terrainEdge = min(terrainUv, 1.0 - terrainUv);
        float terrainPixel = max(fwidth(terrainGrid.x), fwidth(terrainGrid.y));
        float terrainDetail = 1.0 - smoothstep(0.18, 0.65, terrainPixel);
        float terrainSeam = 1.0 - smoothstep(0.012, 0.025 + terrainPixel * 0.45, min(terrainEdge.x, terrainEdge.y));
        vec3 terrainHash = fract(vec3(floor(terrainGrid + 0.0001), 13.0) * vec3(0.1031, 0.1030, 0.0973));
        terrainHash += dot(terrainHash, terrainHash.yxz + 33.33);
        float terrainTone = fract((terrainHash.x + terrainHash.y) * terrainHash.z);
        diffuseColor.rgb *= mix(1.0, mix(0.93, 1.055, terrainTone), terrainDetail);
        diffuseColor.rgb *= 1.0 - terrainSeam * terrainDetail * 0.15;`);
  };
  material.customProgramCacheKey = () => 'terrain-cube-definition-v1';
}

/** Rasterise the real hex footprint; surface tops stay at the simulation's visual elevation. */
export function buildTerrainGround(terrain: Terrain, look: TerrainLook = 'artwork'): InstancedMesh {
  const p = new Painter();
  const cell = SURFACE_CELL;
  const width = boardWidth(terrain.cols) / WORLD.hex;
  const depth = boardHeight(terrain.rows) / WORLD.hex;
  const nx = Math.ceil(width / cell);
  const nz = Math.ceil(depth / cell);
  const cellLevels = new Int8Array(nx * nz).fill(-1);
  const cellTops = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    const z = (iz + 0.5) * cell;
    let start = 0;
    let level = -1;
    let top = 0;
    const flush = (end: number): void => {
      if (level < 0 || end <= start) return;
      // Overlap runs microscopically so Float32 instance positions cannot open hairline cracks.
      const w = (end - start) * cell + 0.00001;
      const d = cell + 0.00001;
      const x = (start + end) * cell / 2;
      if (look === 'blockout') {
        p.box(x, top - 0.035, z, w, 0.07, d, EARLIER_TOPS[level]);
        const h = top + 0.07;
        p.box(x, -0.14 + h / 2, z, w, h, d, EARLIER_SIDES[level]);
        return;
      }
      p.box(x, top - cell / 2, z, w, cell, d, TOPS[level]);
      if (!level) return;
      const soil = level <= 2;
      if (soil) p.box(x, top - cell * 1.5, z, w, cell, d, SOIL);
      const bottom = -cell;
      const upper = top - cell * (soil ? 2 : 1);
      if (upper > bottom) p.box(x, (upper + bottom) / 2, z, w, upper - bottom, d, level === 1 ? SOIL : STONE);
    };
    for (let ix = 0; ix <= nx; ix++) {
      const x = (ix + 0.5) * cell;
      const tile = ix < nx ? pixelToTile(x * WORLD.hex, z * WORLD.hex, terrain.cols, terrain.rows) : null;
      const next = tile ? terrain.height[tile.row * terrain.cols + tile.col] : -1;
      const nextTop = tile ? groundHeightAt(terrain, x, z) : 0;
      if (ix < nx && tile) {
        cellLevels[iz * nx + ix] = next;
        cellTops[iz * nx + ix] = nextTop;
      }
      if (next !== level || Math.round(nextTop * 100000) !== Math.round(top * 100000)) {
        flush(ix);
        start = ix;
        level = next;
        top = nextTop;
      }
    }
  }
  if (look === 'artwork') {
    const ledgeH = 0.055;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const at = iz * nx + ix;
      const level = cellLevels[at];
      if (level < 1) continue;
      const highTop = cellTops[at];
      for (const [dx, dz] of directions) {
        const xx = ix + dx, zz = iz + dz;
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
        const neighbor = zz * nx + xx;
        const lowLevel = cellLevels[neighbor];
        const drop = highTop - cellTops[neighbor];
        if (lowLevel < 0 || lowLevel >= level || drop < 0.19 || hashCell(terrain.seed, at, neighbor) > 0.42) continue;
        const highX = (ix + 0.5) * cell, highZ = (iz + 0.5) * cell;
        const lowTop = cellTops[neighbor];
        const centerY = lowTop + ledgeH / 2;
        const ledgeX = highX + dx * cell * 0.54, ledgeZ = highZ + dz * cell * 0.54;
        const ledgeW = dx ? 0.12 : 0.18, ledgeD = dz ? 0.12 : 0.18;
        p.box(ledgeX, centerY, ledgeZ, ledgeW, ledgeH, ledgeD, level >= 3 ? STONE : SOIL);
      }
    }
  }
  const mesh = p.mesh();
  mesh.name = 'Voxel terrain';
  if (look === 'artwork') defineVoxels(mesh.material as MeshStandardMaterial);
  return mesh;
}
