import { expect, test } from "bun:test";
import { CHAMPION_STATE_SHA } from "./latest-champion-state.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import {
  createPresentationTargetPolicy,
  PRESENTATION_TARGET_POLICY,
  readPresentationBaseFlags,
  queryConstructorViewTargetPredicate,
} from "./latest-presentation-targets.mjs";

const build = "16.21.829.8620",
  protocol = "20e09df23c66b85e";
const encode = (input) => {
  const out = [];
  let value = input;
  do {
    const b = value & 127;
    value >>>= 7;
    out.push(b | (value ? 128 : 0));
  } while (value);
  return out.map((v) => v.toString(16).padStart(2, "0")).join("");
};
const flags = (value, order, fields = {}) => ({
  entityId: 61,
  time: 5,
  transportSequence: order,
  recordIndex: 1,
  stream: 1,
  groups: [{ group: 4, mask: 1, dataHex: encode(value) }],
  ...fields,
});
const report = (records = []) => ({
  build,
  protocol,
  championStatePackageSha256: CHAMPION_STATE_SHA,
  heroes: [
    {
      kind: "hero-creation-candidate",
      entityId: 61,
      champion: "SharedClassFixture",
      skinId: 0,
      creationPosition: [1, 2, 3],
      provenance: { time: 0, transportSequence: 10, stream: 2, chunkId: 1 },
    },
  ],
  worldEvents: [],
  movement: [],
  lifecycle: [],
  attacks: [],
  casts: [],
  missiles: [],
  visibilityRequests: [
    {
      id: "primary",
      opcode: 822,
      entityId: 61,
      time: 0,
      transportSequence: 12,
      entryOrder: 0,
      stream: 2,
      chunkId: 1,
      acceptedByLiveUnit: null,
      visible: null,
    },
  ],
  replicationRecords: records,
});
const world = (r) =>
  createLatestWorldPresentation({
    report: r,
    scene: {
      build,
      protocol,
      map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
    },
    terrain: { sampleHeight: () => ({ inside: true, height: 2 }) },
  });
const cursor = (transportSequence, entryOrder = 1, exclusive = false) => ({
  transportSequence,
  entryOrder,
  exclusive,
});

test("registered base-flag prefix retains native low32 varuint consumption without interpreting other fields", () => {
  for (const value of [0, 15, 0x20000, 16908303, 0x80000000, 0xffffffff])
    expect(readPresentationBaseFlags(flags(value, 20)).value).toBe(value);
  expect(
    readPresentationBaseFlags({
      groups: [{ group: 4, mask: 3, dataHex: "0f7f" }],
    }),
  ).toEqual({ value: 15, consumedPrefixBytes: 1 });
  expect(
    readPresentationBaseFlags({
      groups: [{ group: 4, mask: 2, dataHex: "0f" }],
    }),
  ).toBeNull();
  expect(() =>
    readPresentationBaseFlags({
      groups: [{ group: 4, mask: 1, dataHex: "80" }],
    }),
  ).toThrow();
  expect(() =>
    readPresentationBaseFlags({
      groups: [{ group: 4, mask: 1, dataHex: "0f00" }],
    }),
  ).toThrow();
  expect(queryConstructorViewTargetPredicate(true, 15)).toBe(true);
  expect(queryConstructorViewTargetPredicate(true, 16908303)).toBe(false);
  expect(queryConstructorViewTargetPredicate(false, 15)).toBe(false);
});

test("presentation gate applies identical-time replication record order and supports repeated backward seeks", () => {
  const w = world(
    report([flags(16908303, 20), flags(15, 20, { recordIndex: 2 })]),
  );
  expect(w.presentationTarget(61, 5, cursor(20, 1, true))).toMatchObject({
    resolved: true,
    presentationEligible: true,
    baseFlags: 15,
    baseFlagsProvenance: "original-constructor-c50-0x0f",
    sourceEventIds: [],
  });
  const rejected = w.presentationTarget(61, 5, cursor(20));
  expect(rejected).toMatchObject({
    resolved: true,
    presentationEligible: false,
    baseFlags: 16908303,
    position: [1, 2, 3],
    nativeAcceptance: null,
    nativeAcceptedInternalId: null,
    sourceEventIds: ["base-flags:20:1:4:0"],
    presentationTargetId: 1,
  });
  expect(w.presentationTarget(61, 5, cursor(20, 2)).presentationEligible).toBe(
    true,
  );
  expect(w.presentationTarget(61, 5, cursor(20))).toEqual(rejected);
  expect(rejected.assumptions).toContain(
    "target:declared-no-local-player-view",
  );
  expect(rejected.omissions).toContain(
    "target:actual-linked-owner-provider-and-local-player-producers-unrecovered",
  );
  expect(w.entity(61, 5).visibility).toBe("unknown");
});

test("later snapshot flags never replace gameplay state, and uninitialized or missing world inputs block", () => {
  const r = report([flags(16908303, 20, { stream: 2 }), flags(15, 21)]);
  const w = world(r);
  expect(w.presentationTarget(61, 5)).toMatchObject({
    presentationEligible: true,
    baseFlags: 15,
    ignoredSnapshotEventIds: ["base-flags:20:1:4:0"],
    sourceEventIds: ["base-flags:21:1:4:0"],
  });
  expect(
    w.presentationTarget(61, 0, cursor(12, 0, true)).presentationEligible,
  ).toBe(false);
  expect(w.presentationTarget(999, 5).resolved).toBe(false);
  const policy = createPresentationTargetPolicy({
    report: r,
    policy: PRESENTATION_TARGET_POLICY,
  });
  expect(
    policy.query(
      {
        entity: { ...w.entity(61, 5), position: null },
        visibility: w.visibility(61, 5),
        presentationTargetId: 1,
      },
      5,
    ),
  ).toMatchObject({
    resolved: false,
    presentationEligible: true,
    reasons: ["target:actual-world-position-unresolved"],
  });
  for (const position of [
    [null, 2, 3],
    [false, 2, 3],
    ["1", 2, 3],
    [1e40, 2, 3],
  ])
    expect(
      policy.query(
        {
          entity: { ...w.entity(61, 5), position },
          visibility: w.visibility(61, 5),
          presentationTargetId: 1,
        },
        5,
      ),
    ).toMatchObject({
      resolved: false,
      reasons: ["target:actual-world-position-unresolved"],
    });
});

test("stale schemas, missing causal records and invalid target policy inputs fail explicitly", () => {
  expect(() =>
    createPresentationTargetPolicy({
      report: report(),
      policy: "native-acceptance",
    }),
  ).toThrow();
  expect(() =>
    createPresentationTargetPolicy({
      report: {
        ...report([flags(1, 20)]),
        championStatePackageSha256: "stale",
      },
      policy: PRESENTATION_TARGET_POLICY,
    }),
  ).toThrow();
  expect(() =>
    createPresentationTargetPolicy({
      report: report([flags(1, undefined)]),
      policy: PRESENTATION_TARGET_POLICY,
    }),
  ).toThrow();
  expect(() =>
    createPresentationTargetPolicy({
      report: report([flags(1, 20), flags(2, 20)]),
      policy: PRESENTATION_TARGET_POLICY,
    }),
  ).toThrow();
  expect(() => queryConstructorViewTargetPredicate(1, 15)).toThrow();
  expect(() => queryConstructorViewTargetPredicate(true, -1)).toThrow();
});
