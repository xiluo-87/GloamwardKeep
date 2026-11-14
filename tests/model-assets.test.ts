import { readFileSync } from 'node:fs';
import { Mesh, type BufferAttribute } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/data/balance';
import { ENEMY_MODELS } from '../src/render3d/model-catalog';
import { disposeTerrain } from '../src/camera-preview/terrain';

const load = async (url: URL) => new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(url)).buffer, '');
describe('shipped Blender enemy roster', () => {
  it('covers every gameplay enemy with finite geometry and the required animation clips', async () => {
    expect(Object.keys(ENEMY_MODELS).sort()).toEqual(Object.keys(ENEMIES).sort());
    const original = await load(new URL('../assets-src/studies/goblin-shaman/editor-preview.glb', import.meta.url));
    for (const kind of Object.keys(ENEMY_MODELS)) {
      const model = await load(new URL(`../assets-src/models/${kind}/${kind}.glb`, import.meta.url));
      let triangles = 0;
      model.scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const position = object.geometry.getAttribute('position');
        triangles += (object.geometry.index?.count ?? position.count) / 3;
        for (const name of Object.keys(object.geometry.attributes)) {
          const attribute = object.geometry.getAttribute(name) as BufferAttribute;
          expect(Array.from(attribute.array).every(Number.isFinite), `${kind}: finite attributes`).toBe(true);
        }
        const weights = object.geometry.getAttribute('skinWeight');
        if (weights) for (let i = 0; i < weights.count; i++) {
          expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1);
        }
      });
      expect(triangles).toBeGreaterThan(0); expect(triangles).toBeLessThan(2200);
      const names = model.animations.map(clip => clip.name);
      expect(names).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Run', 'Attack1', 'Hit', 'Death']));
      if (kind !== 'bat' && kind !== 'wagon') {
        expect(names.sort()).toEqual(original.animations.map(clip => clip.name).sort());
        for (const clip of original.animations) expect(model.animations.find(item => item.name === clip.name)!.duration).toBeCloseTo(clip.duration, 5);
      }
      for (const clip of model.animations) for (const track of clip.tracks) {
        expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
        expect(Array.from(track.times).every(Number.isFinite)).toBe(true);
      }
      disposeTerrain(model.scene);
    }
    disposeTerrain(original.scene);
  });
});
