import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { LIBRARY_MODEL } from './model-catalog';

export type ProofCharacterId = 'goblin' | 'orc' | 'troll' | 'archer-crew';
export type ModelRevision = 'source' | 'adapted';
export type CharacterAnchorSemantic = 'root-feet-origin' | 'head-target-origin' | 'weapon-hand' | 'chest-effects' | 'crew-bow-muzzle';
export interface CharacterSemanticAnchor { node: string | null; semantic: CharacterAnchorSemantic }
export interface CharacterAnchorContract {
  feet: CharacterSemanticAnchor;
  head: CharacterSemanticAnchor;
  aim: CharacterSemanticAnchor;
  effects: CharacterSemanticAnchor;
  crewMuzzle?: CharacterSemanticAnchor;
}
export interface CharacterRevisionAsset {
  url: string;
  provenance: string;
  requiredClips: readonly string[];
  anchors: CharacterAnchorContract;
}
export interface ProofCharacterAsset {
  id: ProofCharacterId;
  presentationHeight: number;
  coordinateSystem: { up: '+Y'; forward: '-Z'; origin: 'feet' };
  source: CharacterRevisionAsset;
  adapted: CharacterRevisionAsset;
}

export const CHARACTER_CLIPS = ['Idle', 'Walk', 'Run', 'Wave', 'Attack1', 'Attack2', 'Hit', 'Death', 'Block', 'Special'] as const;
const clips = (): readonly string[] => [...CHARACTER_CLIPS];
const coordinateSystem = { up: '+Y', forward: '-Z', origin: 'feet' } as const;
const humanoidAnchors = (weaponHand: 'LeftHandSocket' | 'RightHandSocket', crew = false): CharacterAnchorContract => ({
  feet: { node: null, semantic: 'root-feet-origin' },
  head: { node: 'mixamorigHead', semantic: 'head-target-origin' },
  aim: { node: weaponHand, semantic: 'weapon-hand' },
  effects: { node: 'mixamorigSpine2', semantic: 'chest-effects' },
  ...(crew ? { crewMuzzle: { node: 'Arrow', semantic: 'crew-bow-muzzle' as const } } : {}),
});

/** Bounded, approved-to-review models. Source and adaptation remain distinct catalog revisions. */
export const PROOF_CHARACTER_CATALOG: Readonly<Record<ProofCharacterId, ProofCharacterAsset>> = {
  goblin: {
    id: 'goblin', presentationHeight: 1.02, coordinateSystem,
    source: { url: new URL('../../assets-src/studies/goblin-shaman/editor-preview.glb', import.meta.url).href, provenance: 'Purchased Blocky Characters goblin shaman editor export', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
    adapted: { url: new URL('../../assets-src/rework/refined/characters/goblin.glb', import.meta.url).href, provenance: 'Source-derived Blender mesh reduction and shape refinement', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
  },
  orc: {
    id: 'orc', presentationHeight: 1.45, coordinateSystem,
    source: { url: new URL('../../blocky-pack/dcc/tiny-characters-blocky-orc.glb', import.meta.url).href, provenance: 'Purchased Blocky Characters orc source model', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
    adapted: { url: new URL('../../assets-src/rework/refined/characters/orc.glb', import.meta.url).href, provenance: 'Source-derived Blender mesh reduction and shape refinement', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
  },
  troll: {
    id: 'troll', presentationHeight: 1.8, coordinateSystem,
    source: { url: new URL('../../blocky-pack/dcc/tiny-characters-blocky-hill-troll.glb', import.meta.url).href, provenance: 'Purchased Blocky Characters hill troll source model', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
    adapted: { url: new URL('../../assets-src/rework/refined/characters/troll.glb', import.meta.url).href, provenance: 'Source-derived Blender mesh reduction and shape refinement', requiredClips: clips(), anchors: humanoidAnchors('RightHandSocket') },
  },
  'archer-crew': {
    id: 'archer-crew', presentationHeight: 0.72, coordinateSystem,
    source: { url: new URL('../../blocky-pack/dcc/tiny-characters-blocky-hood-archer.glb', import.meta.url).href, provenance: 'Purchased Blocky Characters hood archer source model', requiredClips: clips(), anchors: humanoidAnchors('LeftHandSocket', true) },
    adapted: { url: new URL('../../assets-src/rework/refined/characters/archer-crew.glb', import.meta.url).href, provenance: 'Source-derived Blender mesh reduction and shape refinement', requiredClips: clips(), anchors: humanoidAnchors('LeftHandSocket', true) },
  },
};

export const LEGACY_STATIC_LIBRARY = LIBRARY_MODEL;
export const PROOF_ARCHER_LIBRARY = new URL('../../assets-src/rework/proof/archers/archers.glb', import.meta.url).href;
export const ARCHER_TOWER_STATES = [
  'tower/archer/tier-1', 'tower/archer/tier-2', 'tower/archer/tier-3',
  'tower/archer/fork-a-1', 'tower/archer/fork-a-2', 'tower/archer/fork-b-1', 'tower/archer/fork-b-2',
] as const;

/** Keep GLTF's parsed type visible to callers that share the registry contract. */
export type ProofCharacterTemplate = GLTF;
