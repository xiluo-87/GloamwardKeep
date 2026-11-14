import * as THREE from 'three';

/**
 * Public, portable articulation metadata written to glTF `extras`.
 *
 * Runtime objects, materials and callbacks stay in `sculptRuntime`; this module
 * contains only the small JSON contract a buyer can use after loading a GLB in
 * three.js, Blender, Unity or another glTF-aware tool.
 */

export const CITY_ASSET_EXTRAS_KEY = 'cityAsset';
export const CITY_JOINT_EXTRAS_KEY = 'cityJoint';
export const CITY_SOCKET_EXTRAS_KEY = 'citySocket';
export const CITY_COLLIDER_EXTRAS_KEY = 'cityCollider';

export const PUBLIC_GLTF_EXTRAS_KEYS = [
  CITY_ASSET_EXTRAS_KEY,
  CITY_JOINT_EXTRAS_KEY,
  CITY_SOCKET_EXTRAS_KEY,
  CITY_COLLIDER_EXTRAS_KEY,
] as const;

export type ArticulationAssetType =
  | 'vehicle'
  | 'tracked-vehicle'
  | 'crane'
  | 'machine'
  | 'mechanism';

export type ArticulationJointKind = 'revolute' | 'continuous' | 'prismatic';

export type ArticulationJointRole =
  | 'steering'
  | 'wheel-roll'
  | 'track-drive'
  | 'slew'
  | 'boom'
  | 'stick'
  | 'bucket'
  | 'lift'
  | 'tilt'
  | 'door'
  | 'gate'
  | 'hitch'
  | 'rotor'
  | 'trolley'
  | 'hook'
  | 'custom';

export type Axis3 = readonly [number, number, number];

export interface ArticulationLimit {
  min: number;
  max: number;
}

export interface ArticulationJointBinding {
  id: string;
  node: THREE.Object3D;
  kind: ArticulationJointKind;
  role: ArticulationJointRole;
  /** Axis in the joint node's local coordinates. */
  axis: Axis3;
  /** Required for revolute/prismatic joints; omitted for continuous rotation. */
  limits?: ArticulationLimit;
  /** Rest value in radians for rotation or metres for translation. */
  rest?: number;
  /** Rolling radius used to derive wheel/drum angle from travelled distance. */
  radiusMetres?: number;
}

export interface ArticulationSocketBinding {
  id: string;
  node: THREE.Object3D;
  purpose: string;
}

export interface ArticulationColliderBinding {
  id: string;
  node: THREE.Object3D;
  shape: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'compound';
  isTrigger?: boolean;
}

export interface ArticulationContractOptions {
  assetId: string;
  assetType: ArticulationAssetType;
  joints: readonly ArticulationJointBinding[];
  sockets?: readonly ArticulationSocketBinding[];
  colliders?: readonly ArticulationColliderBinding[];
}

export interface CityJointExtras {
  id: string;
  node: string;
  kind: ArticulationJointKind;
  role: ArticulationJointRole;
  axis: [number, number, number];
  unit: 'radians' | 'metres';
  limits?: ArticulationLimit;
  rest?: number;
  radiusMetres?: number;
}

export interface CityAssetExtras {
  schema: 'city-articulation';
  version: 1;
  assetId: string;
  assetType: ArticulationAssetType;
  articulated: true;
  coordinateSystem: {
    units: 'metres';
    up: '+Y';
    forward: '-Z';
    origin: 'ground-centre';
  };
  joints: CityJointExtras[];
  sockets: Array<{ id: string; node: string; purpose: string }>;
  colliders: Array<{
    id: string;
    node: string;
    shape: ArticulationColliderBinding['shape'];
    isTrigger: boolean;
  }>;
}

type JointRestPose = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

const jointRestPoses = new WeakMap<THREE.Object3D, JointRestPose>();

function assertUniqueIds(label: string, values: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.id.trim()) throw new Error(`${label} id must not be empty.`);
    if (seen.has(value.id)) throw new Error(`Duplicate ${label} id "${value.id}".`);
    seen.add(value.id);
  }
}

function assertNamedNode(
  label: string,
  node: THREE.Object3D | null | undefined,
): asserts node is THREE.Object3D {
  if (!node) throw new Error(`${label} targets a missing Object3D.`);
  if (!node.name?.trim()) throw new Error(`${label} must target a named Object3D.`);
}

function normalizedAxis(axis: Axis3, jointId: string): [number, number, number] {
  const vector = new THREE.Vector3(...axis);
  if (vector.lengthSq() < 1e-12) throw new Error(`Joint "${jointId}" has a zero-length axis.`);
  vector.normalize();
  return [vector.x, vector.y, vector.z];
}

/**
 * Marks an already-authored rigid-part hierarchy as a portable articulated
 * asset. It never changes transforms or reparents geometry. Declared limits
 * are the portable range enforced by ArticulationController; they do not wrap
 * or constrain a model's separate authoring/runtime setters, which may
 * deliberately allow wider diagnostic or preset poses.
 */
export function attachArticulationContract(
  root: THREE.Object3D,
  options: ArticulationContractOptions,
): void {
  if (!root.name.trim()) throw new Error('An articulated asset root must be named.');
  assertUniqueIds('joint', options.joints);
  assertUniqueIds('socket', options.sockets ?? []);
  assertUniqueIds('collider', options.colliders ?? []);

  const joints = options.joints.map((binding) => {
    assertNamedNode(`Joint "${binding.id}"`, binding.node);
    if (binding.kind !== 'continuous') {
      if (!binding.limits || binding.limits.min > binding.limits.max) {
        throw new Error(`Joint "${binding.id}" requires ordered min/max limits.`);
      }
    }
    if (binding.radiusMetres !== undefined && binding.radiusMetres <= 0) {
      throw new Error(`Joint "${binding.id}" radiusMetres must be positive.`);
    }
    const rest = binding.rest ?? 0;
    if (binding.limits && (rest < binding.limits.min || rest > binding.limits.max)) {
      throw new Error(`Joint "${binding.id}" rest value must be inside its limits.`);
    }
    const joint: CityJointExtras = {
      id: binding.id,
      node: binding.node.name,
      kind: binding.kind,
      role: binding.role,
      axis: normalizedAxis(binding.axis, binding.id),
      unit: binding.kind === 'prismatic' ? 'metres' : 'radians',
      ...(binding.limits ? { limits: { ...binding.limits } } : {}),
      ...(binding.rest !== undefined ? { rest: binding.rest } : {}),
      ...(binding.radiusMetres !== undefined ? { radiusMetres: binding.radiusMetres } : {}),
    };
    binding.node.userData[CITY_JOINT_EXTRAS_KEY] = joint;
    jointRestPoses.set(binding.node, {
      position: binding.node.position.clone(),
      quaternion: binding.node.quaternion.clone(),
    });
    return joint;
  });

  const sockets = (options.sockets ?? []).map((binding) => {
    assertNamedNode(`Socket "${binding.id}"`, binding.node);
    const socket = { id: binding.id, node: binding.node.name, purpose: binding.purpose };
    binding.node.userData[CITY_SOCKET_EXTRAS_KEY] = socket;
    return socket;
  });

  const colliders = (options.colliders ?? []).map((binding) => {
    assertNamedNode(`Collider "${binding.id}"`, binding.node);
    const collider = {
      id: binding.id,
      node: binding.node.name,
      shape: binding.shape,
      isTrigger: binding.isTrigger ?? false,
    };
    binding.node.userData[CITY_COLLIDER_EXTRAS_KEY] = collider;
    return collider;
  });

  const asset: CityAssetExtras = {
    schema: 'city-articulation',
    version: 1,
    assetId: options.assetId,
    assetType: options.assetType,
    articulated: true,
    coordinateSystem: {
      units: 'metres',
      up: '+Y',
      forward: '-Z',
      origin: 'ground-centre',
    },
    joints,
    sockets,
    colliders,
  };
  root.userData[CITY_ASSET_EXTRAS_KEY] = asset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJointExtras(value: unknown): value is CityJointExtras {
  if (!isRecord(value)) return false;
  const axis = value.axis;
  return (
    typeof value.id === 'string'
    && typeof value.node === 'string'
    && (value.kind === 'revolute' || value.kind === 'continuous' || value.kind === 'prismatic')
    && typeof value.role === 'string'
    && Array.isArray(axis)
    && axis.length === 3
    && axis.every((component) => typeof component === 'number' && Number.isFinite(component))
  );
}

/** Finds every articulated asset at or below `root`, in traversal order. */
export function findArticulationRoots(root: THREE.Object3D): THREE.Object3D[] {
  const results: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (isRecord(object.userData[CITY_ASSET_EXTRAS_KEY])) results.push(object);
  });
  return results;
}

/** Finds the first articulated asset at or below `root`. */
export function findArticulationRoot(root: THREE.Object3D): THREE.Object3D | null {
  return findArticulationRoots(root)[0] ?? null;
}

function contractOnExactRoot(assetRoot: THREE.Object3D): CityAssetExtras | null {
  const value = assetRoot.userData[CITY_ASSET_EXTRAS_KEY];
  if (!isRecord(value) || value.schema !== 'city-articulation' || value.version !== 1) return null;
  if (!Array.isArray(value.joints) || !value.joints.every(isJointExtras)) return null;
  return value as unknown as CityAssetExtras;
}

/** Reads the public contract written by this module without authoring-only state. */
export function getArticulationContract(root: THREE.Object3D): CityAssetExtras | null {
  const assetRoot = findArticulationRoot(root);
  if (!assetRoot) return null;
  return contractOnExactRoot(assetRoot);
}

export interface ResolvedArticulationJoint {
  readonly id: string;
  readonly node: THREE.Object3D;
  readonly kind: ArticulationJointKind;
  readonly role: ArticulationJointRole;
  readonly axis: readonly [number, number, number];
  readonly limits?: Readonly<ArticulationLimit>;
  readonly rest: number;
  readonly radiusMetres?: number;
}

type JointState = {
  public: ResolvedArticulationJoint;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
};

function resolveJointStatesForAssetRoot(assetRoot: THREE.Object3D): {
  assetRoot: THREE.Object3D;
  contract: CityAssetExtras;
  states: JointState[];
} {
  const contract = contractOnExactRoot(assetRoot);
  if (!contract) throw new Error(`Invalid ${CITY_ASSET_EXTRAS_KEY} contract on "${assetRoot.name}".`);

  const nodesByJointId = new Map<string, THREE.Object3D>();
  assetRoot.traverse((object) => {
    const extras = object.userData[CITY_JOINT_EXTRAS_KEY];
    if (isJointExtras(extras)) nodesByJointId.set(extras.id, object);
  });

  const states = contract.joints.map((joint): JointState => {
    const node = nodesByJointId.get(joint.id) ?? assetRoot.getObjectByName(joint.node);
    if (!node) throw new Error(`Joint "${joint.id}" targets missing node "${joint.node}".`);
    const savedPose = jointRestPoses.get(node);
    const pose = savedPose ?? {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
    };
    if (!savedPose) jointRestPoses.set(node, pose);
    return {
      public: {
        id: joint.id,
        node,
        kind: joint.kind,
        role: joint.role,
        axis: joint.axis,
        limits: joint.limits,
        rest: joint.rest ?? 0,
        radiusMetres: joint.radiusMetres,
      },
      basePosition: pose.position.clone(),
      baseQuaternion: pose.quaternion.clone(),
    };
  });
  return { assetRoot, contract, states };
}

function resolveJointStates(root: THREE.Object3D): ReturnType<typeof resolveJointStatesForAssetRoot> | null {
  const assetRoot = findArticulationRoot(root);
  return assetRoot ? resolveJointStatesForAssetRoot(assetRoot) : null;
}

function clampJointValue(joint: ResolvedArticulationJoint, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Joint "${joint.id}" value must be finite.`);
  if (!joint.limits) return value;
  return THREE.MathUtils.clamp(value, joint.limits.min, joint.limits.max);
}

function jointPositionAt(state: JointState, value: number, target = new THREE.Vector3()): THREE.Vector3 {
  const joint = state.public;
  const axis = new THREE.Vector3(...joint.axis).applyQuaternion(state.baseQuaternion);
  return target.copy(state.basePosition).addScaledVector(axis, value - joint.rest);
}

function jointQuaternionAt(
  state: JointState,
  value: number,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  const joint = state.public;
  const delta = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...joint.axis),
    value - joint.rest,
  );
  return target.copy(state.baseQuaternion).multiply(delta).normalize();
}

function openTarget(joint: ResolvedArticulationJoint): number {
  if (!joint.limits) return joint.rest;
  const toMin = Math.abs(joint.limits.min - joint.rest);
  const toMax = Math.abs(joint.limits.max - joint.rest);
  return toMax >= toMin ? joint.limits.max : joint.limits.min;
}

/**
 * Small runtime API for a loaded GLB or a live procedural model.
 * All values are absolute: radians for rotation and metres for translation.
 */
export class ArticulationController {
  readonly root: THREE.Object3D;
  readonly assetId: string;
  readonly joints: readonly ResolvedArticulationJoint[];

  private readonly states: readonly JointState[];
  private readonly statesById: ReadonlyMap<string, JointState>;

  constructor(root: THREE.Object3D) {
    const resolved = resolveJointStates(root);
    if (!resolved) throw new Error(`No ${CITY_ASSET_EXTRAS_KEY} contract found below "${root.name}".`);
    this.root = resolved.assetRoot;
    this.assetId = resolved.contract.assetId;
    this.states = resolved.states;
    this.joints = resolved.states.map((state) => state.public);
    this.statesById = new Map(resolved.states.map((state) => [state.public.id, state]));
  }

  getJoint(id: string): ResolvedArticulationJoint | undefined {
    return this.statesById.get(id)?.public;
  }

  setJoint(id: string, value: number): this {
    const state = this.statesById.get(id);
    if (!state) throw new Error(`Unknown joint "${id}" on asset "${this.assetId}".`);
    const clamped = clampJointValue(state.public, value);
    if (state.public.kind === 'prismatic') {
      jointPositionAt(state, clamped, state.public.node.position);
    } else {
      jointQuaternionAt(state, clamped, state.public.node.quaternion);
    }
    state.public.node.updateMatrix();
    return this;
  }

  /** Maps 0..1 from the lower to the upper declared limit. */
  setJointNormalized(id: string, amount: number): this {
    const state = this.statesById.get(id);
    if (!state) throw new Error(`Unknown joint "${id}" on asset "${this.assetId}".`);
    if (!state.public.limits) throw new Error(`Joint "${id}" has no finite normalized range.`);
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    return this.setJoint(id, THREE.MathUtils.lerp(state.public.limits.min, state.public.limits.max, t));
  }

  /** Sets every rolling wheel from an absolute travelled distance in metres. */
  rotateWheels(distanceMetres: number): this {
    if (!Number.isFinite(distanceMetres)) throw new Error('Wheel distance must be finite.');
    for (const state of this.states) {
      const joint = state.public;
      if (joint.role !== 'wheel-roll' || !joint.radiusMetres) continue;
      this.setJoint(joint.id, joint.rest + distanceMetres / joint.radiusMetres);
    }
    return this;
  }

  /** Opens all door and gate joints together; amount is clamped to 0..1. */
  openDoors(amount: number): this {
    if (!Number.isFinite(amount)) throw new Error('Door amount must be finite.');
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const state of this.states) {
      const joint = state.public;
      if (joint.role !== 'door' && joint.role !== 'gate') continue;
      this.setJoint(joint.id, THREE.MathUtils.lerp(joint.rest, openTarget(joint), t));
    }
    return this;
  }

  reset(): this {
    for (const state of this.states) this.setJoint(state.public.id, state.public.rest);
    return this;
  }
}

export function createArticulationController(root: THREE.Object3D): ArticulationController {
  return new ArticulationController(root);
}

/** Creates one independent controller per articulated asset below a composite root. */
export function createArticulationControllers(root: THREE.Object3D): ArticulationController[] {
  return findArticulationRoots(root).map((assetRoot) => new ArticulationController(assetRoot));
}

export interface StandardArticulationClipOptions {
  /** Duration of one rest → limit → rest cycle. */
  duration?: number;
  /** Prefix used for stable glTF animation names. */
  namePrefix?: string;
}

/**
 * Creates one portable glTF-compatible clip per joint. The tracks use UUIDs
 * only while exporting; GLTFExporter converts them to node indices in the GLB.
 */
export function createStandardArticulationClips(
  root: THREE.Object3D,
  options: StandardArticulationClipOptions = {},
): THREE.AnimationClip[] {
  const assetRoots = findArticulationRoots(root);
  if (!assetRoots.length) return [];
  const duration = options.duration ?? 2;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Clip duration must be positive.');
  const prefix = options.namePrefix ?? 'city-joint';
  const clips: THREE.AnimationClip[] = [];
  const instanceIndexByAssetId = new Map<string, number>();

  for (const assetRoot of assetRoots) {
    const resolved = resolveJointStatesForAssetRoot(assetRoot);
    const instanceIndex = instanceIndexByAssetId.get(resolved.contract.assetId) ?? 0;
    instanceIndexByAssetId.set(resolved.contract.assetId, instanceIndex + 1);
    const assetNamespace = encodeURIComponent(resolved.contract.assetId);

    for (const state of resolved.states) {
      const joint = state.public;
      let times: number[];
      let values: number[];
      if (joint.kind === 'continuous') {
        times = [0, .25 * duration, .5 * duration, .75 * duration, duration];
        values = [0, .5 * Math.PI, Math.PI, 1.5 * Math.PI, 2 * Math.PI]
          .map((offset) => joint.rest + offset);
      } else {
        times = [0, .5 * duration, duration];
        values = [joint.rest, openTarget(joint), joint.rest];
      }

      let track: THREE.KeyframeTrack;
      if (joint.kind === 'prismatic') {
        const samples = values.flatMap((value) => jointPositionAt(state, value).toArray());
        track = new THREE.VectorKeyframeTrack(`${joint.node.uuid}.position`, times, samples);
      } else {
        const samples = values.flatMap((value) => jointQuaternionAt(state, value).toArray());
        track = new THREE.QuaternionKeyframeTrack(`${joint.node.uuid}.quaternion`, times, samples);
      }
      const clipName = assetRoots.length === 1
        ? `${prefix}:${joint.id}`
        : `${prefix}:${assetNamespace}:${instanceIndex}:${joint.id}`;
      clips.push(new THREE.AnimationClip(clipName, duration, [track]));
    }
  }
  return clips;
}

/**
 * Runs export work with every articulated node at its authored rest pose, then
 * restores the live pose. This keeps the GLB's default transforms consistent
 * with the absolute joint contract even when the editor is currently posed.
 */
export async function withArticulationsAtRest<T>(
  root: THREE.Object3D,
  work: () => Promise<T>,
): Promise<T> {
  const states = findArticulationRoots(root)
    .flatMap((assetRoot) => resolveJointStatesForAssetRoot(assetRoot).states);
  if (!states.length) return work();
  const livePoses = new Map<THREE.Object3D, JointRestPose>();
  for (const state of states) {
    const node = state.public.node;
    if (!livePoses.has(node)) {
      livePoses.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone() });
    }
    if (state.public.kind === 'prismatic') {
      jointPositionAt(state, state.public.rest, node.position);
    } else {
      jointQuaternionAt(state, state.public.rest, node.quaternion);
    }
    node.updateMatrix();
  }
  root.updateMatrixWorld(true);
  try {
    return await work();
  } finally {
    for (const [node, pose] of livePoses) {
      node.position.copy(pose.position);
      node.quaternion.copy(pose.quaternion);
      node.updateMatrix();
    }
    root.updateMatrixWorld(true);
  }
}

/**
 * Clones a tree while retaining only public, JSON-safe glTF extras. The live
 * tree is restored synchronously even when Object3D.clone() throws. Authored
 * joint rest transforms are copied alongside the hierarchy without being
 * serialized into glTF extras.
 */
export function cloneWithPublicGltfExtras<T extends THREE.Object3D>(root: T): T {
  const userData = new Map<THREE.Object3D, Record<string, unknown>>();
  const sourceNodes: THREE.Object3D[] = [];
  root.traverse((object) => {
    sourceNodes.push(object);
    if (!object.userData || Object.keys(object.userData).length === 0) return;
    userData.set(object, object.userData);
    object.userData = extractPublicGltfExtras(object.userData);
  });
  try {
    const clone = root.clone(true) as T;
    const clonedNodes: THREE.Object3D[] = [];
    clone.traverse((object) => clonedNodes.push(object));
    if (clonedNodes.length !== sourceNodes.length) {
      throw new Error('Object3D clone changed traversal shape while copying articulation rest poses.');
    }
    for (let index = 0; index < sourceNodes.length; index += 1) {
      const pose = jointRestPoses.get(sourceNodes[index]);
      if (!pose) continue;
      jointRestPoses.set(clonedNodes[index], {
        position: pose.position.clone(),
        quaternion: pose.quaternion.clone(),
      });
    }
    return clone;
  } finally {
    for (const [object, data] of userData) object.userData = data;
  }
}

/** Returns a JSON-safe allow-list of metadata intended for glTF `extras`. */
export function extractPublicGltfExtras(userData: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_GLTF_EXTRAS_KEYS) {
    const value = userData[key];
    if (value === undefined) continue;
    try {
      result[key] = JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
      // Internal authoring data must never make an otherwise valid export fail.
    }
  }
  return result;
}
