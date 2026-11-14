import { Group, Mesh, Object3D, type Material } from 'three';
import { disposeTerrain } from '../camera-preview/terrain';

/** Shared ownership for the imported static GLB prefab scene. Clones borrow its geometry by default. */
export class ContentAssetLibrary {
  private prefabs = new Map<string, Object3D>();
  private componentNames = new Map<string, string[]>();
  private disposed = false;

  private readonly sources: readonly Object3D[];

  constructor(source: Object3D | readonly Object3D[]) {
    this.sources = [...new Set(Array.isArray(source) ? source : [source as Object3D])];
    for (const owner of this.sources) {
      owner.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.geometry.userData.sharedAsset = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material.userData.sharedAsset = true;
        }
      });
      for (const object of owner.children) {
        const id = this.metadataName(object, 'asset_id') || this.metadataName(object, 'name') || object.name;
        if (!id) continue;
        object.name = id;
        this.prefabs.set(id, object);
        this.componentNames.set(id, object.children.map(child =>
          this.metadataName(child, 'component_id') || this.metadataName(child, 'name') || child.name));
      }
    }
  }

  get ready(): boolean { return !this.disposed && this.prefabs.size > 0; }
  has(id: string): boolean { return this.ready && this.prefabs.has(id); }
  get ids(): readonly string[] { return this.disposed ? [] : [...this.prefabs.keys()]; }

  /** Clone hierarchy and transforms; only clone materials when a consumer will mutate their state. */
  instantiate(id: string, cloneMaterials = false): Group | null {
    if (this.disposed) return null;
    const source = this.prefabs.get(id);
    if (!source) return null;
    const clone = source.clone(true) as Group;
    clone.name = id;
    const names = this.componentNames.get(id) ?? [];
    clone.children.forEach((child, index) => {
      if (names[index]) child.name = names[index];
    });
    clone.userData.assetId = id;
    clone.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.userData.sharedAsset = true;
      if (cloneMaterials) {
        const cloneMaterial = (material: Material): Material => {
          const copy = material.clone();
          copy.userData.sharedAsset = false;
          return copy;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(cloneMaterial)
          : cloneMaterial(object.material);
      } else {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material.userData.sharedAsset = true;
        }
      }
    });
    return clone;
  }

  private metadataName(object: Object3D, key: string): string {
    const value = object.userData[key];
    if (typeof value === 'string') return value;
    const extras = object.userData.gltfExtras as Record<string, unknown> | undefined;
    return typeof extras?.[key] === 'string' ? extras[key] as string : '';
  }

  /** Dispose the imported owner once; clones mark borrowed resources so ordinary scene cleanup skips them. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.prefabs.clear();
    this.componentNames.clear();
    for (const source of this.sources) disposeTerrain(source as Group, true);
  }
}
