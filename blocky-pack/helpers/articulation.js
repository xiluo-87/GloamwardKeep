import * as THREE from "three";
const CITY_ASSET_EXTRAS_KEY = "cityAsset";
const CITY_JOINT_EXTRAS_KEY = "cityJoint";
const CITY_SOCKET_EXTRAS_KEY = "citySocket";
const CITY_COLLIDER_EXTRAS_KEY = "cityCollider";
const PUBLIC_GLTF_EXTRAS_KEYS = [
  CITY_ASSET_EXTRAS_KEY,
  CITY_JOINT_EXTRAS_KEY,
  CITY_SOCKET_EXTRAS_KEY,
  CITY_COLLIDER_EXTRAS_KEY
];
const jointRestPoses = /* @__PURE__ */ new WeakMap();
function assertUniqueIds(label, values) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (!value.id.trim()) throw new Error(`${label} id must not be empty.`);
    if (seen.has(value.id)) throw new Error(`Duplicate ${label} id "${value.id}".`);
    seen.add(value.id);
  }
}
function assertNamedNode(label, node) {
  if (!node) throw new Error(`${label} targets a missing Object3D.`);
  if (!node.name?.trim()) throw new Error(`${label} must target a named Object3D.`);
}
function normalizedAxis(axis, jointId) {
  const vector = new THREE.Vector3(...axis);
  if (vector.lengthSq() < 1e-12) throw new Error(`Joint "${jointId}" has a zero-length axis.`);
  vector.normalize();
  return [vector.x, vector.y, vector.z];
}
function attachArticulationContract(root, options) {
  if (!root.name.trim()) throw new Error("An articulated asset root must be named.");
  assertUniqueIds("joint", options.joints);
  assertUniqueIds("socket", options.sockets ?? []);
  assertUniqueIds("collider", options.colliders ?? []);
  const joints = options.joints.map((binding) => {
    assertNamedNode(`Joint "${binding.id}"`, binding.node);
    if (binding.kind !== "continuous") {
      if (!binding.limits || binding.limits.min > binding.limits.max) {
        throw new Error(`Joint "${binding.id}" requires ordered min/max limits.`);
      }
    }
    if (binding.radiusMetres !== void 0 && binding.radiusMetres <= 0) {
      throw new Error(`Joint "${binding.id}" radiusMetres must be positive.`);
    }
    const rest = binding.rest ?? 0;
    if (binding.limits && (rest < binding.limits.min || rest > binding.limits.max)) {
      throw new Error(`Joint "${binding.id}" rest value must be inside its limits.`);
    }
    const joint = {
      id: binding.id,
      node: binding.node.name,
      kind: binding.kind,
      role: binding.role,
      axis: normalizedAxis(binding.axis, binding.id),
      unit: binding.kind === "prismatic" ? "metres" : "radians",
      ...binding.limits ? { limits: { ...binding.limits } } : {},
      ...binding.rest !== void 0 ? { rest: binding.rest } : {},
      ...binding.radiusMetres !== void 0 ? { radiusMetres: binding.radiusMetres } : {}
    };
    binding.node.userData[CITY_JOINT_EXTRAS_KEY] = joint;
    jointRestPoses.set(binding.node, {
      position: binding.node.position.clone(),
      quaternion: binding.node.quaternion.clone()
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
      isTrigger: binding.isTrigger ?? false
    };
    binding.node.userData[CITY_COLLIDER_EXTRAS_KEY] = collider;
    return collider;
  });
  const asset = {
    schema: "city-articulation",
    version: 1,
    assetId: options.assetId,
    assetType: options.assetType,
    articulated: true,
    coordinateSystem: {
      units: "metres",
      up: "+Y",
      forward: "-Z",
      origin: "ground-centre"
    },
    joints,
    sockets,
    colliders
  };
  root.userData[CITY_ASSET_EXTRAS_KEY] = asset;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isJointExtras(value) {
  if (!isRecord(value)) return false;
  const axis = value.axis;
  return typeof value.id === "string" && typeof value.node === "string" && (value.kind === "revolute" || value.kind === "continuous" || value.kind === "prismatic") && typeof value.role === "string" && Array.isArray(axis) && axis.length === 3 && axis.every((component) => typeof component === "number" && Number.isFinite(component));
}
function findArticulationRoots(root) {
  const results = [];
  root.traverse((object) => {
    if (isRecord(object.userData[CITY_ASSET_EXTRAS_KEY])) results.push(object);
  });
  return results;
}
function findArticulationRoot(root) {
  return findArticulationRoots(root)[0] ?? null;
}
function contractOnExactRoot(assetRoot) {
  const value = assetRoot.userData[CITY_ASSET_EXTRAS_KEY];
  if (!isRecord(value) || value.schema !== "city-articulation" || value.version !== 1) return null;
  if (!Array.isArray(value.joints) || !value.joints.every(isJointExtras)) return null;
  return value;
}
function getArticulationContract(root) {
  const assetRoot = findArticulationRoot(root);
  if (!assetRoot) return null;
  return contractOnExactRoot(assetRoot);
}
function resolveJointStatesForAssetRoot(assetRoot) {
  const contract = contractOnExactRoot(assetRoot);
  if (!contract) throw new Error(`Invalid ${CITY_ASSET_EXTRAS_KEY} contract on "${assetRoot.name}".`);
  const nodesByJointId = /* @__PURE__ */ new Map();
  assetRoot.traverse((object) => {
    const extras = object.userData[CITY_JOINT_EXTRAS_KEY];
    if (isJointExtras(extras)) nodesByJointId.set(extras.id, object);
  });
  const states = contract.joints.map((joint) => {
    const node = nodesByJointId.get(joint.id) ?? assetRoot.getObjectByName(joint.node);
    if (!node) throw new Error(`Joint "${joint.id}" targets missing node "${joint.node}".`);
    const savedPose = jointRestPoses.get(node);
    const pose = savedPose ?? {
      position: node.position.clone(),
      quaternion: node.quaternion.clone()
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
        radiusMetres: joint.radiusMetres
      },
      basePosition: pose.position.clone(),
      baseQuaternion: pose.quaternion.clone()
    };
  });
  return { assetRoot, contract, states };
}
function resolveJointStates(root) {
  const assetRoot = findArticulationRoot(root);
  return assetRoot ? resolveJointStatesForAssetRoot(assetRoot) : null;
}
function clampJointValue(joint, value) {
  if (!Number.isFinite(value)) throw new Error(`Joint "${joint.id}" value must be finite.`);
  if (!joint.limits) return value;
  return THREE.MathUtils.clamp(value, joint.limits.min, joint.limits.max);
}
function jointPositionAt(state, value, target = new THREE.Vector3()) {
  const joint = state.public;
  const axis = new THREE.Vector3(...joint.axis).applyQuaternion(state.baseQuaternion);
  return target.copy(state.basePosition).addScaledVector(axis, value - joint.rest);
}
function jointQuaternionAt(state, value, target = new THREE.Quaternion()) {
  const joint = state.public;
  const delta = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...joint.axis),
    value - joint.rest
  );
  return target.copy(state.baseQuaternion).multiply(delta).normalize();
}
function openTarget(joint) {
  if (!joint.limits) return joint.rest;
  const toMin = Math.abs(joint.limits.min - joint.rest);
  const toMax = Math.abs(joint.limits.max - joint.rest);
  return toMax >= toMin ? joint.limits.max : joint.limits.min;
}
class ArticulationController {
  root;
  assetId;
  joints;
  states;
  statesById;
  constructor(root) {
    const resolved = resolveJointStates(root);
    if (!resolved) throw new Error(`No ${CITY_ASSET_EXTRAS_KEY} contract found below "${root.name}".`);
    this.root = resolved.assetRoot;
    this.assetId = resolved.contract.assetId;
    this.states = resolved.states;
    this.joints = resolved.states.map((state) => state.public);
    this.statesById = new Map(resolved.states.map((state) => [state.public.id, state]));
  }
  getJoint(id) {
    return this.statesById.get(id)?.public;
  }
  setJoint(id, value) {
    const state = this.statesById.get(id);
    if (!state) throw new Error(`Unknown joint "${id}" on asset "${this.assetId}".`);
    const clamped = clampJointValue(state.public, value);
    if (state.public.kind === "prismatic") {
      jointPositionAt(state, clamped, state.public.node.position);
    } else {
      jointQuaternionAt(state, clamped, state.public.node.quaternion);
    }
    state.public.node.updateMatrix();
    return this;
  }
  /** Maps 0..1 from the lower to the upper declared limit. */
  setJointNormalized(id, amount) {
    const state = this.statesById.get(id);
    if (!state) throw new Error(`Unknown joint "${id}" on asset "${this.assetId}".`);
    if (!state.public.limits) throw new Error(`Joint "${id}" has no finite normalized range.`);
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    return this.setJoint(id, THREE.MathUtils.lerp(state.public.limits.min, state.public.limits.max, t));
  }
  /** Sets every rolling wheel from an absolute travelled distance in metres. */
  rotateWheels(distanceMetres) {
    if (!Number.isFinite(distanceMetres)) throw new Error("Wheel distance must be finite.");
    for (const state of this.states) {
      const joint = state.public;
      if (joint.role !== "wheel-roll" || !joint.radiusMetres) continue;
      this.setJoint(joint.id, joint.rest + distanceMetres / joint.radiusMetres);
    }
    return this;
  }
  /** Opens all door and gate joints together; amount is clamped to 0..1. */
  openDoors(amount) {
    if (!Number.isFinite(amount)) throw new Error("Door amount must be finite.");
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const state of this.states) {
      const joint = state.public;
      if (joint.role !== "door" && joint.role !== "gate") continue;
      this.setJoint(joint.id, THREE.MathUtils.lerp(joint.rest, openTarget(joint), t));
    }
    return this;
  }
  reset() {
    for (const state of this.states) this.setJoint(state.public.id, state.public.rest);
    return this;
  }
}
function createArticulationController(root) {
  return new ArticulationController(root);
}
function createArticulationControllers(root) {
  return findArticulationRoots(root).map((assetRoot) => new ArticulationController(assetRoot));
}
function createStandardArticulationClips(root, options = {}) {
  const assetRoots = findArticulationRoots(root);
  if (!assetRoots.length) return [];
  const duration = options.duration ?? 2;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Clip duration must be positive.");
  const prefix = options.namePrefix ?? "city-joint";
  const clips = [];
  const instanceIndexByAssetId = /* @__PURE__ */ new Map();
  for (const assetRoot of assetRoots) {
    const resolved = resolveJointStatesForAssetRoot(assetRoot);
    const instanceIndex = instanceIndexByAssetId.get(resolved.contract.assetId) ?? 0;
    instanceIndexByAssetId.set(resolved.contract.assetId, instanceIndex + 1);
    const assetNamespace = encodeURIComponent(resolved.contract.assetId);
    for (const state of resolved.states) {
      const joint = state.public;
      let times;
      let values;
      if (joint.kind === "continuous") {
        times = [0, 0.25 * duration, 0.5 * duration, 0.75 * duration, duration];
        values = [0, 0.5 * Math.PI, Math.PI, 1.5 * Math.PI, 2 * Math.PI].map((offset) => joint.rest + offset);
      } else {
        times = [0, 0.5 * duration, duration];
        values = [joint.rest, openTarget(joint), joint.rest];
      }
      let track;
      if (joint.kind === "prismatic") {
        const samples = values.flatMap((value) => jointPositionAt(state, value).toArray());
        track = new THREE.VectorKeyframeTrack(`${joint.node.uuid}.position`, times, samples);
      } else {
        const samples = values.flatMap((value) => jointQuaternionAt(state, value).toArray());
        track = new THREE.QuaternionKeyframeTrack(`${joint.node.uuid}.quaternion`, times, samples);
      }
      const clipName = assetRoots.length === 1 ? `${prefix}:${joint.id}` : `${prefix}:${assetNamespace}:${instanceIndex}:${joint.id}`;
      clips.push(new THREE.AnimationClip(clipName, duration, [track]));
    }
  }
  return clips;
}
async function withArticulationsAtRest(root, work) {
  const states = findArticulationRoots(root).flatMap((assetRoot) => resolveJointStatesForAssetRoot(assetRoot).states);
  if (!states.length) return work();
  const livePoses = /* @__PURE__ */ new Map();
  for (const state of states) {
    const node = state.public.node;
    if (!livePoses.has(node)) {
      livePoses.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone() });
    }
    if (state.public.kind === "prismatic") {
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
function cloneWithPublicGltfExtras(root) {
  const userData = /* @__PURE__ */ new Map();
  const sourceNodes = [];
  root.traverse((object) => {
    sourceNodes.push(object);
    if (!object.userData || Object.keys(object.userData).length === 0) return;
    userData.set(object, object.userData);
    object.userData = extractPublicGltfExtras(object.userData);
  });
  try {
    const clone = root.clone(true);
    const clonedNodes = [];
    clone.traverse((object) => clonedNodes.push(object));
    if (clonedNodes.length !== sourceNodes.length) {
      throw new Error("Object3D clone changed traversal shape while copying articulation rest poses.");
    }
    for (let index = 0; index < sourceNodes.length; index += 1) {
      const pose = jointRestPoses.get(sourceNodes[index]);
      if (!pose) continue;
      jointRestPoses.set(clonedNodes[index], {
        position: pose.position.clone(),
        quaternion: pose.quaternion.clone()
      });
    }
    return clone;
  } finally {
    for (const [object, data] of userData) object.userData = data;
  }
}
function extractPublicGltfExtras(userData) {
  const result = {};
  for (const key of PUBLIC_GLTF_EXTRAS_KEYS) {
    const value = userData[key];
    if (value === void 0) continue;
    try {
      result[key] = JSON.parse(JSON.stringify(value));
    } catch {
    }
  }
  return result;
}
export {
  ArticulationController,
  CITY_ASSET_EXTRAS_KEY,
  CITY_COLLIDER_EXTRAS_KEY,
  CITY_JOINT_EXTRAS_KEY,
  CITY_SOCKET_EXTRAS_KEY,
  PUBLIC_GLTF_EXTRAS_KEYS,
  attachArticulationContract,
  cloneWithPublicGltfExtras,
  createArticulationController,
  createArticulationControllers,
  createStandardArticulationClips,
  extractPublicGltfExtras,
  findArticulationRoot,
  findArticulationRoots,
  getArticulationContract,
  withArticulationsAtRest
};
