import { Box3, Group, InstancedMesh, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { exportContentLibrary, paintHeroModel, paintKeepUpgrade, paintTowerModel } from '../src/camera-preview/tower-models';
import { Painter } from '../src/camera-preview/voxel-model';
import { paintStudyTower } from '../src/camera-preview/voxel-study';
import { HERO_IDS, TOWER_IDS } from '../src/data/balance';
import { buildTowerVisual, LiveTowers } from '../src/render3d/towers';
import { build } from '../src/sim/actions';
import { createRun } from '../src/sim/state';
import { freeTiles } from './helpers';

const states = [
  { tier: 1, fork: 0 as const, forkTier: 0 },
  { tier: 2, fork: 0 as const, forkTier: 0 },
  { tier: 3, fork: 0 as const, forkTier: 0 },
  { tier: 3, fork: 'a' as const, forkTier: 1 },
  { tier: 3, fork: 'a' as const, forkTier: 2 },
  { tier: 3, fork: 'b' as const, forkTier: 1 },
  { tier: 3, fork: 'b' as const, forkTier: 2 },
];

describe('procedural live content', () => {
  it('exports all 56 tower progression states with finite bounded parameter variants', () => {
    for (const type of TOWER_IDS) {
      const signatures = new Set<string>();
      for (const stage of states) {
        const painter = new Painter();
        paintTowerModel(painter, { type, ...stage }, new Vector3());
        expect(painter.parts.length).toBeGreaterThan(0);
        expect(painter.parts.every(part => [part.x, part.y, part.z, part.w, part.h, part.d].every(Number.isFinite)
          && part.w > 0 && part.h > 0 && part.d > 0)).toBe(true);
        const bounds = new Box3();
        for (const part of painter.parts) {
          bounds.expandByPoint(new Vector3(part.x - part.w / 2, part.y - part.h / 2, part.z - part.d / 2));
          bounds.expandByPoint(new Vector3(part.x + part.w / 2, part.y + part.h / 2, part.z + part.d / 2));
        }
        expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThanOrEqual(0.7);
        signatures.add(JSON.stringify(painter.parts));
      }
      expect(signatures.size, `${type} progression states should have different parameter data`).toBe(7);
    }
  });

  it('uses the current prefab source geometry in every density-study tower state', () => {
    const exported = new Map(exportContentLibrary().map(entry => [entry.id, entry]));
    for (const type of TOWER_IDS) for (const stage of states) {
      const id = stage.fork ? `tower/${type}/fork-${stage.fork}-${stage.forkTier}` : `tower/${type}/tier-${stage.tier}`;
      const entry = exported.get(id)!;
      const study = new Painter();
      paintStudyTower(study, { type, ...stage, heroLevel: 1, skills: [] }, new Vector3());
      expect(study.parts, id).toEqual([...entry.parts, ...(entry.attachments ?? []).flatMap(part => part.parts)]);
    }
  });

  it('provides five hero parameter sets with branch/level markers', () => {
    const silhouettes = new Set<string>();
    for (const type of HERO_IDS) {
      const painter = new Painter();
      paintHeroModel(painter, { type, heroLevel: 1, skills: [] }, new Vector3());
      expect(painter.parts.length).toBeGreaterThanOrEqual(7);
      silhouettes.add(JSON.stringify(painter.parts));
    }
    expect(silhouettes.size).toBe(5);
    const fresh = new Painter(), learned = new Painter();
    paintHeroModel(fresh, { type: 'ranger', heroLevel: 1, skills: [] }, new Vector3());
    paintHeroModel(learned, { type: 'ranger', heroLevel: 4, skills: [0, 5, 9] }, new Vector3());
    expect(JSON.stringify(learned.parts)).not.toBe(JSON.stringify(fresh.parts));
  });

  it('exports four keep parameter variants', () => {
    const signatures = new Set<string>();
    for (const level of [1, 2, 3, 4] as const) {
      const painter = new Painter();
      paintKeepUpgrade(painter, level, new Vector3());
      signatures.add(JSON.stringify(painter.parts));
    }
    expect(signatures.size).toBe(4);
  });

  it('exports deterministic named base and aiming parts for the Blender library', () => {
    const first = exportContentLibrary();
    const second = exportContentLibrary();
    expect(first).toEqual(second);
    expect(new Set(first.map(entry => entry.id)).size).toBe(first.length);
    const manifest = JSON.parse(readFileSync(new URL('../assets-src/content-manifest.json', import.meta.url), 'utf8')) as {
      towers: Record<string, { states: string[] }>;
      heroes: { ids: string[]; statesPerHero: string[] };
      keep: { levels: number[] };
      assets: unknown[];
    };
    expect(manifest.assets).toEqual(first);
    const ids = new Set(first.map(entry => entry.id));
    for (const type of TOWER_IDS) {
      expect(manifest.towers[type].states).toHaveLength(7);
      for (const id of manifest.towers[type].states) expect(ids.has(id)).toBe(true);
    }
    for (const type of manifest.heroes.ids) for (const state of manifest.heroes.statesPerHero) expect(ids.has(`hero/${type}/${state}`)).toBe(true);
    for (const level of manifest.keep.levels) expect(ids.has(`keep/level-${level}`)).toBe(true);
    const archer = first.find(entry => entry.id === 'tower/archer/tier-1')!;
    expect(archer.parts).toBeDefined();
    expect(archer.attachments?.map(attachment => attachment.id)).toEqual(['aim-bowman']);
  });

  it('keeps tower materials opaque and masked, with the roofless archer figure independently aimable and pickable', () => {
    const archer = buildTowerVisual({ type: 'archer', tier: 1, fork: 0, forkTier: 0, heroLevel: 1, skills: [] });
    expect(archer.bowman).not.toBeNull();
    archer.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
      expect(material.stencilWrite).toBe(true);
      expect(material.stencilRef).toBe(1);
    });

    const run = createRun({ seed: 3, map: 'meadow', mapSeed: 8, heroes: [], perks: [] });
    run.gold = 10000;
    const [col, row] = freeTiles(run, () => true)[0];
    const tower = build(run, 'archer', col, row);
    if (!tower) throw new Error('Expected test archer to build.');
    const root = new Group();
    const live = new LiveTowers(root);
    live.update(run.towers, run.terrain);
    const visual = live.visuals.get(tower.uid)!;
    expect(visual.root.userData.tile).toEqual({ col, row });
    const before = visual.bowman!.rotation.y;
    tower.angle = 0.7;
    live.update(run.towers, run.terrain);
    expect(visual.bowman!.rotation.y).not.toBe(before);

    const disposedGeometry = vi.fn();
    const disposedMaterial = vi.fn();
    visual.root.traverse(object => {
      if (!(object instanceof InstancedMesh)) return;
      object.geometry.addEventListener('dispose', disposedGeometry);
      const material = object.material as MeshStandardMaterial;
      material.addEventListener('dispose', disposedMaterial);
    });
    live.reset();
    expect(disposedGeometry).toHaveBeenCalled();
    expect(disposedMaterial).toHaveBeenCalled();
    expect(live.visuals.size).toBe(0);
  });
});
