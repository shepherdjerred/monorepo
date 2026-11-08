import { expect, test } from "bun:test";
import {
  createLatestViewerRootAttachmentPlacement,
  VIEWER_ROOT_ATTACHMENT_POLICY,
} from "./latest-viewer-root-attachment.mjs";
import {
  EFFECT_ENTITY_FIELDS,
  VIEWER_ROOT_POLICY,
  createLatestWorldPresentation,
} from "./latest-world-presentation.mjs";
import { ROOT_ATTACHMENT_PROVIDER_PROOF } from "./latest-root-attachment-provider.mjs";

const profile = {
  clientVersion: ROOT_ATTACHMENT_PROVIDER_PROOF.build,
  protocolDigest: ROOT_ATTACHMENT_PROVIDER_PROOF.protocol,
  decoderImageSha256: ROOT_ATTACHMENT_PROVIDER_PROOF.decoderImageSha256,
};
const descriptor = {
  resourceContextEntityId: 9,
  lookup14EntityId: 0,
  attachmentEntityId: 7,
  lookupA8EntityId: 7,
  flags: 48,
  field8c: 0,
  attachmentKey4c: 0,
  attachmentKey50: 0,
  byteFields: { field98: 0 },
  coordinateSpace: "native-world",
  packetVectorsResolved: true,
  primaryPacketPosition: [9999, 9999, 9999],
  secondaryPacketVector: [2, 3, 4],
  vector6c: [0, 0, 0],
};
const references = (d) =>
  EFFECT_ENTITY_FIELDS.map((field) => ({
    field,
    entityId: d[field],
    entity: d[field] ? { entityId: d[field] } : null,
    status: d[field] ? "registered" : "native-null",
  }));
const root = {
  policy: VIEWER_ROOT_POLICY,
  resolved: true,
  entityId: 7,
  time: 4,
  position: [1 / 3, 4, 7],
  positionStatus: "movement-derived-preview",
  source: {
    entityId: 7,
    kind: "movement",
    time: 3,
    transportSequence: 21,
    entryOrder: 2,
  },
  nativeAcceptance: null,
  nativePlacementParity: null,
  omissions: ["world:native-hero-proxy-root-selection-unrecovered"],
};
function fixture(
  definition = {
    id: "control",
    emitters: [{ index: 0, primitive: "camera-quad" }],
    blockers: [],
  },
) {
  let packetCalls = 0,
    rootCalls = 0;
  const policy = createLatestViewerRootAttachmentPlacement({
    profile,
    packetPlacement: {
      metadata: {
        build: profile.clientVersion,
        protocol: profile.protocolDigest,
        decoderImageSha256: profile.decoderImageSha256,
        policy: "packet-position-without-transform-providers",
      },
      resolve: () => {
        packetCalls++;
        return { resolved: false, reasons: ["packet-only"] };
      },
    },
    definitions: new Map([["control", definition]]),
  });
  const input = (d = descriptor, view = root) => ({
    event: { descriptor: d, definitionId: "control" },
    time: 4,
    cursor: { transportSequence: 24, entryOrder: 0 },
    references: references(d),
    world: {
      viewerRoot: (id, time, cursor) => {
        rootCalls++;
        expect(id).toBe(7);
        expect(time).toBe(4);
        expect(cursor.transportSequence).toBe(24);
        return view;
      },
    },
  });
  return { policy, input, calls: () => ({ packetCalls, rootCalls }) };
}

test("explicit viewer root keeps all refs/source IDs and never retries detached placement", () => {
  const { policy, input, calls } = fixture();
  const row = input(),
    result = policy.resolve(row);
  expect(result.resolved).toBe(true);
  expect(result.policy).toBe(VIEWER_ROOT_ATTACHMENT_POLICY);
  expect(result.position).toEqual([Math.fround(1 / 3), 4, 7]);
  expect(result.references).toBe(row.references);
  expect(result.nativeParentFlags).toBe(2);
  expect(result.boundObjectSize).toBeUndefined();
  expect(result.boundObjectSizeStatus).toBeUndefined();
  expect(result.rootInput.source).toEqual(root.source);
  expect(result.rootInput.nativeAcceptance).toBeNull();
  expect(result.reasons).toContain(
    "lifecycle:source-provider-death-revive-parent-activation-unimplemented",
  );
  expect(calls()).toEqual({ packetCalls: 0, rootCalls: 1 });
  result.rootInput.source.transportSequence = 99;
  expect(root.source.transportSequence).toBe(21);
});

test("matrix inheritance, nonzero bones, target/additional providers stay blocked", () => {
  for (const patch of [
    { flags: 32 },
    { attachmentKey4c: 1 },
    { lookup14EntityId: 9 },
    { lookupA8EntityId: 9 },
    { flags: 48 | 0x400 },
    { byteFields: { field98: 1 } },
    { vector6c: [0, 1, 1] },
  ]) {
    const { policy, input, calls } = fixture();
    expect(policy.resolve(input({ ...descriptor, ...patch })).resolved).toBe(
      false,
    );
    expect(calls()).toEqual({ packetCalls: 0, rootCalls: 0 });
  }
});

test("authored horizontal packet direction is retained separately from source root motion", () => {
  const f = fixture();
  const result = f.policy.resolve(
    f.input({ ...descriptor, vector6c: [3, 0, -4] }),
  );
  expect(result.resolved).toBe(true);
  expect(result.basis).toEqual([
    Math.fround(-0.8),
    0,
    Math.fround(-0.6),
    0,
    1,
    0,
    Math.fround(0.6),
    0,
    Math.fround(-0.8),
  ]);
  expect(result.basisStatus).toBe(
    "authored-horizontal-packet-basis-source-matrix-inheritance-disabled",
  );
  expect(result.reasons).toContain(
    "world:independent-provider-direction-not-consumed-by-admitted-quads",
  );
});

test("unknown root and unsupported definition remain identifiable omissions", () => {
  const { policy, input } = fixture();
  expect(
    policy.resolve(
      input(descriptor, {
        policy: VIEWER_ROOT_POLICY,
        resolved: false,
        reasons: ["world:missing-point"],
      }),
    ).reasons,
  ).toEqual(["world:missing-point"]);
  for (const definition of [
    { emitters: [], blockers: ["system:mIsPoseAfterimage"] },
    { emitters: [{ index: 1, primitive: "camera-trail" }], blockers: [] },
  ]) {
    const f = fixture(definition);
    expect(f.policy.resolve(f.input()).resolved).toBe(false);
    expect(f.calls().rootCalls).toBe(0);
  }
  const zero = { ...descriptor, attachmentEntityId: 0, lookupA8EntityId: 0 };
  expect(policy.resolve(input(zero)).reasons).toEqual(["packet-only"]);
});

test("malformed identity/status/flag bytes fail rather than selecting another source", () => {
  const { policy, input } = fixture();
  const invalid = input();
  invalid.references[0].entityId = 1;
  expect(() => policy.resolve(invalid)).toThrow("identity");
  expect(() =>
    policy.resolve(input({ ...descriptor, byteFields: { field98: 256 } })),
  ).toThrow();
  expect(() =>
    policy.resolve(input(descriptor, { ...root, entityId: 9 })),
  ).toThrow("ownership");
});

test("shared actor root preserves causal motion, source IDs and backward seek", () => {
  const report = {
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    heroes: [
      {
        kind: "hero-creation-candidate",
        entityId: 7,
        champion: "Control",
        creationPosition: [1, 4, 1],
        provenance: { time: 0, transportSequence: 0, stream: 2, chunkId: 1 },
      },
    ],
    movement: [
      {
        entityId: 7,
        time: 1,
        sequence: 3,
        transportSequence: 10,
        entryOrder: 1,
        syncId: 1,
        speed: 2,
        encodedWaypoints: [
          [1, 1],
          [3, 1],
        ],
      },
    ],
    lifecycle: [],
    casts: [],
    attacks: [],
    missiles: [],
  };
  const scene = {
    build: report.build,
    protocol: report.protocol,
    map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
  };
  const world = createLatestWorldPresentation({
    report,
    scene,
    terrain: { sampleHeight: () => ({ inside: true, height: 4 }) },
  });
  const before = world.viewerRoot(7, 1, {
    transportSequence: 10,
    entryOrder: 0,
  });
  const after = world.viewerRoot(7, 1, {
    transportSequence: 10,
    entryOrder: 1,
  });
  expect(before.position).toEqual([1, 4, 1]);
  expect(after.position).toEqual([7, 4, 7]);
  expect(after.source).toMatchObject({
    entityId: 7,
    sequence: 3,
    transportSequence: 10,
    entryOrder: 1,
  });
  expect(world.viewerRoot(7, 2).position).toEqual([9, 4, 7]);
  expect(
    world.viewerRoot(7, 1, { transportSequence: 10, entryOrder: 0 }),
  ).toEqual(before);
  after.source.transportSequence = 99;
  expect(
    world.viewerRoot(7, 1, { transportSequence: 10, entryOrder: 1 }).source
      .transportSequence,
  ).toBe(10);
  expect(world.viewerRoot(99, 2).resolved).toBe(false);
});
