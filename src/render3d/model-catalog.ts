/** Explicit URLs keep Vite's hashed exports valid under the deployed /gloamward/ base. */
export const ENEMY_MODELS = {
  goblin: new URL('../../assets-src/models/goblin/goblin.glb', import.meta.url).href,
  hexer: new URL('../../assets-src/models/hexer/hexer.glb', import.meta.url).href,
  orc: new URL('../../assets-src/models/orc/orc.glb', import.meta.url).href,
  stalker: new URL('../../assets-src/models/stalker/stalker.glb', import.meta.url).href,
  bat: new URL('../../assets-src/models/bat/bat.glb', import.meta.url).href,
  troll: new URL('../../assets-src/models/troll/troll.glb', import.meta.url).href,
  wagon: new URL('../../assets-src/models/wagon/wagon.glb', import.meta.url).href,
  shaman: new URL('../../assets-src/models/shaman/shaman.glb', import.meta.url).href,
  ogreking: new URL('../../assets-src/models/ogreking/ogreking.glb', import.meta.url).href,
  lich: new URL('../../assets-src/models/lich/lich.glb', import.meta.url).href,
};
export const LIBRARY_MODEL = new URL('../../assets-src/models/library/library.glb', import.meta.url).href;
