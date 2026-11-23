import { expect, test } from "bun:test";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { cpuAncestorControlSource } from "./cpu-ancestor-control-source.mjs";
import { createLatestViewerPoseSampler } from "../latest-viewer-pose-sampler.mjs";

const fixtureInput = process.env.SCOUT_REPLAY_RESEARCH_CACHE;
if (fixtureInput !== undefined && !fixtureInput.trim())
  throw Error("An explicit replay research fixture directory is required");
const cache =
  fixtureInput === undefined
    ? new URL("../../../../../.cache/replay-spike/", import.meta.url)
    : pathToFileURL(resolve(fixtureInput) + sep);
const THREE = await import(
    new URL("public/vendor/three.module.js", cache).href
  ),
  samplerUrl = new URL("../latest-viewer-pose-sampler.mjs", import.meta.url),
  candidate = cpuAncestorControlSource({
    samplerSource: await Bun.file(samplerUrl).text(),
    serviceSource: await Bun.file(
      new URL("../latest-viewer-pose-service.mjs", import.meta.url),
    ).text(),
  }),
  bound = candidate.sampler.replace(
    /from "(\.\/[^\"]+)"/g,
    (_, file) => `from ${JSON.stringify(new URL(file, samplerUrl).href)}`,
  ),
  { createLatestViewerPoseSampler: createCandidate } = await import(
    `data:text/javascript;base64,${Buffer.from(bound).toString("base64")}`
  );

function fixture(factory, cpuAttachmentsOnly) {
  const mirror = new THREE.Group(),
    group = new THREE.Group(),
    container = new THREE.Group(),
    nodes = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()],
    names = ["Parent", "Hand", "Other"];
  mirror.scale.set(1.3, 0.7, -1.1);
  mirror.add(group);
  group.add(container);
  container.scale.setScalar(2);
  container.add(nodes[0], nodes[2]);
  nodes[0].add(nodes[1]);
  const jointMap = new Map(
    nodes.map((node, index) => [
      names[index],
      {
        node,
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      },
    ]),
  );
  const poseAssets = new Map(
    ["Idle", "Run", "Action", "Second"].map((name, clipIndex) => [
      name,
      {
        fps: 1,
        tracks: nodes.flatMap((_, jointId) => [
          {
            bone: names[jointId],
            jointId,
            channel: "position",
            width: 3,
            count: 2,
            values: Float32Array.from([
              clipIndex,
              jointId,
              1,
              clipIndex + 2,
              jointId + 3,
              4,
            ]),
          },
          {
            bone: names[jointId],
            jointId,
            channel: "quaternion",
            width: 4,
            count: 2,
            values: Float32Array.from([0, 0, 0, 1, 0, 0.6, 0, 0.8]),
          },
        ]),
      },
    ]),
  );
  const entry = {
    group,
    jointMap,
    poseAssets,
    catalog: { joints: names },
    previewNames: { idle: "Idle", run: "Run" },
    events: [
      {
        time: 1,
        sequence: 0,
        name: "Action",
        rate: 1,
        transportSequence: 10,
        entryOrder: 0,
        sourceKind: "attack",
        sourceEvent: { targetPosition: [400, 0, 500] },
      },
      {
        time: 1,
        sequence: 1,
        name: "Second",
        rate: 1,
        transportSequence: 10,
        entryOrder: 1,
      },
    ],
    graph: {
      evaluate(name, elapsed) {
        return {
          duration: 2,
          unresolved: [],
          leaves:
            elapsed >= 0 && elapsed < 2
              ? [
                  {
                    name,
                    file: name,
                    phase: elapsed,
                    sourceFrame: elapsed,
                    weight: 1,
                    weights: [0.4, 1, 0.7],
                    track:
                      name === "Idle" || name === "Run" ? "base" : "action",
                    priority: 0,
                  },
                ]
              : [],
        };
      },
    },
  };
  const bindings = [0, 1, 2].map((index) => ({
    resolvedBoneKey: index + 101,
    keyPoseIndex: index,
    nativePoseIndex: index,
    poseJointIndex: index,
    name: names[index],
  }));
  return {
    entry,
    nodes,
    sampler: factory({
      THREE,
      entry,
      entityId: 7,
      bindings,
      cpuAttachmentsOnly,
    }),
  };
}
function input(time, keys, cursor = null) {
  return {
    time,
    cursor,
    attachmentKeys: keys,
    root: {
      resolved: true,
      entityId: 7,
      position: [100 + time, 4, 200],
      nativeAcceptance: null,
    },
    viewerYawInput: {
      status: "movement-derived-preview",
      direction: [time + 0.1, 1],
    },
    moving: time > 1.25,
    life: { dead: false },
  };
}

test("source-only CPU candidate preserves exact cursor/yaw outputs as requested ancestor paths grow, shrink and rewind", () => {
  const full = fixture(createLatestViewerPoseSampler, false),
    sparse = fixture(createCandidate, true);
  for (const value of [
    input(1, [102], { transportSequence: 10, entryOrder: 0, exclusive: true }),
    input(1, [102], { transportSequence: 10, entryOrder: 0 }),
    input(1.5, [103]),
    input(0.25, [0]),
    input(2, [0, 101, 102, 103]),
    input(1, [102], { transportSequence: 10, entryOrder: 1 }),
    input(0.25, [101]),
  ])
    expect(sparse.sampler.sample(value)).toEqual(full.sampler.sample(value));
  expect(sparse.sampler.sample(input(1, [999]))).toEqual(
    full.sampler.sample(input(1, [999])),
  );
  expect(
    sparse.sampler.sample({
      ...input(1, [102]),
      viewerYawInput: { status: "unknown" },
    }),
  ).toEqual(
    full.sampler.sample({
      ...input(1, [102]),
      viewerYawInput: { status: "unknown" },
    }),
  );
});

test("candidate local/render path still applies every joint and subsequent CPU queries restore their complete ancestors", () => {
  const full = fixture(createLatestViewerPoseSampler, false),
    sparse = fixture(createCandidate, true),
    rendered = fixture(createCandidate, false);
  for (const time of [1.5, 0.25, 1.1]) {
    const value = input(time, [102]);
    expect(sparse.sampler.sample(value)).toEqual(full.sampler.sample(value));
    expect(rendered.sampler.sample(value)).toEqual(full.sampler.sample(value));
    const local = { time, moving: value.moving, life: value.life };
    expect(sparse.sampler.applyLocalPose(local)).toEqual(
      full.sampler.applyLocalPose(local),
    );
    for (const fixture of [full, sparse])
      fixture.entry.group.updateWorldMatrix(true, true);
    for (let index = 0; index < full.nodes.length; index++)
      expect(sparse.nodes[index].matrixWorld.elements).toEqual(
        full.nodes[index].matrixWorld.elements,
      );
  }
});
