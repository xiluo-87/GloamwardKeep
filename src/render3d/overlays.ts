import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, LineSegments, Vector3 } from 'three';
import { disposeTerrain, tilePosition } from '../camera-preview/terrain';
import type { ViewState } from '../render/view';
import { previewRoute } from '../sim/path';
import type { RunState } from '../sim/state';
import { computeStats } from '../sim/stats';
import { LiveTowers, type TowerVisual } from './towers';
import { RangeTiles, upgradeRange } from './range';
import { tileCenter } from '../sim/hex';
import type { ContentAssetLibrary } from './asset-library';
import { BASE_SCENE, type SceneProportions } from './scene-proportions';

function outline(count: number, color: string): LineLoop<BufferGeometry, LineBasicMaterial> {
  const points = Array.from({ length: count }, (_, i) => new Vector3(Math.sin(i * Math.PI * 2 / count), 0.04, Math.cos(i * Math.PI * 2 / count)));
  return new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
}

export class LiveOverlays {
  readonly root = new Group();
  private selected = outline(6, '#f5e3a0');
  private hovered = outline(6, '#d4e6ca');
  private range: RangeTiles;
  private route = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#b6cfa1', transparent: true, opacity: 0.65 }));
  private preview = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#f2ce88' }));
  private ghost: TowerVisual | null = null;
  private library: ContentAssetLibrary | null = null;
  private ghostType = '';
  private cachedRun: RunState | null = null;
  private flowVersion = -1;
  private previewTiles: number[] | null = null;

  constructor(private proportions: SceneProportions = BASE_SCENE) {
    this.range = new RangeTiles(proportions);
    this.root.add(this.selected, this.hovered, this.range.root, this.route, this.preview);
  }

  setLibrary(library: ContentAssetLibrary): void {
    this.library = library;
    if (this.ghost) { this.root.remove(this.ghost.root); disposeTerrain(this.ghost.root); this.ghost = null; }
    this.ghostType = '';
  }

  update(s: RunState, view: ViewState): void {
    const tile = view.selectedTile;
    this.selected.visible = !!tile;
    if (tile) {
      this.selected.position.copy(tilePosition(s.terrain, tile.row * s.terrain.cols + tile.col));
      this.selected.position.y /= this.proportions.tile;
    }
    const hover = view.hoverTile;
    this.hovered.visible = !!hover;
    if (hover) {
      this.hovered.position.copy(tilePosition(s.terrain, hover.row * s.terrain.cols + hover.col));
      this.hovered.position.y /= this.proportions.tile;
    }

    if (this.cachedRun !== s || this.flowVersion !== s.flowVersion) {
      this.writeRoute(this.route, s, previewRoute(s, -1, -1).tiles);
      this.cachedRun = s;
      this.flowVersion = s.flowVersion;
    }
    this.route.visible = view.showPaths;
    if (this.previewTiles !== view.routePreview) {
      this.writeRoute(this.preview, s, view.routePreview ?? []);
      this.previewTiles = view.routePreview;
    }
    this.preview.visible = !!view.routePreview;
    this.preview.material.color.set(view.routeSealed ? '#e26a4f' : '#f2ce88');

    const tower = s.towers.find(t => t.uid === view.selectedUid);
    const at = view.placing && hover ? hover : tower ? { col: tower.tx, row: tower.ty } : null;
    this.range.hide();
    if (at) {
      const height = s.terrain.height[at.row * s.terrain.cols + at.col];
      const radius = view.placing ? computeStats({ type: view.placing, tier: 1, fork: 0, forkTier: 0, heroLevel: 1, skills: [], height }, s.mods).range : tower!.stats.range;
      const center = tileCenter(at.col, at.row);
      const preview = view.upgradePreview;
      const extended = !view.placing && tower && preview?.uid === tower.uid ? upgradeRange(s, tower, preview.path) : null;
      if (radius > 0) this.range.show(s.terrain, center.x, center.y, radius, extended);
    }
    if (this.ghostType !== (view.placing ?? '')) {
      if (this.ghost) { this.root.remove(this.ghost.root); disposeTerrain(this.ghost.root); }
      this.ghostType = view.placing ?? '';
      this.ghost = view.placing ? LiveTowers.ghost(view.placing, this.library, this.proportions) : null;
      if (this.ghost) this.root.add(this.ghost.root);
    }
    if (this.ghost) {
      this.ghost.root.visible = !!hover;
      if (hover) {
        this.ghost.root.position.copy(tilePosition(s.terrain, hover.row * s.terrain.cols + hover.col));
        this.ghost.root.position.y /= this.proportions.tile;
      }
      this.ghost.root.traverse(object => {
        if ('material' in object) {
          const material = object.material as { color?: { set(color: string): void } };
          material.color?.set(view.placeOk ? '#afdbad' : '#d96b5b');
        }
      });
    }
  }

  private writeRoute(line: LineSegments, s: RunState, tiles: number[]): void {
    const points: number[] = [];
    const goal = s.terrain.goal[1] * s.terrain.cols + s.terrain.goal[0];
    for (let i = 1; i < tiles.length; i++) {
      if (tiles[i - 1] === goal) continue;
      for (const index of [tiles[i - 1], tiles[i]]) {
        tilePosition(s.terrain, index).toArray(points, points.length);
        points[points.length - 2] /= this.proportions.tile;
        points[points.length - 2] += 0.055;
      }
    }
    const old = line.geometry;
    line.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3));
    old.dispose();
  }

  reset(): void { this.cachedRun = null; this.flowVersion = -1; this.previewTiles = null; }
  dispose(): void { disposeTerrain(this.root); this.root.removeFromParent(); }
}
