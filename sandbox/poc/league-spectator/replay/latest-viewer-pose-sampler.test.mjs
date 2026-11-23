import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestViewerPoseSampler,
  VIEWER_POSE_POLICY,
} from "./latest-viewer-pose-sampler.mjs";
import { createLatestViewerPoseService } from "./latest-viewer-pose-service.mjs";
import { setLatestViewerAnimatedVisibility } from "./latest-viewer-pose-availability.mjs";

const THREE = await import(
  pathToFileURL(resolve(".cache/replay-spike/public/vendor/three.module.js"))
    .href
);
function fixture(events = [], configure = () => {}) {
  const mirror = new THREE.Group(),
    group = new THREE.Group(),
    model = new THREE.Group(),
    joint = new THREE.Object3D();
  mirror.scale.z = -1;
  mirror.add(group);
  group.add(model);
  model.scale.setScalar(2);
  model.add(joint);
  joint.name = "Hand";
  joint.position.set(1, 2, 3);
  const track = (channel, width, values) => ({
    bone: "Hand",
    jointId: 0,
    channel,
    width,
    count: values.length / width,
    values: new Float32Array(values),
  });
  const poseAssets = new Map([
    ["Idle", { fps: 1, tracks: [track("position", 3, [1, 2, 3])] }],
    ["Run", { fps: 1, tracks: [track("position", 3, [2, 2, 3])] }],
    [
      "First",
      {
        fps: 1,
        tracks: [
          track("position", 3, [10, 0, 0, 14, 0, 0]),
          track("quaternion", 4, [0, 0, 0, 1, 0, 0, 1, 0]),
        ],
      },
    ],
    ["Second", { fps: 1, tracks: [track("position", 3, [0, 20, 0])] }],
    ["Death", { fps: 1, tracks: [track("position", 3, [0, -10, 0])] }],
  ]);
  const graph = {
    evaluate(name, elapsed) {
      return {
        duration: name === "Second" ? 0.25 : 2,
        unresolved: [],
        leaves:
          elapsed >= 0 && elapsed < (name === "Second" ? 0.25 : 2)
            ? [
                {
                  name,
                  file: name,
                  phase: elapsed,
                  sourceFrame: elapsed,
                  weights: null,
                  weight: 1,
                  track: name === "Idle" || name === "Run" ? "base" : "action",
                  priority: 0,
                  eventFrame: elapsed,
                },
              ]
            : [],
      };
    },
  };
  const entry = {
    group,
    graph,
    events,
    previewNames: { idle: "Idle", run: "Run" },
    catalog: { joints: ["Hand"] },
    poseAssets,
    jointMap: new Map([
      [
        "Hand",
        {
          node: joint,
          position: joint.position.clone(),
          quaternion: joint.quaternion.clone(),
          scale: joint.scale.clone(),
        },
      ],
    ]),
  };
  const bindings = [
    {
      resolvedBoneKey: 123,
      keyPoseIndex: 0,
      nativePoseIndex: 0,
      poseJointIndex: 0,
      name: "Hand",
    },
  ];
  configure(entry);
  const sampler = createLatestViewerPoseSampler({
    THREE,
    entry,
    entityId: 7,
    bindings,
  });
  const sample = (options = {}) =>
    sampler.sample({
      time: 1,
      root: {
        resolved: true,
        entityId: 7,
        position: [100, 4, 200],
        nativeAcceptance: null,
      },
      viewerYawInput: { status: "movement-derived-preview", direction: [0, 1] },
      moving: false,
      life: { dead: false },
      attachmentKeys: [0, 123],
      ...options,
    });
  return { sampler, sample, entry, bindings, mirror, joint };
}
test("declared missing base states preserve all transforms without evaluating any graph", () => {
  let evaluations = 0;
  const { sampler, sample, entry, joint } = fixture([], (entry) => {
    entry.previewNames = { idle: null, run: null };
    entry.graph.evaluate = () => {
      evaluations++;
      throw Error("Must not evaluate unavailable state");
    };
  });
  const transforms = () =>
    [entry.group, joint].map((node) => ({
      position: node.position.toArray(),
      quaternion: node.quaternion.toArray(),
      scale: node.scale.toArray(),
      matrix: [...node.matrix.elements],
      matrixWorld: [...node.matrixWorld.elements],
    }));
  const before = transforms();
  const expected = {
    resolved: false,
    policy: VIEWER_POSE_POLICY,
    entityId: 7,
    time: 1,
    cursor: null,
    reasons: ["pose:base-animation-state-program-unavailable"],
    unavailableBaseStates: ["idle", "run"],
    nativeAcceptance: null,
    nativePoseParity: null,
  };
  expect(sample()).toEqual(expected);
  expect(sample({ moving: true, rootOnly: true, attachmentKeys: [0] })).toEqual(
    expected,
  );
  expect(
    sampler.applyLocalPose({ time: 1, moving: false, life: { dead: false } }),
  ).toEqual(expected);
  expect(transforms()).toEqual(before);
  expect(evaluations).toBe(0);
  expect(sampler.baseStateAvailability.status).toBe("unavailable");
  expected.unavailableBaseStates.pop();
  expect(sample().unavailableBaseStates).toEqual(["idle", "run"]);
});
test("unavailable base states still reject corrupt state, graph, event, rig and query metadata", () => {
  for (const previewNames of [
    { run: null },
    { idle: undefined, run: null },
    { idle: 0, run: null },
    { idle: "", run: null },
  ])
    expect(() =>
      fixture([], (entry) => {
        entry.previewNames = previewNames;
      }),
    ).toThrow("Explicit viewer base animation states");
  expect(() =>
    fixture([], (entry) => {
      entry.previewNames = { idle: null, run: null };
      entry.graph = {};
    }),
  ).toThrow("Owned viewer hierarchy");
  expect(() =>
    fixture([{ time: NaN }], (entry) => {
      entry.previewNames = { idle: null, run: null };
    }),
  ).toThrow("Invalid viewer animation event");
  const { entry, bindings, sample } = fixture([], (entry) => {
    entry.previewNames = { idle: null, run: "Run" };
  });
  expect(() =>
    createLatestViewerPoseSampler({
      THREE,
      entry,
      entityId: 7,
      bindings: [{ ...bindings[0], poseJointIndex: 99 }],
    }),
  ).toThrow("Exact installed");
  expect(() => sample({ time: NaN })).toThrow("Explicit viewer pose");
  expect(sample({ attachmentKeys: [999] }).reasons).toEqual([
    "pose:installed-key-unresolved:999",
  ]);
});
test("pose service hides unavailable rendered actors before presentation and after attempted re-show", () => {
  const { entry, bindings, joint } = fixture([], (entry) => {
    entry.previewNames = { idle: null, run: null };
  });
  const assets = {
    THREE,
    policy: VIEWER_POSE_POLICY,
    contentHash: "test-owned-static-assets",
    actor: () => ({ actorKey: "test/0", bindings }),
    createEntry: () => entry,
    bindRenderedEntry: () => {},
  };
  const service = createLatestViewerPoseService({
    assets,
    report: {
      heroes: [
        {
          entityId: 7,
          champion: "test",
          skinId: 0,
          provenance: { time: 0, transportSequence: 0, entryOrder: 0 },
        },
      ],
      resourceRequests: [],
      effectDescriptors: [],
    },
  });
  const entity = {
    entityId: 7,
    entityClass: "champion",
    character: "test",
    skinId: 0,
    creationTransportSequence: 0,
    position: [10, 20, 30],
    lifecycle: "alive",
    viewerLifecycle: { dead: false },
    viewerMotion: { moving: false, orientationKnown: true },
    orientationStatus: "movement-derived-preview",
    direction: [0, 0, 1],
    positionSource: { kind: "recorded" },
  };
  const before = [entry.group.position.toArray(), joint.position.toArray()];
  service.bindRendered(7, entry);
  expect(entry.group.visible).toBe(false);
  const query = service.query(entity, [0, 123], 1);
  expect(query.entityId).toBe(7);
  expect(query.time).toBe(1);
  expect(query.reasons).toEqual([
    "pose:base-animation-state-program-unavailable",
  ]);
  entry.group.visible = true;
  const presented = service.present(entity, 1, null);
  expect(presented.reasons).toEqual(query.reasons);
  expect(presented.actorVisible).toBe(false);
  expect(entry.group.visible).toBe(false);
  expect([entry.group.position.toArray(), joint.position.toArray()]).toEqual(
    before,
  );
  for (const requested of [true, false, true])
    expect(setLatestViewerAnimatedVisibility(entry, requested)).toBe(false);
  entry.previewNames = { idle: "Idle", run: "Run" };
  expect(setLatestViewerAnimatedVisibility(entry, true)).toBe(true);
  expect(setLatestViewerAnimatedVisibility(entry, false)).toBe(false);
});
const event = (name, time, sequence, entryOrder = 0) => ({
  name,
  time,
  sequence,
  rate: 1,
  sourceKind: "animation-name",
  transportSequence: sequence,
  entryOrder,
});
test("keeps scaled bone position separate from unit rotation and removes outer viewer mirror", () => {
  const { sample } = fixture(),
    result = sample();
  expect(result.policy).toBe(VIEWER_POSE_POLICY);
  expect(result.attachments[0].position).toEqual([100, 4, 200]);
  expect(result.attachments[1].position).toEqual([102, 8, 206]);
  expect(result.attachments[1].hierarchyScale).toEqual([2, 2, 2]);
  expect(result.attachments[1].basis.map((value) => value + 0)).toEqual([
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  expect(result.nativeAcceptance).toBeNull();
  expect(result.nativePoseParity).toBeNull();
});
test("excludes later same-time events by packet AND entry before choosing track owner", () => {
  const { sample } = fixture([
    event("First", 1, 10, 0),
    event("Second", 1, 10, 2),
  ]);
  const before = sample({ cursor: { transportSequence: 10, entryOrder: 0 } }),
    after = sample({ cursor: { transportSequence: 10, entryOrder: 2 } });
  expect(before.attachments[1].position).toEqual([120, 4, 200]);
  expect(after.attachments[1].position).toEqual([100, 44, 200]);
  expect(before.layers.at(-1).event.entryOrder).toBe(0);
  expect(after.layers.at(-1).event.entryOrder).toBe(2);
  expect(
    sample({ cursor: { transportSequence: 9, entryOrder: 100 } }).attachments[1]
      .position,
  ).toEqual([102, 8, 206]);
  expect(sample({ cursor: { transportSequence: 10, entryOrder: 0 } })).toEqual(
    before,
  );
});
test("unknown orientation, unknown key and unknown same-time ordinal stay unresolved without pose mutation", () => {
  const item = event("First", 1, 10);
  delete item.entryOrder;
  const { sample, joint } = fixture([item]);
  const initial = joint.position.toArray();
  expect(sample({ viewerYawInput: { status: "unknown" } }).reasons).toEqual([
    "pose:viewer-actor-orientation-unresolved",
  ]);
  expect(sample({ attachmentKeys: [999] }).reasons).toEqual([
    "pose:installed-key-unresolved:999",
  ]);
  expect(
    sample({ cursor: { transportSequence: 10, entryOrder: 0 } }).reasons,
  ).toEqual(["pose:same-time-animation-causal-ordinal-unresolved"]);
  expect(joint.position.toArray()).toEqual(initial);
});
test("interpolates exact existing clip samples and resets every absolute-time query", () => {
  const { sample } = fixture([event("First", 0, 1)]),
    middle = sample({ time: 0.5 });
  expect(middle.attachments[1].position).toEqual([124, 4, 200]);
  expect(middle.attachments[1].quaternion[2]).toBeCloseTo(Math.SQRT1_2, 14);
  expect(middle.attachments[1].quaternion[3]).toBeCloseTo(Math.SQRT1_2, 14);
  sample({ time: 4 });
  expect(sample({ time: 0.5 })).toEqual(middle);
  middle.attachments[1].position[0] = 999;
  expect(sample({ time: 0.5 }).attachments[1].position[0]).toBe(124);
});
test("completed newer action owns track and does not resume older action", () => {
  const { sample } = fixture([event("First", 0, 1), event("Second", 0.5, 2)]);
  expect(sample({ time: 1 }).attachments[1].position).toEqual([102, 8, 206]);
});
test("applies recorded attack yaw after pose but death preview suppresses action yaw", () => {
  const attack = {
    ...event("First", 0, 1),
    sourceKind: "attack",
    sourceEvent: { targetPosition: [200, 4, 200] },
  };
  const { sample } = fixture([attack]),
    active = sample({ time: 0.5 });
  expect(active.attachments[0].basis[2]).toBeCloseTo(-1, 14);
  const dead = sample({
    time: 0.5,
    life: {
      dead: true,
      interval: { death: { time: 0 }, postDeathActions: [] },
    },
  });
  expect(dead.deathPreview).toBe(true);
  expect(dead.attachments[0].basis).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(dead.attachments[1].position).toEqual([100, -16, 200]);
});
test("freezes event ownership and rejects mismatched or ambiguous installed mapping", () => {
  const events = [event("First", 0, 1)],
    { sample, entry, bindings } = fixture(events);
  events[0].name = "Second";
  expect(sample({ time: 0.5 }).layers.at(-1).event.name).toBe("First");
  expect(() =>
    createLatestViewerPoseSampler({
      THREE,
      entry,
      entityId: 7,
      bindings: [{ ...bindings[0], poseJointIndex: 1 }],
    }),
  ).toThrow("Exact installed");
  expect(() =>
    sample({ cursor: { transportSequence: -1, entryOrder: 0 } }),
  ).toThrow("cursor");
});
test("exclusive cutoffs and transport order govern same-time ownership rather than legacy sequence", () => {
  const first = { ...event("First", 1, 100, 0), transportSequence: 10 },
    second = { ...event("Second", 1, 1, 1), transportSequence: 11 };
  const { sample } = fixture([second, first]);
  expect(sample().attachments[1].position).toEqual([100, 44, 200]);
  expect(
    sample({
      cursor: { transportSequence: 11, entryOrder: 1, exclusive: true },
    }).attachments[1].position,
  ).toEqual([120, 4, 200]);
  expect(
    sample({
      cursor: { transportSequence: 10, entryOrder: 0, exclusive: true },
    }).attachments[1].position,
  ).toEqual([102, 8, 206]);
  expect(
    sample({
      viewerYawInput: {
        status: "movement-derived-preview",
        direction: [0, -0],
      },
    }).reasons,
  ).toEqual(["pose:viewer-actor-orientation-unresolved"]);
  expect(() =>
    sample({
      cursor: { transportSequence: 11, entryOrder: 1, exclusive: "yes" },
    }),
  ).toThrow("cursor");
});
test("missing same-time causal ordering cannot be reconstructed from sequence", () => {
  const first = event("First", 0, 1),
    second = { ...event("Second", 0, 2), transportSequence: 1 };
  delete first.entryOrder;
  const { sample } = fixture([first, second]);
  expect(sample().reasons).toEqual(["pose:animation-order-unresolved"]);
  expect(() =>
    fixture([
      event("First", 0, 1),
      { ...event("Second", 0, 2), transportSequence: 1 },
    ]),
  ).toThrow("Duplicate viewer animation causal ordinal");
});
test("sparse/nonfinite root and facing inputs never produce resolved pose outputs", () => {
  const { sample } = fixture();
  for (const position of [
    [, 2, 3],
    [1, Infinity, 3],
    [1e300, 2, 3],
  ])
    expect(
      sample({
        root: { resolved: true, entityId: 7, position, nativeAcceptance: null },
      }).resolved,
    ).toBe(false);
  for (const direction of [
    [, 1],
    [1, NaN],
    [1e300, 1],
  ])
    expect(
      sample({
        viewerYawInput: { status: "movement-derived-preview", direction },
      }).resolved,
    ).toBe(false);
});

test("root-only queries preserve exact root, yaw, causal layers and evidence without touching joints", () => {
  const attack = {
    ...event("First", 0.5, 10),
    sourceKind: "attack",
    sourceEvent: { targetPosition: [130, 4, 180] },
  };
  const events = [attack, event("Second", 0.5, 11)];
  const full = fixture(events),
    fast = fixture(events);
  let jointUpdates = 0;
  fast.joint.updateWorldMatrix = () => {
    jointUpdates++;
  };
  const initialJoint = fast.joint.position.toArray();
  for (const time of [0, 0.5, 0.7, 1.4, 0.1, 0.7])
    for (const cursor of [
      null,
      { transportSequence: 10, entryOrder: 0 },
      { transportSequence: 10, entryOrder: 0, exclusive: true },
    ]) {
      const supplied = {
        time,
        cursor,
        attachmentKeys: [0],
        moving: true,
        viewerYawInput: {
          status: "movement-derived-preview",
          direction: [1, -1],
        },
      };
      expect(fast.sample({ ...supplied, rootOnly: true })).toEqual(
        full.sample(supplied),
      );
    }
  expect(jointUpdates).toBe(0);
  expect(fast.joint.position.toArray()).toEqual(initialJoint);
  // A following bone request still resets and evaluates the whole hierarchy.
  delete fast.joint.updateWorldMatrix;
  expect(fast.sample()).toEqual(full.sample());
  for (const attachmentKeys of [[], [123], [0, 123]])
    expect(() => fast.sample({ attachmentKeys, rootOnly: true })).toThrow(
      "Root-only pose sampling",
    );
  expect(() => fast.sample({ attachmentKeys: [0], rootOnly: "true" })).toThrow(
    "Explicit viewer pose",
  );
});

test("historical track ownership is compiled once while active clocks still evaluate", () => {
  const events = Array.from({ length: 100 }, (_, index) =>
    event("First", index / 100, index + 1),
  );
  const { sample, entry } = fixture(events);
  const evaluate = entry.graph.evaluate,
    calls = [];
  entry.graph.evaluate = (...args) => {
    calls.push(args);
    return evaluate(...args);
  };
  const result = sample({ time: 1.2, attachmentKeys: [0], rootOnly: true });
  expect(result.layers.at(-1).event.sequence).toBe(100);
  expect(result.layers.at(-1).phase).toBeCloseTo(0.21, 12);
  expect(calls.map(([name]) => name)).toEqual(["Idle", "First"]);
  expect(calls.every(([, elapsed]) => elapsed > 0)).toBe(true);
});
