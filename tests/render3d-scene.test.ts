import { Group, InstancedMesh, LineSegments, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RUN, STEP, WORLD } from '../src/data/balance';
import { LiveEffects } from '../src/render3d/effects';
import { groundPoint, muzzleHeight, projectilePoint } from '../src/render3d/mapping';
import { LiveOverlays } from '../src/render3d/overlays';
import { LiveTowers } from '../src/render3d/towers';
import { build, sell, upgrade, useAbility } from '../src/sim/actions';
import { spawnAtGate } from '../src/sim/combat';
import { tileCenter } from '../src/sim/hex';
import { nextTile, previewRoute } from '../src/sim/path';
import { createRun, type RunState } from '../src/sim/state';
import { stepRun } from '../src/sim/step';
import { defaultView } from '../src/render/view';
import { freeTiles } from './helpers';

function run(map: 'meadow' | 'highlands' | 'canyon' = 'meadow', mapSeed = 7, heroes: ('knight' | 'cleric' | 'sorcerer' | 'ranger' | 'druid')[] = []): RunState {
  const state = createRun({ seed: 10, map, mapSeed, heroes, perks: [] });
  state.gold = 10000;
  state.keep = 4;
  return state;
}

function nearbyFreePair(s: RunState): [[number, number], [number, number]] {
  const cells = freeTiles(s, () => true);
  let best: { a: [number, number]; b: [number, number]; distance: number } | undefined;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = tileCenter(...cells[i]), b = tileCenter(...cells[j]);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || distance < best.distance) best = { a: cells[i], b: cells[j], distance };
  }
  if (!best) throw new Error('The generated map needs two free tiles.');
  return [best.a, best.b];
}

function buildArcher(s: RunState, col: number, row: number) {
  const tower = build(s, 'archer', col, row);
  if (!tower) throw new Error(`Could not build archer at ${col},${row}.`);
  return tower;
}

function attachDisposalSpies(root: Group): ReturnType<typeof vi.fn> {
  const disposed = vi.fn();
  root.traverse(object => {
    if (object instanceof Mesh) object.geometry.addEventListener('dispose', disposed);
  });
  return disposed;
}

function towerRoots(parent: Group): Group[] {
  return parent.children.filter((child): child is Group => child instanceof Group);
}

describe('live render scene integration', () => {
  it.each([
    ['archer', 'bolt', 14],
    ['catapult', 'lob', 16],
  ] as const)('%s projectiles render from the tower and converge on the simulation target', (type, kind, legacyOffset) => {
    const s = run();
    const [col, row] = freeTiles(s, () => true)[0];
    const tower = type === 'archer' ? buildArcher(s, col, row) : build(s, type, col, row)!;
    const enemy = spawnAtGate(s, 'goblin', 0, 1)!;
    enemy.x = enemy.px = tower.x + 112;
    enemy.y = enemy.py = tower.y;
    enemy.stunT = 10;
    enemy.hp = enemy.maxHp = 100000;
    tower.cd = 0;

    stepRun(s);
    const p = s.projectiles.items[0];
    expect(s.projectiles.count).toBe(1);
    expect(p.kind).toBe(kind);
    expect(p.sy).toBe(tower.y - legacyOffset);
    const launched = projectilePoint(p, 0);
    const towerMuzzle = groundPoint(tower.x, tower.y, muzzleHeight(tower, s.terrain));
    const yaw = Math.PI / 2 - tower.angle;
    const barrelX = type === 'archer' ? 0.3 * Math.cos(yaw) + 0.56 * Math.sin(yaw) : 0;
    const barrelZ = type === 'archer' ? 0.56 * Math.cos(yaw) - 0.3 * Math.sin(yaw) : 0;
    const launchProgress = kind === 'lob' ? p.t / p.life : 0;
    expect(launched.x).toBeCloseTo(towerMuzzle.x + barrelX, 5);
    expect(launched.z).toBeCloseTo(towerMuzzle.z + barrelZ - legacyOffset * launchProgress / WORLD.hex, 5);
    expect(launched.z - p.py / WORLD.hex).toBeCloseTo(legacyOffset * (1 - launchProgress) / WORLD.hex + barrelZ, 5);

    if (kind === 'bolt') {
      let guard = 0;
      while (s.projectiles.count && Math.hypot(p.tx - p.x, p.ty - p.y) > 14 && guard++ < 30) stepRun(s);
      expect(s.projectiles.count).toBeGreaterThan(0);
    } else {
      let guard = 0;
      while (p.t + STEP < p.life && guard++ < 60) stepRun(s);
      expect(p.t).toBeLessThan(p.life);
    }
    const arriving = projectilePoint(p, 1);
    const target = groundPoint(p.tx, p.ty, kind === 'lob' ? 0.08 : 0.55);
    expect(Math.hypot(arriving.x - target.x, arriving.z - target.z)).toBeLessThan(0.65);
  });

  it('keeps archer aim on its separate bowman while the platform stays fixed', () => {
    const s = run();
    const [col, row] = freeTiles(s, () => true)[0];
    const tower = buildArcher(s, col, row);
    const parent = new Group();
    const towers = new LiveTowers(parent);
    towers.update(s.towers, s.terrain);
    const visual = towers.visuals.get(tower.uid)!;
    expect(visual.bowman).not.toBeNull();
    const platform = visual.root.children[0] as InstancedMesh;
    const platformMatrix = platform.instanceMatrix.array.slice();
    const oldAim = visual.bowman!.rotation.y;

    tower.angle = 0.73;
    towers.update(s.towers, s.terrain);

    expect(visual.bowman!.rotation.y).toBeCloseTo(Math.PI / 2 - tower.angle);
    expect(visual.bowman!.rotation.y).not.toBeCloseTo(oldAim);
    expect(visual.root.rotation.y).toBe(0);
    expect(Array.from(platform.instanceMatrix.array)).toEqual(Array.from(platformMatrix));
    towers.reset();
  });

  it('disposes replaced, sold, and reset tower roots', () => {
    const s = run();
    const [col, row] = freeTiles(s, () => true)[0];
    const tower = buildArcher(s, col, row);
    const parent = new Group();
    const towers = new LiveTowers(parent);
    towers.update(s.towers, s.terrain);
    const original = towers.visuals.get(tower.uid)!;
    const originalDisposed = attachDisposalSpies(original.root);

    expect(upgrade(s, tower.uid)).toBe(true);
    towers.update(s.towers, s.terrain);
    const upgraded = towers.visuals.get(tower.uid)!;
    expect(upgraded.root).not.toBe(original.root);
    expect(original.root.parent).toBeNull();
    expect(originalDisposed).toHaveBeenCalled();
    const upgradedDisposed = attachDisposalSpies(upgraded.root);

    expect(sell(s, tower.uid)).toBe(true);
    towers.update(s.towers, s.terrain);
    expect(towers.visuals.size).toBe(0);
    expect(towerRoots(parent)).toHaveLength(0);
    expect(upgraded.root.parent).toBeNull();
    expect(upgradedDisposed).toHaveBeenCalled();

    const replacement = buildArcher(s, col, row);
    towers.update(s.towers, s.terrain);
    const replacementVisual = towers.visuals.get(replacement.uid)!;
    const replacementDisposed = attachDisposalSpies(replacementVisual.root);
    towers.reset();
    expect(towerRoots(parent)).toHaveLength(0);
    expect(towers.visuals.size).toBe(0);
    expect(replacementDisposed).toHaveBeenCalled();
  });

  it('renders separated gate routes and replaces route geometry with a new run', () => {
    const first = run('meadow', 7);
    const view = defaultView();
    const overlays = new LiveOverlays();
    const route = overlays.root.children[3] as LineSegments;

    overlays.update(first, view);
    const goal = first.terrain.goal[1] * first.terrain.cols + first.terrain.goal[0];
    let expectedEdges = 0;
    for (const [col, row] of first.terrain.spawns) {
      let tile = row * first.terrain.cols + col;
      let length = 1;
      for (let guard = 0; tile !== goal && guard < first.flow.length; guard++) {
        tile = nextTile(first, tile);
        if (tile >= 0) length++;
      }
      expect(tile).toBe(goal);
      expectedEdges += length - 1;
    }
    const firstPositions = Array.from(route.geometry.getAttribute('position').array);
    expect(firstPositions.length).toBe(expectedEdges * 2 * 3);

    const replacement = run('canyon', 5);
    overlays.update(replacement, view);
    const replacementPositions = Array.from(route.geometry.getAttribute('position').array);
    expect(replacementPositions).not.toEqual(firstPositions);
    const replacementGoal = replacement.terrain.goal[1] * replacement.terrain.cols + replacement.terrain.goal[0];
    const concatenated = previewRoute(replacement, -1, -1).tiles;
    let separatedEdges = 0;
    for (let i = 1; i < concatenated.length; i++) if (concatenated[i - 1] !== replacementGoal) separatedEdges++;
    expect(replacementPositions.length).toBe(separatedEdges * 2 * 3);
    overlays.dispose();
  });

  it('tracks bounded projectile instances after pool swap removal without changing the run', () => {
    const s = run();
    const [a, b] = nearbyFreePair(s);
    const first = buildArcher(s, ...a);
    const second = buildArcher(s, ...b);
    const enemy = spawnAtGate(s, 'goblin', 0, 1)!;
    const ca = tileCenter(first.tx, first.ty), cb = tileCenter(second.tx, second.ty);
    enemy.x = enemy.px = (ca.x + cb.x) / 2;
    enemy.y = enemy.py = (ca.y + cb.y) / 2;
    enemy.stunT = 10;
    enemy.hp = enemy.maxHp = 100000;
    first.cd = second.cd = 0;
    stepRun(s);
    expect(s.projectiles.count).toBe(2);

    const effects = new LiveEffects();
    const meshes = effects.root.children.filter((child): child is InstancedMesh => (child as InstancedMesh).isInstancedMesh);
    const bolts = meshes[0];
    effects.update(s, 0.5, STEP);
    expect(bolts.count).toBe(s.projectiles.count);
    expect(bolts.count).toBeLessThanOrEqual(RUN.projectileCap);

    s.projectiles.removeAt(0);
    const before = {
      t: s.t, eventCount: s.eventCount, events: s.events.slice(0, s.eventCount).map(event => ({ ...event })),
      projectiles: s.projectiles.items.slice(0, s.projectiles.count).map(p => ({ x: p.x, y: p.y, px: p.px, py: p.py, tx: p.tx, ty: p.ty, t: p.t })),
      enemy: { x: enemy.x, y: enemy.y, hp: enemy.hp }, towers: s.towers.map(t => ({ uid: t.uid, angle: t.angle, cd: t.cd })),
    };
    effects.update(s, 0.5, STEP);
    effects.consume(s);
    expect(bolts.count).toBe(s.projectiles.count);
    expect(bolts.count).toBe(1);
    expect({
      t: s.t, eventCount: s.eventCount, events: s.events.slice(0, s.eventCount).map(event => ({ ...event })),
      projectiles: s.projectiles.items.slice(0, s.projectiles.count).map(p => ({ x: p.x, y: p.y, px: p.px, py: p.py, tx: p.tx, ty: p.ty, t: p.t })),
      enemy: { x: enemy.x, y: enemy.y, hp: enemy.hp }, towers: s.towers.map(t => ({ uid: t.uid, angle: t.angle, cd: t.cd })),
    }).toEqual(before);
    effects.reset();
    expect(bolts.count).toBe(0);
    effects.dispose();
  });

  it('anchors Sorcerer Barrage chain lines at the hero muzzle', () => {
    const s = run('meadow', 7, ['sorcerer']);
    const [col, row] = freeTiles(s, () => true)[0];
    const tower = build(s, 'sorcerer', col, row)!;
    const enemy = spawnAtGate(s, 'goblin', 0, 1)!;
    enemy.x = enemy.px = tower.x + 60;
    enemy.y = enemy.py = tower.y;
    enemy.hp = enemy.maxHp = 100000;
    tower.abilityCd = 0;
    expect(useAbility(s, tower.uid)).toBe(true);
    expect(s.events.slice(0, s.eventCount).some(event => event.type === 'chain' && event.x === tower.x && event.y === tower.y)).toBe(true);

    const effects = new LiveEffects();
    effects.consume(s);
    effects.update(s, 1, STEP);
    const chainLines = effects.root.children.find(object => object.name === 'Batched event lines') as LineSegments;
    const positions = chainLines.geometry.getAttribute('position');
    expect(chainLines.geometry.drawRange.count).toBeGreaterThanOrEqual(2);
    const expected = groundPoint(tower.x, tower.y, muzzleHeight(tower, s.terrain));
    expect(positions.getX(0)).toBeCloseTo(expected.x);
    expect(positions.getY(0)).toBeCloseTo(expected.y);
    expect(positions.getZ(0)).toBeCloseTo(expected.z);
    effects.dispose();
  });
});
