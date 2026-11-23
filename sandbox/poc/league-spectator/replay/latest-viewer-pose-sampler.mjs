import { createLatestViewerCpuAncestorPose } from "./latest-viewer-cpu-ancestor-pose.mjs";
import { sampleAnimationFrame } from "./latest-animation.mjs";
import { sampleLatestDeathPosePreview } from "./latest-lifecycle.mjs";
import { createLatestViewerPoseEventIndex } from "./latest-viewer-pose-event-index.mjs";
import { assertLatestViewerOrdinalJoints } from "./latest-viewer-ordinal-joints.mjs";
import { latestViewerPoseAvailability } from "./latest-viewer-pose-availability.mjs";

// Shared absolute-time animation sampling for visible actors and independently
// owned CPU attachment hierarchies. Camera redraws do not advance this state.
export const VIEWER_POSE_POLICY = "same-viewer-actor-pose-v1";
export function viewerPoseJointDefaults(entry) {
  return Object.hasOwn(entry, "poseJoints")
    ? assertLatestViewerOrdinalJoints(entry)
    : entry.jointMap.values();
}
export function applyLatestViewerPoseLayer(
  entry,
  layer,
  { quaternionA, quaternionB, vectorA, vectorB },
) {
  const pose = entry.poseAssets.get(layer.file);
  if (!pose) throw Error(`Atomic viewer pose not loaded: ${layer.file}`);
  const poseJoints = Object.hasOwn(entry, "poseJoints")
    ? assertLatestViewerOrdinalJoints(entry)
    : null;
  for (const track of pose.tracks) {
    const amount =
      (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
    if (amount === 0) continue;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1)
      throw Error("Invalid viewer pose layer weight");
    const node = poseJoints
      ? poseJoints[track.jointId]?.node
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
      quaternionA.fromArray(sample.a);
      quaternionB.fromArray(sample.b);
      quaternionA.slerp(quaternionB, sample.fraction);
      node.quaternion.slerp(quaternionA, amount);
    } else if (["position", "scale"].includes(track.channel)) {
      vectorA.fromArray(sample.a);
      vectorB.fromArray(sample.b);
      vectorA.lerp(vectorB, sample.fraction);
      node[track.channel].lerp(vectorA, amount);
    } else throw Error("Unsupported viewer pose channel");
  }
}
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const vector = (value, size) =>
  Array.isArray(value) &&
  value.length === size &&
  Array.from(value).every(
    (n) =>
      typeof n === "number" &&
      Number.isFinite(n) &&
      Number.isFinite(Math.fround(n)),
  );
function cursorValue(cursor) {
  if (cursor === null) return;
  if (
    !cursor ||
    !Number.isSafeInteger(cursor.transportSequence) ||
    cursor.transportSequence < 0 ||
    !Number.isSafeInteger(cursor.entryOrder) ||
    cursor.entryOrder < 0 ||
    (cursor.exclusive !== undefined && typeof cursor.exclusive !== "boolean")
  )
    throw Error("Exact nonnegative viewer-pose cursor required");
}
function eventOrdinal(event) {
  const source = event.sourceEvent ?? event;
  return {
    transportSequence: event.transportSequence ?? source.transportSequence,
    entryOrder: event.entryOrder ?? source.entryOrder,
  };
}
function hasOrdinal(event) {
  const ordinal = eventOrdinal(event);
  return (
    Number.isSafeInteger(ordinal.transportSequence) &&
    ordinal.transportSequence >= 0 &&
    Number.isSafeInteger(ordinal.entryOrder) &&
    ordinal.entryOrder >= 0
  );
}
function hasPacket(event) {
  const value = eventOrdinal(event).transportSequence;
  return Number.isSafeInteger(value) && value >= 0;
}
function causalTieOrder(a, b) {
  if (!hasPacket(a) || !hasPacket(b)) return null;
  const x = eventOrdinal(a),
    y = eventOrdinal(b);
  if (x.transportSequence !== y.transportSequence)
    return x.transportSequence - y.transportSequence;
  return hasOrdinal(a) && hasOrdinal(b) ? x.entryOrder - y.entryOrder : null;
}
function causalOrder(a, b) {
  if (a.time !== b.time) return a.time - b.time;
  return causalTieOrder(a, b) ?? a.sequence - b.sequence;
}
function sampleLayers(entry, eventIndex, plans, time, moving, life, cursor) {
  const selection = eventIndex.select(moving ? 1 : 0, time, cursor);
  if (!selection.resolved) return selection;
  const death = sampleLatestDeathPosePreview(entry.graph, life, time);
  if (death) {
    if (death.leaves.length !== 1)
      throw Error("Viewer death preview requires one atomic layer");
    return {
      resolved: true,
      layers: death.leaves.map((leaf) => ({ ...leaf, event: null })),
      death: true,
    };
  }
  const compiled = plans[moving ? 1 : 0];
  const layers = entry.graph
    .evaluate(compiled.preview, time % compiled.duration, { moving })
    .leaves.map((leaf) => ({ ...leaf, event: null }));
  const active = [];
  for (const [track, event] of selection.ownership) {
    if (event.rate <= 0) continue;
    for (const leaf of entry.graph.evaluate(
      event.name,
      (time - event.time) * event.rate,
      { moving },
    ).leaves)
      if (leaf.track === track) active.push({ ...leaf, event });
  }
  active.sort(
    (a, b) => b.priority - a.priority || causalOrder(a.event, b.event),
  );
  return { resolved: true, layers: [...layers, ...active], death: false };
}

// entry is an owned GLTF hierarchy with the exact defaults/clips used by the
// viewer. THREE is injected so workers and rendering use the same pinned math.
export function createLatestViewerPoseSampler({
  THREE,
  entry,
  entityId,
  bindings,
  cpuAttachmentsOnly = false,
}) {
  if (
    !uint(entityId) ||
    !entityId ||
    !entry?.group ||
    !(entry.jointMap instanceof Map) ||
    !(entry.poseAssets instanceof Map) ||
    typeof entry.graph?.evaluate !== "function" ||
    !Array.isArray(entry.catalog?.joints) ||
    !Array.isArray(entry.events) ||
    !Array.isArray(bindings)
  )
    throw Error(
      "Owned viewer hierarchy, clips and installed rig bindings required",
    );
  if (Object.hasOwn(entry, "poseJoints"))
    assertLatestViewerOrdinalJoints(entry);
  const events = structuredClone(entry.events).sort(causalOrder);
  for (const event of events)
    if (
      !Number.isFinite(event.time) ||
      !Number.isSafeInteger(event.sequence) ||
      !Number.isFinite(event.rate) ||
      typeof event.name !== "string"
    )
      throw Error("Invalid viewer animation event");
  for (let index = 1; index < events.length; index++)
    if (
      events[index].time === events[index - 1].time &&
      hasOrdinal(events[index]) &&
      hasOrdinal(events[index - 1]) &&
      causalOrder(events[index], events[index - 1]) === 0
    )
      throw Error("Duplicate viewer animation causal ordinal");
  const keyMap = new Map();
  // Prepared graph evaluation at clock0 depends only on the moving context.
  // Compile track ownership once, rather than reevaluating every historical
  // animation graph during each effect's world query. Active clocks still run.
  const baseStateAvailability = latestViewerPoseAvailability(
    entry.previewNames,
  );
  const plans =
    baseStateAvailability.status === "unavailable"
      ? null
      : [false, true].map((moving) => {
          const preview = entry.previewNames[moving ? "run" : "idle"];
          const initial = entry.graph.evaluate(preview, 0, { moving });
          if (initial.unresolved.length || !(initial.duration > 0))
            throw Error("Unprepared viewer preview clock");
          return {
            preview,
            duration: initial.duration,
            tracks: new Map(
              events.map((event) => [
                event,
                entry.graph
                  .evaluate(event.name, 0, { moving })
                  .leaves.map((leaf) => leaf.track),
              ]),
            ),
          };
        });
  const eventIndex =
    plans === null
      ? null
      : createLatestViewerPoseEventIndex({
          events,
          plans,
          eventOrdinal,
          causalTieOrder,
        });
  for (const binding of structuredClone(bindings)) {
    if (
      !uint(binding.resolvedBoneKey) ||
      binding.resolvedBoneKey === 0 ||
      !Number.isInteger(binding.keyPoseIndex) ||
      binding.keyPoseIndex < 0 ||
      binding.keyPoseIndex !== binding.nativePoseIndex ||
      entry.catalog.joints[binding.poseJointIndex] !== binding.name ||
      !entry.jointMap.has(binding.name)
    )
      throw Error("Exact installed key/native/catalog pose mapping required");
    const previous = keyMap.get(binding.resolvedBoneKey);
    if (
      previous &&
      (previous.keyPoseIndex !== binding.keyPoseIndex ||
        previous.poseJointIndex !== binding.poseJointIndex)
    )
      throw Error("Ambiguous installed pose key");
    keyMap.set(binding.resolvedBoneKey, binding);
  }
  const quaternionA = new THREE.Quaternion(),
    quaternionB = new THREE.Quaternion(),
    vectorA = new THREE.Vector3(),
    vectorB = new THREE.Vector3();
  const inverseParent = new THREE.Matrix4(),
    relative = new THREE.Matrix4(),
    rotation = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    orientation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  let cpuPose = null,
    cpuNames = null;
  function applyCpuPlan(plan, keys) {
    const names = [
      ...new Set(
        keys.filter((key) => key !== 0).map((key) => keyMap.get(key).name),
      ),
    ];
    if (
      !cpuNames ||
      names.length !== cpuNames.length ||
      names.some((name, index) => name !== cpuNames[index])
    ) {
      cpuPose?.close();
      cpuPose = createLatestViewerCpuAncestorPose({
        THREE,
        entry,
        attachmentNames: names,
      });
      cpuNames = names;
    }
    cpuPose.apply(plan.layers);
  }
  function apply(layer) {
    applyLatestViewerPoseLayer(entry, layer, {
      quaternionA,
      quaternionB,
      vectorA,
      vectorB,
    });
  }
  function applyPlan(plan) {
    for (const joint of viewerPoseJointDefaults(entry)) {
      joint.node.position.copy(joint.position);
      joint.node.quaternion.copy(joint.quaternion);
      joint.node.scale.copy(joint.scale);
    }
    for (const layer of plan.layers) apply(layer);
  }
  function unavailable(time, cursor) {
    return {
      resolved: false,
      policy: VIEWER_POSE_POLICY,
      entityId,
      time,
      cursor: structuredClone(cursor),
      reasons: ["pose:base-animation-state-program-unavailable"],
      unavailableBaseStates: [...baseStateAvailability.unavailableBaseStates],
      nativeAcceptance: null,
      nativePoseParity: null,
    };
  }
  return Object.freeze({
    policy: VIEWER_POSE_POLICY,
    baseStateAvailability,
    applyLocalPose({ time, cursor = null, moving, life }) {
      cursorValue(cursor);
      if (
        !Number.isFinite(time) ||
        time < 0 ||
        typeof moving !== "boolean" ||
        typeof life?.dead !== "boolean"
      )
        throw Error("Explicit local viewer pose clock/lifecycle required");
      if (plans === null) return unavailable(time, cursor);
      const plan = sampleLayers(
        entry,
        eventIndex,
        plans,
        time,
        moving,
        life,
        cursor,
      );
      if (!plan.resolved) return { ...plan, policy: VIEWER_POSE_POLICY };
      applyPlan(plan);
      return {
        resolved: true,
        policy: VIEWER_POSE_POLICY,
        localPoseOnly: true,
        layers: structuredClone(plan.layers),
        deathPreview: plan.death,
      };
    },
    sample({
      time,
      cursor = null,
      root,
      viewerYawInput,
      moving,
      life,
      attachmentKeys,
      rootOnly = false,
    }) {
      cursorValue(cursor);
      if (
        !Number.isFinite(time) ||
        time < 0 ||
        !Array.isArray(attachmentKeys) ||
        Array.from(attachmentKeys).some((key) => !uint(key)) ||
        !root ||
        root.entityId !== entityId ||
        root.nativeAcceptance !== null ||
        !life ||
        typeof life.dead !== "boolean" ||
        typeof moving !== "boolean" ||
        typeof rootOnly !== "boolean"
      )
        throw Error(
          "Explicit viewer pose time/identity/lifecycle inputs required",
        );
      if (
        rootOnly &&
        (!attachmentKeys.length || attachmentKeys.some((key) => key !== 0))
      )
        throw Error("Root-only pose sampling requires only actor-root keys");
      if (!root.resolved || !vector(root.position, 3))
        return {
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: ["pose:viewer-root-unresolved"],
        };
      if (
        viewerYawInput?.status !== "movement-derived-preview" ||
        !vector(viewerYawInput.direction, 2) ||
        viewerYawInput.direction.every((value) => value === 0)
      )
        return {
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: ["pose:viewer-actor-orientation-unresolved"],
        };
      const missing = attachmentKeys.filter((key) => key && !keyMap.has(key));
      if (missing.length)
        return {
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: missing.map((key) => `pose:installed-key-unresolved:${key}`),
        };
      if (plans === null) return unavailable(time, cursor);
      const plan = sampleLayers(
        entry,
        eventIndex,
        plans,
        time,
        moving,
        life,
        cursor,
      );
      if (!plan.resolved) return { ...plan, policy: VIEWER_POSE_POLICY };
      if (!rootOnly) {
        if (cpuAttachmentsOnly) applyCpuPlan(plan, attachmentKeys);
        else applyPlan(plan);
      }
      entry.group.position.fromArray(root.position);
      let yaw = Math.atan2(
        viewerYawInput.direction[0],
        viewerYawInput.direction[1],
      );
      for (const layer of plan.layers) {
        if (layer.event?.sourceKind === "attack") {
          const target = layer.event.sourceEvent?.targetPosition;
          if (!vector(target, 3))
            throw Error("Finite recorded viewer attack target required");
          const dx = target[0] - root.position[0],
            dz = target[2] - root.position[2];
          if (
            (target[0] !== 0 || target[2] !== 0) &&
            Math.hypot(dx, dz) > 0.001
          )
            yaw = Math.atan2(dx, dz);
        }
      }
      entry.group.rotation.set(0, yaw, 0);
      if (!rootOnly) {
        if (cpuAttachmentsOnly) cpuPose.updateWorldMatrices();
        else entry.group.updateWorldMatrix(true, true);
        if (entry.group.parent)
          inverseParent.copy(entry.group.parent.matrixWorld).invert();
        else inverseParent.identity();
      }
      const attachments = attachmentKeys.map((key) => {
        const binding = key ? keyMap.get(key) : null;
        if (binding) {
          relative.multiplyMatrices(
            inverseParent,
            entry.jointMap.get(binding.name).node.matrixWorld,
          );
          relative.decompose(position, orientation, scale);
        } else {
          position.copy(entry.group.position);
          orientation.copy(entry.group.quaternion);
          scale.copy(entry.group.scale);
        }
        // Scaled hierarchy positions and unit rotation are separate inputs.
        // This is explicitly the viewer's decomposition, not native T/S/Q parity.
        if (
          !Number.isFinite(orientation.lengthSq()) ||
          orientation.lengthSq() === 0
        )
          return { key, resolved: false };
        orientation.normalize();
        rotation.makeRotationFromQuaternion(orientation);
        const matrix = rotation.elements;
        return {
          key,
          name: binding?.name ?? null,
          nativePoseIndex: binding?.keyPoseIndex ?? null,
          position: position.toArray(),
          quaternion: orientation.toArray(),
          basis: [
            matrix[0],
            matrix[1],
            matrix[2],
            matrix[4],
            matrix[5],
            matrix[6],
            matrix[8],
            matrix[9],
            matrix[10],
          ],
          hierarchyScale: scale.toArray(),
        };
      });
      if (
        attachments.some(
          (value) =>
            value.resolved === false ||
            !vector(value.position, 3) ||
            !vector(value.quaternion, 4) ||
            !vector(value.basis, 9),
        )
      )
        return {
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: ["pose:degenerate-viewer-transform"],
        };
      return {
        resolved: true,
        policy: VIEWER_POSE_POLICY,
        entityId,
        time,
        cursor: structuredClone(cursor),
        attachments,
        deathPreview: plan.death,
        rootInput: structuredClone(root),
        viewerYawInput: structuredClone(viewerYawInput),
        layers: structuredClone(plan.layers),
        nativeAcceptance: null,
        nativePoseParity: null,
        omissions: [
          "pose:native-graph-transitions-and-blending-unrecovered",
          "pose:native-interpolation-parity-unestablished",
          "pose:dynamic-bones-forms-proxies-and-overrides-unrecovered",
          "pose:provider-lifecycle-and-native-collision-unrecovered",
          "pose:death-submesh-visibility-not-applied-by-sampler",
        ],
      };
    },
  });
}
