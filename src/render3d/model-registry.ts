import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { SkinnedMesh, type Object3D } from 'three';
import { createArtCharacter, type ArtCharacter } from '../camera-preview/art-character';
import { disposeTerrain } from '../camera-preview/terrain';
import { RUN } from '../data/balance';
import { BakedModel } from './baked-model';
import { ContentAssetLibrary } from './asset-library';
import {
  LEGACY_STATIC_LIBRARY, PROOF_ARCHER_LIBRARY, PROOF_CHARACTER_CATALOG,
  type CharacterRevisionAsset, type ModelRevision, type ProofCharacterAsset, type ProofCharacterId,
} from './proof-catalog';

export type ModelLoader = Pick<GLTFLoader, 'loadAsync'>;
export interface ModelRegistryOptions {
  loader?: ModelLoader;
  staticLibraryUrls?: readonly string[];
  characterCatalog?: Readonly<Record<ProofCharacterId, ProofCharacterAsset>>;
}

const DISPOSED = 'Model registry is disposed.';

/**
 * Owns loaded GLTF templates for one page/application. Preview and live rendering share this same
 * cache/contract, while choosing native animated instances or baked crowd batches independently.
 */
export class RuntimeModelRegistry {
  readonly characterCatalog: Readonly<Record<ProofCharacterId, ProofCharacterAsset>>;
  private readonly loader: ModelLoader;
  private readonly staticLibraryUrls: readonly string[];
  private readonly gltfRequests = new Map<string, Promise<GLTF>>();
  private readonly characterRequests = new Map<string, Promise<GLTF>>();
  private readonly loaded = new Set<GLTF>();
  private libraryRequest: Promise<ContentAssetLibrary> | null = null;
  private library: ContentAssetLibrary | null = null;
  private librarySources = new Set<Object3D>();
  private disposed = false;

  constructor(options: ModelRegistryOptions = {}) {
    this.characterCatalog = options.characterCatalog ?? PROOF_CHARACTER_CATALOG;
    this.loader = options.loader ?? new GLTFLoader();
    this.staticLibraryUrls = options.staticLibraryUrls ?? [LEGACY_STATIC_LIBRARY, PROOF_ARCHER_LIBRARY];
  }

  definition(id: ProofCharacterId): ProofCharacterAsset {
    const definition = this.characterCatalog[id];
    if (!definition) throw new Error(`Unknown proof character: ${String(id)}`);
    return definition;
  }

  loadCharacter(id: ProofCharacterId, revision: ModelRevision = 'adapted'): Promise<GLTF> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED));
    const definition = this.definition(id);
    const key = `${id}:${revision}`;
    let request = this.characterRequests.get(key);
    if (!request) {
      const asset = definition[revision];
      request = this.loadAsset(asset.url).then(template => {
        this.validateCharacter(definition, revision, asset, template);
        return template;
      }).catch(error => {
        this.characterRequests.delete(key);
        throw error;
      });
      this.characterRequests.set(key, request);
    }
    return request;
  }

  async createNativeCharacter(id: ProofCharacterId, revision: ModelRevision = 'adapted'): Promise<ArtCharacter> {
    const template = await this.loadCharacter(id, revision);
    if (this.disposed) throw new Error(DISPOSED);
    const character = createArtCharacter(template);
    const height = this.definition(id).presentationHeight;
    character.root.scale.setScalar(height / 1.02);
    character.height = height;
    return character;
  }

  async createCrowdBatch(id: ProofCharacterId, capacity = RUN.enemyCap, revision: ModelRevision = 'adapted'): Promise<BakedModel> {
    const template = await this.loadCharacter(id, revision);
    if (this.disposed) throw new Error(DISPOSED);
    return new BakedModel(template, capacity);
  }

  loadStaticLibrary(): Promise<ContentAssetLibrary> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED));
    if (this.library) return Promise.resolve(this.library);
    if (this.libraryRequest) return this.libraryRequest;
    const request = Promise.all(this.staticLibraryUrls.map(url => this.loadAsset(url))).then(templates => {
      if (this.disposed) throw new Error(DISPOSED);
      const sources = templates.map(template => template.scene);
      const library = new ContentAssetLibrary(sources);
      this.librarySources = new Set(sources);
      this.library = library;
      return library;
    }).catch(error => {
      if (this.libraryRequest === request) this.libraryRequest = null;
      throw error;
    });
    this.libraryRequest = request;
    return request;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.library?.dispose();
    this.library = null;
    for (const template of this.loaded) {
      if (!this.librarySources.has(template.scene)) disposeTerrain(template.scene, true);
    }
    this.loaded.clear();
    this.librarySources.clear();
    this.characterRequests.clear();
    this.gltfRequests.clear();
    this.libraryRequest = null;
  }

  private loadAsset(url: string): Promise<GLTF> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED));
    let request = this.gltfRequests.get(url);
    if (!request) {
      request = this.loader.loadAsync(url).then(template => {
        if (this.disposed) {
          disposeTerrain(template.scene, true);
          throw new Error(DISPOSED);
        }
        this.loaded.add(template);
        return template;
      }).catch(error => {
        this.gltfRequests.delete(url);
        throw error;
      });
      this.gltfRequests.set(url, request);
    }
    return request;
  }

  private validateCharacter(definition: ProofCharacterAsset, revision: ModelRevision, asset: CharacterRevisionAsset, template: GLTF): void {
    const mesh = this.hasRenderableMesh(template.scene);
    if (!mesh) throw new Error(`${definition.id} (${revision}) has no renderable mesh.`);
    let skinned = false;
    template.scene.traverse(object => { if (object instanceof SkinnedMesh) skinned = true; });
    if (!skinned) throw new Error(`${definition.id} (${revision}) has no skinned character mesh.`);
    const available = new Set(template.animations.map(clip => clip.name));
    const missing = asset.requiredClips.filter(name => !available.has(name));
    if (missing.length) throw new Error(`${definition.id} (${revision}) is missing required animation clips: ${missing.join(', ')}.`);
    const names = new Set<string>();
    template.scene.traverse(object => { if (object.name) names.add(object.name); });
    const missingAnchors = Object.entries(asset.anchors)
      .filter(([, anchor]) => anchor.node !== null && !names.has(anchor.node))
      .map(([label, anchor]) => `${label}=${anchor.node} (${anchor.semantic})`);
    if (missingAnchors.length) throw new Error(`${definition.id} (${revision}) is missing required semantic anchors: ${missingAnchors.join(', ')}.`);
  }

  private hasRenderableMesh(root: Object3D): boolean {
    let found = false;
    root.traverse(object => {
      if ('isMesh' in object && object.isMesh && 'geometry' in object
        && (object as { geometry?: { getAttribute?: (name: string) => unknown } }).geometry?.getAttribute?.('position')) found = true;
    });
    return found;
  }
}
