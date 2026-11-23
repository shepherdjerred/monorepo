import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-bindings.mjs";

const prepared = new WeakMap(),
  boundJointSets = new WeakMap();
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

function modelDefinition(bytes) {
  if (bytes.length < 20) throw Error("Complete ordinal GLB2 model required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(12, true) > bytes.length - 20
  )
    throw Error("Exact ordinal GLB2 model header required");
  return decode(bytes.subarray(20, 20 + view.getUint32(12, true)));
}

// Preparing is asynchronous, but each rendered/CPU instance binds synchronously.
// Pose ordinals include every original joint. Name/hash attachment lookups use
// the separately constructed native rig, including its original alias winner.
export async function prepareLatestViewerOrdinalJoints({
  modelBytes,
  rigBytes,
  bindingBytes,
  catalog,
  rigBindings,
}) {
  const model = ownLatestStaticBytes(modelBytes),
    rig = ownLatestStaticBytes(rigBytes),
    bindings = decode(ownLatestStaticBytes(bindingBytes)),
    catalogSchema = catalog?.schema,
    jointNames = structuredClone(catalog?.joints),
    resolveRig = rigBindings?.resolve?.bind(rigBindings);
  const [modelHash, rigHash] = await Promise.all([sha256(model), sha256(rig)]);
  if (
    bindings.modelSha256 !== modelHash ||
    bindings.rigSha256 !== rigHash ||
    catalogSchema !== 1 ||
    !Array.isArray(jointNames) ||
    typeof resolveRig !== "function"
  )
    throw Error(
      "Original model/rig identities and native name bindings required",
    );
  const gltf = modelDefinition(model),
    source = readOriginalRigOrdinalSource(rig),
    layout = validateOrdinalModelLayout({ bindings, gltf, ...source });
  if (
    jointNames.length !== source.sourceJoints.length ||
    jointNames.some((name, index) => name !== source.sourceJoints[index].name)
  )
    throw Error("Ordinal viewer catalog differs from original rig order");
  const attachments = new Map();
  for (let index = 0; index < jointNames.length; index++) {
    const name = jointNames[index],
      binding = resolveRig(name);
    if (
      binding.status !== "rig-joint" ||
      !Number.isSafeInteger(binding.poseJointIndex) ||
      binding.poseJointIndex < 0 ||
      binding.poseJointIndex >= jointNames.length ||
      !Array.isArray(binding.sourceJointIndices) ||
      !binding.sourceJointIndices.includes(index)
    )
      throw Error(`Unbound original ordinal attachment lookup: ${name}`);
    const prior = attachments.get(name);
    if (prior !== undefined && prior !== binding.poseJointIndex)
      throw Error("Contradictory original name/hash alias winner");
    attachments.set(name, binding.poseJointIndex);
  }
  const handle = Object.freeze({});
  prepared.set(handle, {
    modelSha256: modelHash,
    jointNames,
    nodes: layout.jointNodeIndices.map((nodeIndex, poseJointIndex) => ({
      nodeIndex,
      nodeName: bindings.joints[poseJointIndex].nodeName,
    })),
    attachments,
  });
  return handle;
}

export function bindLatestViewerOrdinalJoints(
  handle,
  { modelSha256, nodeForIndex },
) {
  const source = prepared.get(handle);
  if (
    !source ||
    source.modelSha256 !== modelSha256 ||
    typeof nodeForIndex !== "function"
  )
    throw Error("Owned prepared ordinal viewer rig and node resolver required");
  const seen = new Set();
  const poseJoints = source.nodes.map(({ nodeIndex, nodeName }) => {
    const node = nodeForIndex(nodeIndex, nodeName);
    if (
      !node?.isObject3D ||
      node.name !== nodeName ||
      seen.has(node) ||
      typeof node.position?.clone !== "function" ||
      typeof node.quaternion?.clone !== "function" ||
      typeof node.scale?.clone !== "function"
    )
      throw Error("Rendered hierarchy omitted or aliased an original joint");
    seen.add(node);
    return Object.freeze({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  });
  const jointMap = new Map(
    [...source.attachments].map(([name, index]) => [name, poseJoints[index]]),
  );
  Object.freeze(poseJoints);
  boundJointSets.set(poseJoints, {
    modelSha256: source.modelSha256,
    jointNames: source.jointNames,
  });
  return {
    modelSha256: source.modelSha256,
    poseJoints,
    jointMap,
  };
}

// SkeletonUtils clones retain the exporter's unique ordinal node labels. Bind
// those labels only after the exact source GLB/rig pair was prepared above.
export function bindLatestViewerOrdinalModel(handle, { modelSha256, model }) {
  if (!model?.isObject3D || typeof model.traverse !== "function")
    throw Error("Loaded ordinal Object3D model required");
  const nodes = new Map();
  model.traverse((node) => {
    if (!nodes.has(node.name)) nodes.set(node.name, []);
    nodes.get(node.name).push(node);
  });
  return bindLatestViewerOrdinalJoints(handle, {
    modelSha256,
    nodeForIndex: (_index, name) => {
      const matches = nodes.get(name);
      if (matches?.length !== 1)
        throw Error(`Loaded ordinal model omitted or duplicated joint ${name}`);
      return matches[0];
    },
  });
}

export function assertLatestViewerOrdinalJoints(entry) {
  const owner = boundJointSets.get(entry.poseJoints);
  if (
    !owner ||
    owner.modelSha256 !== entry.modelSha256 ||
    !Array.isArray(entry.catalog?.joints) ||
    entry.catalog.joints.length !== owner.jointNames.length ||
    owner.jointNames.some((name, index) => entry.catalog.joints[index] !== name)
  )
    throw Error(
      "Owned ordinal pose joints must match their model and original catalog",
    );
  return entry.poseJoints;
}
