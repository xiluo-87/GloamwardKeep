import {
  AnimationClip, Bone, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial,
  Skeleton, SkinnedMesh, VectorKeyframeTrack,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ARCHER_TOWER_STATES, CHARACTER_CLIPS, PROOF_ARCHER_LIBRARY, PROOF_CHARACTER_CATALOG, type ProofCharacterId } from '../src/render3d/proof-catalog';
import { RuntimeModelRegistry, type ModelLoader } from '../src/render3d/model-registry';

function character(): GLTF {
  const scene = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(12), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geometry.setIndex([0, 1, 2]);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: '#ffffff' }));
  const bone = new Bone(); bone.name = 'RootBone'; mesh.add(bone); mesh.bind(new Skeleton([bone])); scene.add(mesh);
  for (const name of ['mixamorigHead', 'mixamorigSpine2', 'LeftHandSocket', 'RightHandSocket', 'Arrow']) {
    const anchor = new Group(); anchor.name = name; scene.add(anchor);
  }
  const track = new VectorKeyframeTrack('RootBone.position', [0, 1], [0, 0, 0, 0, 0.1, 0]);
  return { scene, animations: CHARACTER_CLIPS.map(name => new AnimationClip(name, 1, [track])), scenes: [scene], parser: {} } as GLTF;
}

function prefabScene(id: string, tint: string): Group {
  const scene = new Group();
  const root = new Group(); root.name = id; root.userData.asset_id = id;
  root.add(new Mesh(new BufferGeometry().setFromPoints([]), new MeshStandardMaterial({ color: tint })));
  scene.add(root);
  return scene;
}

function loaderFor(resolve: (url: string) => GLTF | Promise<GLTF>, calls: string[] = []): ModelLoader {
  return { loadAsync: vi.fn((url: string) => { calls.push(url); return Promise.resolve(resolve(url)); }) } as unknown as ModelLoader;
}

describe('RuntimeModelRegistry', () => {
  it('keeps source/adapted URLs and proof scale/provenance metadata explicit for the four approved IDs', () => {
    expect(Object.keys(PROOF_CHARACTER_CATALOG).sort()).toEqual(['archer-crew', 'goblin', 'orc', 'troll']);
    expect(PROOF_CHARACTER_CATALOG.goblin.presentationHeight).toBe(1.02);
    expect(PROOF_CHARACTER_CATALOG.orc.presentationHeight).toBe(1.45);
    expect(PROOF_CHARACTER_CATALOG.troll.presentationHeight).toBe(1.8);
    expect(PROOF_CHARACTER_CATALOG['archer-crew'].presentationHeight).toBe(0.72);
    for (const definition of Object.values(PROOF_CHARACTER_CATALOG)) {
      expect(definition.coordinateSystem).toEqual({ up: '+Y', forward: '-Z', origin: 'feet' });
      expect(definition.source.url).not.toBe(definition.adapted.url);
      expect(definition.source.requiredClips).toEqual(CHARACTER_CLIPS);
      expect(definition.adapted.requiredClips).toEqual(CHARACTER_CLIPS);
      for (const revision of [definition.source, definition.adapted]) {
        expect(revision.anchors.feet).toEqual({ node: null, semantic: 'root-feet-origin' });
        expect(revision.anchors.head).toEqual({ node: 'mixamorigHead', semantic: 'head-target-origin' });
        expect(revision.anchors.aim.semantic).toBe('weapon-hand');
        expect(revision.anchors.effects).toEqual({ node: 'mixamorigSpine2', semantic: 'chest-effects' });
      }
      expect(definition.source.provenance).toBeTruthy();
      expect(definition.adapted.provenance).toBeTruthy();
    }
    expect(PROOF_ARCHER_LIBRARY).toContain('/assets-src/rework/proof/archers/archers.glb');
    expect(ARCHER_TOWER_STATES).toHaveLength(7);
    expect(PROOF_CHARACTER_CATALOG['archer-crew'].source.anchors.aim.node).toBe('LeftHandSocket');
    expect(PROOF_CHARACTER_CATALOG['archer-crew'].source.anchors.crewMuzzle).toEqual({ node: 'Arrow', semantic: 'crew-bow-muzzle' });
    for (const id of ['goblin', 'orc', 'troll'] as const) expect(PROOF_CHARACTER_CATALOG[id].source.anchors.aim.node).toBe('RightHandSocket');
  });

  it('deduplicates character loads and offers native and baked instances from one owned template', async () => {
    const urls: string[] = [];
    const template = character();
    const registry = new RuntimeModelRegistry({ loader: loaderFor(() => template, urls) });
    const first = registry.loadCharacter('orc', 'source');
    const second = registry.loadCharacter('orc', 'source');
    expect(await first).toBe(await second);
    const native = await registry.createNativeCharacter('orc', 'source');
    const batch = await registry.createCrowdBatch('orc', 4, 'source');
    expect(urls).toEqual([PROOF_CHARACTER_CATALOG.orc.source.url]);
    expect(native.height).toBe(1.45);
    expect(native.root.scale.x).toBeCloseTo(1.45 / 1.02);
    expect(batch.stats.vertices).toBe(3);
    expect(batch.body.instanceMatrix.count).toBe(4);
    native.stop(); batch.dispose(); registry.dispose();
  });

  it('loads legacy and proof static libraries together with proof IDs taking precedence', async () => {
    const old = prefabScene('tower/archer/tier-1', '#bb0000');
    const proof = prefabScene('tower/archer/tier-1', '#00bb00').children[0];
    const legacyOnly = prefabScene('tower/archer/tier-2', '#0000bb').children[0];
    const proofLibrary = new Group().add(proof, legacyOnly);
    const urls: string[] = [];
    const registry = new RuntimeModelRegistry({
      loader: loaderFor(url => url === 'legacy' ? { ...character(), scene: old } : { ...character(), scene: proofLibrary } as GLTF, urls),
      staticLibraryUrls: ['legacy', 'proof'],
    });
    const [library, second] = await Promise.all([registry.loadStaticLibrary(), registry.loadStaticLibrary()]);
    expect(library).toBe(second);
    expect(urls).toEqual(['legacy', 'proof']);
    expect(library.ids).toEqual(expect.arrayContaining(['tower/archer/tier-1', 'tower/archer/tier-2']));
    const preferred = library.instantiate('tower/archer/tier-1')!;
    expect((preferred.children[0] as Mesh).material).toBe((proof.children[0] as Mesh).material);
    expect(library.instantiate('tower/archer/tier-2')).not.toBeNull();
    registry.dispose();
  });

  it('rejects a proof model with missing required clips instead of substituting another clip', async () => {
    const model = character();
    model.animations = model.animations.filter(clip => clip.name !== 'Attack1');
    const registry = new RuntimeModelRegistry({ loader: loaderFor(() => model) });
    await expect(registry.loadCharacter('goblin', 'source')).rejects.toThrow(/missing required animation clips: Attack1/);
    registry.dispose();
  });

  it('loads a custom character catalog and owns every source in an extended static library', async () => {
    const custom = character();
    const sources = new Map(['base', 'archers', 'nature'].map((name, index) => [
      name, { ...character(), scene: prefabScene(`study/${name}`, ['#887755', '#997733', '#668844'][index]) } as GLTF,
    ]));
    const disposal = vi.fn();
    for (const template of sources.values()) template.scene.traverse(object => {
      if (object instanceof Mesh) object.geometry.addEventListener('dispose', disposal);
    });
    const catalog = { ...PROOF_CHARACTER_CATALOG, goblin: {
      ...PROOF_CHARACTER_CATALOG.goblin,
      adapted: { ...PROOF_CHARACTER_CATALOG.goblin.adapted, url: 'custom-goblin' },
    } };
    const registry = new RuntimeModelRegistry({
      characterCatalog: catalog,
      staticLibraryUrls: ['base', 'archers', 'nature'],
      loader: loaderFor(url => url === 'custom-goblin' ? custom : sources.get(url)!),
    });
    expect(await registry.loadCharacter('goblin')).toBe(custom);
    expect(PROOF_CHARACTER_CATALOG.goblin.adapted.url).not.toBe('custom-goblin');
    const library = await registry.loadStaticLibrary();
    expect([...library.ids].sort()).toEqual(['study/archers', 'study/base', 'study/nature']);
    registry.dispose();
    expect(disposal).toHaveBeenCalledTimes(3);
  });

  it('validates semantic anchors on every actual source and adapted character GLB', async () => {
    const urls = new Map<string, { id: ProofCharacterId; revision: 'source' | 'adapted' }>();
    for (const [id, definition] of Object.entries(PROOF_CHARACTER_CATALOG) as [ProofCharacterId, typeof PROOF_CHARACTER_CATALOG[ProofCharacterId]][]) {
      urls.set(definition.source.url, { id, revision: 'source' });
      urls.set(definition.adapted.url, { id, revision: 'adapted' });
    }
    const parsed = new Map<string, GLTF>();
    const registry = new RuntimeModelRegistry({ loader: loaderFor(async url => {
      const bytes = readFileSync(decodeURIComponent(new URL(url).pathname));
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const template = await new GLTFLoader().parseAsync(data, '');
      parsed.set(url, template);
      return template;
    }) });
    try {
      for (const { id, revision } of urls.values()) await registry.loadCharacter(id, revision);
      expect(parsed.size).toBe(8);
    } finally {
      registry.dispose();
    }
  });

  it('disposes a template that completes after registry disposal exactly once', async () => {
    let complete!: (gltf: GLTF) => void;
    const late = character();
    const disposeGeometry = vi.fn();
    late.scene.traverse(object => { if (object instanceof Mesh) object.geometry.addEventListener('dispose', disposeGeometry); });
    const loader = { loadAsync: vi.fn(() => new Promise<GLTF>(resolve => { complete = resolve; })) } as unknown as ModelLoader;
    const registry = new RuntimeModelRegistry({ loader });
    const loading = registry.loadCharacter('troll', 'source');
    registry.dispose();
    complete(late);
    await expect(loading).rejects.toThrow(/disposed/i);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    await expect(registry.loadCharacter('troll')).rejects.toThrow(/disposed/i);
  });
});
