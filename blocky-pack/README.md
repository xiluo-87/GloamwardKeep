# Blocky Characters Pack

Blocky voxel-style characters for Tiny Cubes worlds: a dwarf, a skeleton guard, a stone golem, a mummy, a skeleton viking, a lion knight, a mummy pharaoh, an orc warrior, a silver-haired wayfarer, a barbarian king, a dwarf cannoneer, a pirate captain, a stitched brute, a lantern lich, a sorceress, a flame witch, an elf ranger, a caveman, a zombie, a sheet ghost, a bog imp, a big-mouthed muncher, a frost golem, an armoured juggernaut, a fat club-wielding ogre, a winged pit demon, a bird-skull bone seer, a masked grove warden, a hunchbacked ghoul raider, a golden sun guard, a goblin shaman, a devil warrior, a wolf girl, a gauntlet brawler, a barrel knight, a chibi reaper, a violet djinn, a screen-faced robot and a CRT-monitor robot. New additions: an ember tiefling, a root colossus, a bone marauder and a sun monk. Also: a hill troll, a minotaur, a ronin, a plague doctor, a rat rogue and a shroomling. Every character has its own size, from a 0.6 m mushroom to 2.4 m giants. Each model uses one skinned mesh, a shared vertex-colour material, a standard 65-bone Mixamo skeleton (Mixamo clips play on it as is) and ten clips: Idle, Walk, Run and Wave loops plus Attack1, Attack2, Hit, Death, Block and Special one-shots chosen to fit each character. New adventurers: a masked pugilist, ram demon, moss skeleton, halfling rogue, dragon paladin, wild orc, lute bard and antler druid. Guild additions: three miners and rangers, two ginger dwarves, a hide hunter, iron warden, tide duelist, ivory adventurer, chapel priest, chain brawler and feather shaman. Nightmare additions: a harlequin, flesh hook giant, vampire count, tide and fel golems, void oracle and pyramid executioner. Seven reference additions: jotunn, cyclops, grave reaver, panda marauder, wisp mage, gothic sawyer and violet maw.

## What is in here

- `glb/` — web-ready glTF 2.0. Draco geometry, WebP textures. Load these in
  three.js, React Three Fiber, Babylon or anything that reads glTF on the web.
  `catalog.glb` is the whole kit on one grid; `cities/` holds pre-built blocks.
- `dcc/` — the same models without Draco, with PNG/JPEG textures, for Blender,
  Unity, Unreal, Godot and any importer that needs no decoder.
- `components/` — typed React Three Fiber components, one per model.
- `helpers/articulation.js` / `.ts` — a small Three.js controller, with typed source.
- `preview/showroom.html` — open it with a double click, no server needed.
- `palettes.json` — the pack's colours as data.
- `manifest.json` — every file with its size and sha256.

## 60-second start

**three.js** — the web files are Draco-compressed, so point a loader at a decoder:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const gltf = await loader.loadAsync('glb/firehouse.glb');
scene.add(gltf.scene);
```

**React Three Fiber** — copy the component you need out of `components/`, put the
matching `.glb` where your bundler can serve it, and render it. The components
expect `three`, `@react-three/fiber` and `@react-three/drei` in your project; the
pack deliberately ships no `package.json`, so nothing here pins your versions.

**Blender** — `File ▸ Import ▸ glTF 2.0` and pick a file from `dcc/`. Everything is
authored in real-world metres with the origin on the ground footprint.

**Unity** — install glTFast (`com.unity.cloud.gltfast`), then drop files from `dcc/`
into Assets. **Unreal Engine 5** — import from `dcc/`; the built-in glTF importer
reads them. **Godot 4** — copy files from `dcc/` into the project; Godot imports
.glb natively. The `dcc/` files need no Draco decoder.

## Scale and orientation

One unit is one metre. +Y is up, and models face -Z. Origins sit on the ground
footprint, so dropping one at y = 0 puts it on the street.

## Articulated machinery

Vehicles and machines keep their named rigid-part pivots in the same GLB; there is no
separate rigged download. Load them as ordinary static models, or read
`userData.cityAsset` on the model root for the joint/socket contract and target each joint by
its `node` name. Joint metadata is also repeated on the pivot as `userData.cityJoint`.
Angles are radians, prismatic travel is metres, axes are local to the named pivot, and
wheel joints include `radiusMetres` where travel distance can drive their rotation.
GLB node transforms always use the authored rest pose, even if an editor preview was posed
when exported; joint values therefore remain absolute after loading.
Each articulated GLB also contains one inspection-ready animation per joint, named
`city-joint:<joint-id>`. These clips are independent, so an `AnimationMixer` can play
only the door, wheel, boom or valve motion you need.
Composite catalogue files use `city-joint:<asset-id>:<instance-index>:<joint-id>` and
`createArticulationControllers(scene)` returns one controller per asset instance.
Large city exports omit these redundant inspection clips to avoid thousands of animations,
but keep every `cityAsset`, `cityJoint` and `citySocket` extra for runtime control.

```js
import * as THREE from 'three';
import { createArticulationController } from './helpers/articulation.js';

const controls = createArticulationController(gltf.scene);
controls.setJoint('boom-pitch', Math.PI / 6);
controls.rotateWheels(12.5); // absolute travelled distance, metres
controls.openDoors(1);       // 0 closed, 1 fully open

// Or play the standard clip already embedded in the GLB:
const mixer = new THREE.AnimationMixer(gltf.scene);
const clip = THREE.AnimationClip.findByName(gltf.animations, 'city-joint:boom-pitch');
if (clip) mixer.clipAction(clip).play();
```

## Checking the download

`manifest.json` lists a sha256 for every file. On macOS or Linux:

```sh
shasum -a 256 glb/firehouse.glb
```

See LICENSE.txt for what you may do with these files.
