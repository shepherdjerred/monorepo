// Diagnostic-only copy of the pre-shared viewer planner and joint application.
// It intentionally evaluates every past event on every frame, independently of
// the production sampler's static track/clock compilation and root-only path.
import { sampleAnimationFrame } from "../latest-animation.mjs";
import { sampleLatestDeathPosePreview } from "../latest-lifecycle.mjs";
export function applyOriginalViewerPose(
  THREE,
  entry,
  time,
  moving,
  life,
  root,
  direction,
) {
  const qa = new THREE.Quaternion(),
    qb = new THREE.Quaternion(),
    va = new THREE.Vector3(),
    vb = new THREE.Vector3();
  const apply = (layer) => {
    const pose = entry.poseAssets.get(layer.file);
    for (const track of pose.tracks) {
      const amount =
        (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
      if (amount === 0) continue;
      const node = entry.jointMap.get(track.bone).node,
        sample = sampleAnimationFrame(
          track,
          layer.sourceFrame ?? layer.phase * pose.fps,
        );
      if (track.channel === "quaternion") {
        qa.fromArray(sample.a);
        qb.fromArray(sample.b);
        qa.slerp(qb, sample.fraction);
        node.quaternion.slerp(qa, amount);
      } else {
        va.fromArray(sample.a);
        vb.fromArray(sample.b);
        va.lerp(vb, sample.fraction);
        node[track.channel].lerp(va, amount);
      }
    }
  };
  entry.group.position.fromArray(root.position);
  entry.group.rotation.y = Math.atan2(direction[0], direction[1]);
  for (const joint of entry.jointMap.values()) {
    joint.node.position.copy(joint.position);
    joint.node.quaternion.copy(joint.quaternion);
    joint.node.scale.copy(joint.scale);
  }
  const death = sampleLatestDeathPosePreview(entry.graph, life, time);
  if (death) {
    for (const leaf of death.leaves) apply(leaf);
  } else {
    const name = entry.previewNames[moving ? "run" : "idle"],
      initial = entry.graph.evaluate(name, 0, { moving });
    for (const leaf of entry.graph.evaluate(name, time % initial.duration, {
      moving,
    }).leaves)
      apply(leaf);
    const layers = new Map();
    for (const event of entry.events) {
      if (event.time > time) break;
      for (const leaf of entry.graph.evaluate(event.name, 0, { moving }).leaves)
        layers.set(leaf.track, event);
    }
    const active = [];
    for (const [track, event] of layers) {
      if (event.rate <= 0) continue;
      for (const leaf of entry.graph.evaluate(
        event.name,
        (time - event.time) * event.rate,
        { moving },
      ).leaves)
        if (leaf.track === track) active.push({ ...leaf, event });
    }
    active.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.event.time - b.event.time ||
        a.event.sequence - b.event.sequence,
    );
    for (const leaf of active) {
      apply(leaf);
      if (leaf.event.sourceKind === "attack") {
        const target = leaf.event.sourceEvent.targetPosition,
          dx = target[0] - root.position[0],
          dz = target[2] - root.position[2];
        if ((target[0] !== 0 || target[2] !== 0) && Math.hypot(dx, dz) > 0.001)
          entry.group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
  entry.group.updateWorldMatrix(true, true);
}
