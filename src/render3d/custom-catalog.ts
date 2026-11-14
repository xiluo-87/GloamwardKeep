import { PROOF_CHARACTER_CATALOG, type ProofCharacterAsset, type ProofCharacterId } from './proof-catalog';

export const CUSTOM_NATURE_LIBRARY = new URL('../../assets-src/rework/custom/nature/nature.glb', import.meta.url).href;
export const CUSTOM_GOBLIN_MODEL = new URL('../../assets-src/rework/custom/goblin/goblin.glb', import.meta.url).href;

/** Review-only geometry authored from scratch; the pack supplies the animation donor. */
export const CUSTOM_CHARACTER_CATALOG: Readonly<Record<ProofCharacterId, ProofCharacterAsset>> = {
  ...PROOF_CHARACTER_CATALOG,
  goblin: {
    ...PROOF_CHARACTER_CATALOG.goblin,
    adapted: {
      ...PROOF_CHARACTER_CATALOG.goblin.adapted,
      url: CUSTOM_GOBLIN_MODEL,
      provenance: 'Original artwork-based Goblin mesh; purchased rig and animation reuse test',
    },
  },
};
