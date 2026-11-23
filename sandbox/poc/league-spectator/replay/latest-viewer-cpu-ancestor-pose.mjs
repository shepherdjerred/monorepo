import { sampleAnimationFrame } from "./latest-animation.mjs";
import { assertLatestViewerOrdinalJoints } from "./latest-viewer-ordinal-joints.mjs";

function jointDefaults(entry) {
  return Object.hasOwn(entry, "poseJoints")
    ? assertLatestViewerOrdinalJoints(entry)
    : entry.jointMap.values();
}

// Isolated CPU experiment: callers must supply the shared sampler's resolved
// layers and an independently owned hierarchy. No graph, clock, lifecycle or
// attachment-key resolution is replaced here. Every active track still passes
// the full sampler's validation; only unrelated transform writes are omitted.
export function createLatestViewerCpuAncestorPose({
  THREE,
  entry,
  attachmentNames,
}) {
  if (
    !entry?.group ||
    !(entry.jointMap instanceof Map) ||
    !(entry.poseAssets instanceof Map) ||
    !Array.isArray(entry.catalog?.joints) ||
    !Array.isArray(attachmentNames)
  )
    throw Error("Owned CPU hierarchy and explicit attachment names required");
  const defaults = [...jointDefaults(entry)],
    ordinal = Object.hasOwn(entry, "poseJoints") ? defaults : null,
    nodes = new Set(),
    parents = new Map(),
    targets = new Set();
  for (const name of attachmentNames) {
    const target = entry.jointMap.get(name)?.node;
    if (!target) throw Error("CPU attachment is outside the viewer hierarchy");
    targets.add(target);
    const path = new Set();
    let node = target;
    while (node !== entry.group) {
      if (!node || path.has(node))
        throw Error("CPU attachment ancestor is outside the owned hierarchy");
      path.add(node);
      nodes.add(node);
      parents.set(node, node.parent);
      node = node.parent;
    }
  }
  const selected = defaults.filter((joint) => nodes.has(joint.node)),
    quaternionA = new THREE.Quaternion(),
    quaternionB = new THREE.Quaternion(),
    vectorA = new THREE.Vector3(),
    vectorB = new THREE.Vector3();
  let closed = false;
  function active() {
    if (closed) throw Error("CPU ancestor pose owner is closed");
    // Ordinal handles remain owned, and topology changes cannot silently make
    // an omitted joint relevant to an already compiled ancestor path.
    jointDefaults(entry);
    for (const [node, parent] of parents)
      if (node.parent !== parent)
        throw Error("Owned CPU attachment ancestor topology changed");
  }
  return Object.freeze({
    counts: Object.freeze({
      poseJoints: defaults.length,
      selectedPoseJoints: selected.length,
      ancestorNodes: nodes.size,
      attachments: targets.size,
    }),
    apply(layers) {
      active();
      if (!Array.isArray(layers))
        throw Error("Resolved viewer layers required");
      for (const joint of selected) {
        joint.node.position.copy(joint.position);
        joint.node.quaternion.copy(joint.quaternion);
        joint.node.scale.copy(joint.scale);
      }
      for (const layer of layers) {
        const pose = entry.poseAssets.get(layer.file);
        if (!pose) throw Error(`Atomic viewer pose not loaded: ${layer.file}`);
        for (const track of pose.tracks) {
          const amount =
            (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
          if (amount === 0) continue;
          if (!Number.isFinite(amount) || amount < 0 || amount > 1)
            throw Error("Invalid viewer pose layer weight");
          const node = ordinal
            ? ordinal[track.jointId]?.node
            : entry.jointMap.get(track.bone)?.node;
          if (!node || entry.catalog.joints[track.jointId] !== track.bone)
            throw Error("Viewer clip and hierarchy differ");
          const sample = sampleAnimationFrame(
            track,
            layer.sourceFrame === null || layer.sourceFrame === undefined
              ? layer.phase * pose.fps
              : layer.sourceFrame,
          );
          if (track.channel === "quaternion") {
            if (!nodes.has(node)) continue;
            quaternionA.fromArray(sample.a);
            quaternionB.fromArray(sample.b);
            quaternionA.slerp(quaternionB, sample.fraction);
            node.quaternion.slerp(quaternionA, amount);
          } else if (["position", "scale"].includes(track.channel)) {
            if (!nodes.has(node)) continue;
            vectorA.fromArray(sample.a);
            vectorB.fromArray(sample.b);
            vectorA.lerp(vectorB, sample.fraction);
            node[track.channel].lerp(vectorA, amount);
          } else throw Error("Unsupported viewer pose channel");
        }
      }
    },
    updateWorldMatrices() {
      active();
      // updateParents includes every nonjoint GLB container and the external
      // reflected/scaled parent. updateChildren stays false on the CPU path.
      entry.group.updateWorldMatrix(true, false);
      for (const target of targets) target.updateWorldMatrix(true, false);
    },
    close() {
      closed = true;
      entry = null;
      nodes.clear();
      parents.clear();
      targets.clear();
      selected.length = 0;
      defaults.length = 0;
    },
  });
}
