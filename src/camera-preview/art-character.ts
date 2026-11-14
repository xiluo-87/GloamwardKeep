import {
  AlwaysStencilFunc, AnimationAction, AnimationClip, AnimationMixer, Box3, EqualStencilFunc, GreaterDepth,
  Group, KeepStencilOp, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, MeshStandardMaterial, ReplaceStencilOp,
  SkinnedMesh, Vector3, ZeroStencilOp,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export interface ArtCharacter {
  root: Group;
  height: number;
  setClip(name: string): void;
  update(time: number, position: Vector3, yaw: number): void;
  setHidden(opacity: number, enabled: boolean): void;
  stop(): void;
}

/** Own a fresh skinned copy; map rebuilds must not dispose the reusable loaded template. */
export function createArtCharacter(template: GLTF, initialClip = 'Walk'): ArtCharacter {
  const root = new Group();
  root.name = 'Art character';
  const body = clone(template.scene);
  root.add(body);
  const meshes: SkinnedMesh[] = [];
  body.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry = object.geometry.clone();
    const copy = (material: MeshStandardMaterial): MeshStandardMaterial => {
      const result = material.clone();
      result.stencilWrite = true;
      result.stencilRef = 0;
      result.stencilFunc = AlwaysStencilFunc;
      result.stencilZPass = ReplaceStencilOp;
      return result;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => copy(material as MeshStandardMaterial))
      : copy(object.material as MeshStandardMaterial);
    object.castShadow = true;
    object.receiveShadow = true;
    if (object instanceof SkinnedMesh) { object.frustumCulled = false; meshes.push(object); }
  });
  // Box3's traversal may reach the mesh before its sibling bones. Initialize the whole
  // hierarchy first, then refresh any bounds inherited from the reusable template.
  root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.computeBoundingBox();
  const bounds = new Box3().setFromObject(body);
  const center = bounds.getCenter(new Vector3());
  const height = 1.02;
  const scale = height / bounds.getSize(new Vector3()).y;
  body.scale.multiplyScalar(scale);
  body.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  const mixer = new AnimationMixer(body);
  if (!meshes.length) throw new Error('Character needs a skinned model.');
  let activeClip = '';
  let activeAction: AnimationAction;
  const setClip = (name: string): void => {
    if (activeClip === name) return;
    const clip = AnimationClip.findByName(template.animations, name);
    if (!clip) throw new Error(`Character has no ${name} animation.`);
    mixer.stopAllAction();
    const loop = !['Attack1', 'Attack2', 'Hit', 'Death', 'Special'].includes(name);
    activeAction = mixer.clipAction(clip);
    activeAction.reset().setLoop(loop ? LoopRepeat : LoopOnce, 1);
    activeAction.clampWhenFinished = !loop;
    activeAction.play();
    activeClip = name;
  };
  setClip(initialClip);
  const silhouettes: SkinnedMesh[] = [];
  for (const mesh of meshes) {
    const material = new MeshBasicMaterial({
      color: '#eadfba', opacity: 0, transparent: true, depthWrite: false,
      depthFunc: GreaterDepth, toneMapped: false, stencilWrite: true, stencilRef: 1,
      stencilFunc: EqualStencilFunc, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp,
      stencilZPass: ZeroStencilOp,
    });
    const silhouette = mesh.clone(false);
    silhouette.name = 'Hidden imported mob silhouette';
    silhouette.material = material;
    // Share the animated bones and geometry so the hidden outline follows the exact pose.
    silhouette.skeleton = mesh.skeleton;
    silhouette.renderOrder = 20;
    silhouette.castShadow = false;
    silhouette.receiveShadow = false;
    mesh.parent!.add(silhouette);
    silhouettes.push(silhouette);
  }
  return {
    root, height, setClip,
    update(time, position, yaw) {
      // Sampling is absolute: a clamped one-shot must also be able to seek or restart.
      activeAction.paused = false;
      activeAction.enabled = true;
      mixer.setTime(time);
      root.position.copy(position);
      root.rotation.y = yaw + Math.PI; // The pack faces -Z; fixture routes use +Z as forward.
      root.updateMatrixWorld(true);
    },
    setHidden(opacity, enabled) {
      for (const silhouette of silhouettes) {
        silhouette.visible = enabled && opacity > 0.003;
        (silhouette.material as MeshBasicMaterial).opacity = opacity * 0.22;
      }
    },
    stop() { mixer.stopAllAction(); mixer.uncacheRoot(body); },
  };
}
