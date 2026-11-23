import { expect, test } from "bun:test";
import {
  projectLatestDirectWorldInput,
  consumeLatestDirectWorldInput,
  restoreLatestDirectWorldInput,
} from "./latest-direct-world-input.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { CHAMPION_STATE_SHA } from "./latest-champion-state.mjs";
import { replayRowAt } from "./latest-replay-columns.mjs";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";
function fixture() {
  return {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    replaySha256: "a".repeat(64),
    duration: 10,
    endTime: 10,
    decoderImageSha256: "b".repeat(64),
    constructorImageSha256: "c".repeat(64),
    fieldCodecsSha256: "d".repeat(64),
    championStatePackageSha256: CHAMPION_STATE_SHA,
    heroes: [
      {
        entityId: 1,
        champion: "AnyHero",
        skinId: 0,
        skinIdStatus: "candidate",
        creationPosition: [1, 2, 3],
        team: 100,
        provenance: { time: 0, transportSequence: 1, entryOrder: 0, stream: 2 },
      },
    ],
    movement: [],
    lifecycle: [],
    casts: [],
    attacks: [],
    animations: [],
    missiles: [],
    missileEvents: [],
    worldEvents: [],
    resourceRequests: [],
    visibilityRequests: [],
    replicationRecords: [
      {
        entityId: 2,
        time: 1,
        transportSequence: 2,
        recordIndex: 0,
        stream: 1,
        groups: [{ group: 4, mask: 1, dataHex: "01" }],
      },
      {
        entityId: 1,
        time: 2,
        transportSequence: 3,
        recordIndex: 0,
        stream: 1,
        groups: [{ group: 4, mask: 1, dataHex: "02" }],
      },
      {
        entityId: 1,
        time: 3,
        transportSequence: 4,
        recordIndex: 0,
        stream: 1,
        groups: [{ group: 5, mask: 1, dataHex: "01" }],
      },
    ],
    effectDescriptors: [
      {
        attachmentEntityId: 1,
        lookup14EntityId: 2,
        attachmentKey4c: 0,
        attachmentKey50: 5,
        unconsumedDescriptorHex: "ff".repeat(1024),
      },
    ],
    effectCreations: [{ retainedInMain: true }],
    effectRemovals: [],
    inventoryEvents: [{ retainedInMain: true }],
  };
}
test("worker input projects exact target replication and descriptor fields without changing original main data", () => {
  const report = fixture(),
    before = structuredClone(report),
    owned = projectLatestDirectWorldInput(report);
  expect(report).toEqual(before);
  expect(owned.input.report.replicationRecords).toEqual([
    report.replicationRecords[1],
  ]);
  expect(owned.input.report.replicationRecords[0]).toBe(
    report.replicationRecords[1],
  );
  expect(replayRowAt(owned.input.report.effectDescriptors, 0)).toEqual({
    attachmentEntityId: 1,
    lookup14EntityId: 2,
    attachmentKey4c: 0,
    attachmentKey50: 5,
  });
  expect(owned.counts.originalReplicationRecords).toBe(3);
  expect(owned.counts.targetReplicationRecords).toBe(1);
  const transferred = structuredClone(owned.input, {
    transfer: consumeLatestDirectWorldInput(owned.ownership, owned.input),
  });
  const restored = restoreLatestDirectWorldInput(transferred);
  expect(replayRowAt(restored.effectDescriptors, 0).attachmentKey50).toBe(5);
  expect(report.effectDescriptors[0].unconsumedDescriptorHex).toHaveLength(
    2048,
  );
  expect(() =>
    consumeLatestDirectWorldInput(owned.ownership, owned.input),
  ).toThrow("Unused owned");
  expect(() => restored.inventoryEvents?.length).toThrow(
    "omitted original field",
  );
});
test("full and projected world/entity/visibility/target states agree through forward and backward absolute-time queries", () => {
  const report = fixture(),
    { input } = projectLatestDirectWorldInput(report),
    projected = restoreLatestDirectWorldInput(input);
  const scene = {
    build: report.build,
    protocol: report.protocol,
    map: { min: [0, 0, 0], max: [10, 10, 10], movementOrigin: [5, 5] },
  };
  const world = (source) =>
    createLatestWorldPresentation({
      report: source,
      scene,
      terrain: { sampleHeight: () => ({ inside: true, height: 2 }) },
    });
  const full = world(report),
    derived = world(projected);
  for (const time of [0, 2, 7, 2, 0])
    for (const cursor of [
      null,
      { transportSequence: 3, entryOrder: 0, exclusive: true },
      { transportSequence: 3, entryOrder: 0, exclusive: false },
    ]) {
      for (const method of [
        "entity",
        "visibility",
        "presentationTarget",
        "viewerPose",
        "viewerBoundSize",
      ]) {
        const args =
          method === "viewerPose" ? [1, [0], time, cursor] : [1, time, cursor];
        expect(derived[method](...args)).toEqual(full[method](...args));
      }
    }
});
test("missing consumed fields, forged projection and replaced transfer ownership fail loudly", () => {
  const report = fixture();
  delete report.casts;
  expect(() => projectLatestDirectWorldInput(report)).toThrow(
    "Complete consumed",
  );
  const owned = projectLatestDirectWorldInput(fixture());
  const forged = structuredClone(owned.input);
  delete forged.report.replicationRecords;
  expect(() => restoreLatestDirectWorldInput(forged)).toThrow(
    "Complete consumed",
  );
  expect(() =>
    consumeLatestDirectWorldInput(
      owned.ownership,
      structuredClone(owned.input),
    ),
  ).toThrow("Unused owned");
});

test("neutral gameplay and snapshot domains remain lossless across wire ownership and reverse causal queries", () => {
  const report = fixture();
  report.neutralCreationPackageSha256 = NEUTRAL_CREATION_PACKAGE_SHA;
  report.neutralCreations = [
    {
      kind: "neutral-creation-candidate",
      entityId: 99,
      character: "SRU_Red",
      requestedSkinId: 3,
      nativeTeamEnum: 3,
      firstVectorArgument: [5, 2, 5],
      time: 1,
      stream: 1,
      transportSequence: 2,
      entryOrder: 0,
      nativeWorldAcceptance: false,
    },
  ];
  report.neutralSnapshots = [
    {
      ...report.neutralCreations[0],
      time: 5,
      stream: 2,
      transportSequence: 10,
      firstVectorArgument: [9, 2, 9],
    },
  ];
  const owned = projectLatestDirectWorldInput(report),
    transfers = consumeLatestDirectWorldInput(owned.ownership, owned.input),
    received = restoreLatestDirectWorldInput(
      structuredClone(owned.input, { transfer: transfers }),
    );
  expect(received.neutralCreations).toEqual(report.neutralCreations);
  expect(received.neutralSnapshots).toEqual(report.neutralSnapshots);
  const scene = {
      build: report.build,
      protocol: report.protocol,
      map: {
        id: 11,
        min: [0, 0, 0],
        max: [10, 10, 10],
        movementOrigin: [5, 5],
      },
    },
    make = (source) =>
      createLatestWorldPresentation({
        report: source,
        scene,
        terrain: { sampleHeight: () => ({ inside: true, height: 2 }) },
      }),
    original = make(report),
    projected = make(received);
  expect(original.entity(99, 0)).toBeNull();
  expect(projected.entity(99, 6).position).toEqual([5, 2, 5]);
  for (const time of [0, 1, 6, 1, 0])
    for (const cursor of [
      null,
      { transportSequence: 2, entryOrder: 0, exclusive: true },
      { transportSequence: 2, entryOrder: 0, exclusive: false },
    ])
      for (const method of [
        "entity",
        "visibility",
        "presentationTarget",
        "viewerBoundSize",
      ])
        expect(projected[method](99, time, cursor)).toEqual(
          original[method](99, time, cursor),
        );
});

test("partial neutral projection groups fail instead of silently dropping snapshots", () => {
  const report = fixture();
  report.neutralCreations = [];
  expect(() => projectLatestDirectWorldInput(report)).toThrow(
    "separate neutral gameplay/snapshot",
  );
  report.neutralSnapshots = [];
  report.neutralCreationPackageSha256 = null;
  const projected = projectLatestDirectWorldInput(report);
  delete projected.input.report.neutralSnapshots;
  expect(() => restoreLatestDirectWorldInput(projected.input)).toThrow(
    "separate neutral gameplay/snapshot",
  );
});
