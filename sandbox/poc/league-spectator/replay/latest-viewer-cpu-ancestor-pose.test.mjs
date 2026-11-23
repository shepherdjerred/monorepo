import { expect, test } from "bun:test";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestViewerCpuAncestorPose } from "./latest-viewer-cpu-ancestor-pose.mjs";
import {
  applyLatestViewerPoseLayer,
  viewerPoseJointDefaults,
} from "./latest-viewer-pose-sampler.mjs";

const fixtureInput = process.env.SCOUT_REPLAY_RESEARCH_CACHE;
if (fixtureInput !== undefined && !fixtureInput.trim())
  throw Error("An explicit replay research fixture directory is required");
const cache =
  fixtureInput === undefined
    ? new URL("../../../../.cache/replay-spike/", import.meta.url)
    : pathToFileURL(resolve(fixtureInput) + sep);
const THREE = await import(
  new URL("public/vendor/three.module.js", cache).href
);

function fixture() {
  const external = new THREE.Group(),
    group = new THREE.Group(),
    container = new THREE.Group(),
    ancestor = new THREE.Object3D(),
    nonjoint = new THREE.Group(),
    target = new THREE.Object3D(),
    unrelated = new THREE.Object3D();
  external.scale.set(2, 3, -4);
  external.rotation.set(0.1, 0.2, 0.3);
  external.add(group);
  group.add(container);
  container.scale.setScalar(1.25);
  container.add(ancestor, unrelated);
  ancestor.add(nonjoint);
  nonjoint.position.set(3, 4, 5);
  nonjoint.rotation.set(0.4, 0.2, -0.1);
  nonjoint.add(target);
  const joints = [ancestor, target, unrelated],
    names = ["Parent", "Target", "Unrelated"];
  const jointMap = new Map(
    joints.map((node, index) => [
      names[index],
      {
        node,
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      },
    ]),
  );
  const tracks = joints.flatMap((_, jointId) => [
    {
      jointId,
      bone: names[jointId],
      channel: "position",
      width: 3,
      count: 2,
      values: Float32Array.from([jointId, 2, 3, 4, 5, 6]),
    },
    {
      jointId,
      bone: names[jointId],
      channel: "quaternion",
      width: 4,
      count: 2,
      values: Float32Array.from([0, 0, 0, 1, 0, 0.6, 0, 0.8]),
    },
    {
      jointId,
      bone: names[jointId],
      channel: "scale",
      width: 3,
      count: 2,
      values: Float32Array.from([1, 2, 3, 3, 2, 1]),
    },
  ]);
  return {
    group,
    jointMap,
    catalog: { joints: names },
    poseAssets: new Map([["clip", { fps: 1, tracks }]]),
    unrelated,
    nonjoint,
  };
}
const temporaries = () => ({
  quaternionA: new THREE.Quaternion(),
  quaternionB: new THREE.Quaternion(),
  vectorA: new THREE.Vector3(),
  vectorB: new THREE.Vector3(),
});
function full(entry, layers) {
  for (const joint of viewerPoseJointDefaults(entry)) {
    joint.node.position.copy(joint.position);
    joint.node.quaternion.copy(joint.quaternion);
    joint.node.scale.copy(joint.scale);
  }
  for (const layer of layers)
    applyLatestViewerPoseLayer(entry, layer, temporaries());
  entry.group.updateWorldMatrix(true, true);
}

test("CPU ancestor writes preserve complete matrices through nonjoint parents, masks, layered scales and reverse clocks", () => {
  const baseline = fixture(),
    sparse = fixture(),
    owner = createLatestViewerCpuAncestorPose({
      THREE,
      entry: sparse,
      attachmentNames: ["Target"],
    });
  expect(owner.counts).toEqual({
    poseJoints: 3,
    selectedPoseJoints: 2,
    ancestorNodes: 4,
    attachments: 1,
  });
  for (const phase of [0, 0.25, 0.8, 0.1, 1, 0]) {
    const layers = [
      { file: "clip", phase, weight: 1, weights: [0.3, 1, 0.7] },
      {
        file: "clip",
        sourceFrame: 1 - phase,
        weight: 0.25,
        weights: [1, 0.5, 1],
      },
    ];
    for (const entry of [baseline, sparse]) {
      entry.group.position.set(phase, -2, 10);
      entry.group.rotation.set(0, phase * 2, 0);
    }
    full(baseline, layers);
    owner.apply(layers);
    owner.updateWorldMatrices();
    expect(sparse.jointMap.get("Target").node.matrixWorld.elements).toEqual(
      baseline.jointMap.get("Target").node.matrixWorld.elements,
    );
    expect(sparse.unrelated.position.toArray()).toEqual([0, 0, 0]);
  }
});

test("unselected tracks retain weight, hierarchy, frame and channel rejection", () => {
  for (const mutate of [
    (entry) => (entry.poseAssets.get("clip").tracks[6].channel = "unknown"),
    (entry) => (entry.poseAssets.get("clip").tracks[6].bone = "other"),
  ]) {
    const baseline = fixture(),
      sparse = fixture(),
      owner = createLatestViewerCpuAncestorPose({
        THREE,
        entry: sparse,
        attachmentNames: ["Target"],
      });
    mutate(baseline);
    mutate(sparse);
    const layers = [{ file: "clip", phase: 0.5, weight: 1, weights: null }];
    expect(() => full(baseline, layers)).toThrow();
    expect(() => owner.apply(layers)).toThrow();
  }
  const entry = fixture(),
    owner = createLatestViewerCpuAncestorPose({
      THREE,
      entry,
      attachmentNames: ["Target"],
    });
  const invalidClock = [
    { file: "clip", sourceFrame: NaN, weight: 1, weights: null },
  ];
  expect(() => full(fixture(), invalidClock)).toThrow(
    "Invalid animation source frame",
  );
  expect(() => owner.apply(invalidClock)).toThrow(
    "Invalid animation source frame",
  );
  expect(() =>
    owner.apply([{ file: "clip", phase: 0, weight: 1, weights: [1, 1, NaN] }]),
  ).toThrow("Invalid viewer pose layer weight");
  entry.group.add(entry.jointMap.get("Target").node);
  expect(() => owner.updateWorldMatrices()).toThrow("topology changed");
  owner.close();
  expect(() => owner.apply([])).toThrow("owner is closed");
});
