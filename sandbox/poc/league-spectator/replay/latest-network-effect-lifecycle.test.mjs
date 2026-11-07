import { expect, test } from "bun:test";
import {
  linkLatestNetworkEffectLifecycle,
  NETWORK_EFFECT_LIFECYCLE_POLICY,
} from "./latest-network-effect-lifecycle.mjs";

const refs = {
  resourceContextEntityId: 7,
  lookup14EntityId: 8,
  attachmentEntityId: 9,
  lookupA8EntityId: 10,
};
function fixture() {
  const location = { stream: 1, chunkId: 2, blockOffset: 30, contextId: 44 },
    creations = [
      {
        opcode: 756,
        entityId: 20,
        time: 1,
        transportSequence: 10,
        creationSequence: 0,
        ...location,
        ...refs,
      },
      {
        opcode: 756,
        entityId: 20,
        time: 1,
        transportSequence: 12,
        creationSequence: 1,
        ...location,
        ...refs,
      },
    ],
    removals = [9, 11, 13, 14].map((packet, removalSequence) => ({
      opcode: 187,
      entityId: 20,
      time: 1,
      transportSequence: packet,
      removalSequence,
      ...location,
      reasonByte: removalSequence === 3 ? 62 : 61,
      requestedFlagMask: removalSequence === 3 ? 0x10000000 : 0x800,
    })),
    events = [
      ...creations.map((row, index) => ({
        id: `network-effect:20:${index}`,
        origin: "network-effect",
        kind: index === 1 ? "omitted" : "create",
        entityId: 20,
        time: row.time,
        transportSequence: row.transportSequence,
        entryOrder: index,
        creationSequence: index,
        descriptor: { ...refs },
      })),
      ...removals.map((row, index) => ({
        id: `network-removal:20:${index}`,
        origin: "network-effect",
        kind: "removal-request",
        entityId: 20,
        time: row.time,
        transportSequence: row.transportSequence,
        entryOrder: 0,
        removalSequence: index,
        requestedFlags: row.requestedFlagMask,
      })),
    ];
  return { events, creations, removals };
}

test("causal removals link every generation including an omitted replacement", () => {
  const result = linkLatestNetworkEffectLifecycle(fixture()),
    removals = result.filter((row) => row.kind === "removal-request");
  expect(result.map((row) => row.transportSequence)).toEqual([
    9, 10, 11, 12, 13, 14,
  ]);
  expect(removals.map((row) => row.sourceEventId)).toEqual([
    null,
    "network-effect:20:0",
    "network-effect:20:1",
    "network-effect:20:1",
  ]);
  expect(removals.map((row) => row.generation)).toEqual([null, 1, 2, 2]);
  expect(removals[2].removalInput.targetCreation).toEqual({
    sourceEventId: "network-effect:20:1",
    generation: 2,
    entityId: 20,
    time: 1,
    transportSequence: 12,
    entryOrder: 1,
    kind: "omitted",
    creationSequence: 1,
    stream: 1,
    chunkId: 2,
    blockOffset: 30,
    contextId: 44,
    entityReferences: refs,
  });
  expect(removals[0].removalInput.targetStatus).toBe(
    "no-decoded-prior-creation",
  );
  expect(removals[1].removalInput).toMatchObject({
    policy: NETWORK_EFFECT_LIFECYCLE_POLICY,
    reasonByte: 61,
    reasonBranch: "native-request-bit-0x800",
    requestedFlagMask: 0x800,
    nativeWorldLookupAcceptance: null,
  });
  expect(removals[3].removalInput.reasonBranch).toBe(
    "native-request-bit-0x10000000",
  );
  expect(result.every((row) => !Object.hasOwn(row, "initialObjectFlags"))).toBe(
    true,
  );
});

test("same-packet creation order, stream provenance and repeated removals survive", () => {
  const input = fixture();
  input.creations[0].stream = 2;
  input.creations[1].transportSequence = 10;
  input.events[1].transportSequence = 10;
  const result = linkLatestNetworkEffectLifecycle(input);
  expect(
    result
      .filter((row) => row.kind !== "removal-request")
      .map((row) => row.generation),
  ).toEqual([1, 2]);
  expect(
    result.find((row) => row.creationSequence === 0).creationInput.stream,
  ).toBe(2);
  expect(result.filter((row) => row.kind === "removal-request")).toHaveLength(
    4,
  );
  expect(result.find((row) => row.removalSequence === 1).generation).toBe(2);
});

test("outputs own descriptors, targets and repeated-query history", () => {
  const input = fixture(),
    result = linkLatestNetworkEffectLifecycle(input);
  input.creations[0].attachmentEntityId = 99;
  input.events[0].descriptor.attachmentEntityId = 99;
  const first = result.find((row) => row.removalSequence === 2),
    second = result.find((row) => row.removalSequence === 3);
  first.removalInput.targetCreation.entityReferences.attachmentEntityId = 55;
  expect(
    second.removalInput.targetCreation.entityReferences.attachmentEntityId,
  ).toBe(9);
  expect(
    result.find((row) => row.creationSequence === 0).descriptor
      .attachmentEntityId,
  ).toBe(9);
  const before = linkLatestNetworkEffectLifecycle(fixture());
  expect(before).toEqual(linkLatestNetworkEffectLifecycle(fixture()));
});

test("invalid causal identities, bytes, provenance and incomplete ledgers fail", () => {
  const mutations = [
    (f) => {
      f.events[0].origin = "missile";
    },
    (f) => {
      f.events[0].entryOrder = -1;
    },
    (f) => {
      f.events[0].creationSequence = 9;
    },
    (f) => {
      f.events[0].descriptor.lookupA8EntityId = 99;
    },
    (f) => {
      f.creations[0].stream = 3;
    },
    (f) => {
      f.creations[0].blockOffset = "30";
    },
    (f) => {
      f.removals[0].reasonByte = 256;
    },
    (f) => {
      f.removals[0].reasonByte = 62;
    },
    (f) => {
      f.events[2].requestedFlags = 0;
    },
    (f) => {
      f.events.push(structuredClone(f.events[0]));
    },
    (f) => {
      f.events.pop();
    },
    (f) => {
      f.creations.push(structuredClone(f.creations[0]));
    },
    ...[
      "generation",
      "creationInput",
      "removalInput",
      "initialObjectFlags",
      "objectFlags",
      "runtimeParentFlags",
      "parentFlags",
      "retireImmediately",
    ].map((field) => (f) => {
      f.events[0][field] = 0;
    }),
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    expect(() => linkLatestNetworkEffectLifecycle(input)).toThrow();
  }
});

test("all non-61 bytes retain the original alternate request bit without force semantics", () => {
  for (let reasonByte = 0; reasonByte < 256; reasonByte++) {
    const input = fixture(),
      mask = reasonByte === 61 ? 0x800 : 0x10000000;
    input.removals[0].reasonByte = reasonByte;
    input.removals[0].requestedFlagMask = mask;
    input.events[2].requestedFlags = mask;
    const first = linkLatestNetworkEffectLifecycle(input)[0];
    expect(first.removalInput.reasonByte).toBe(reasonByte);
    expect(first.removalInput.requestedFlagMask).toBe(mask);
    expect(first).not.toHaveProperty("retireImmediately");
  }
});
