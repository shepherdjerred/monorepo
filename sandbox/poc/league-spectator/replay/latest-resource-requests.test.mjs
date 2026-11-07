import { expect, test } from "bun:test";
import { createLatestResourceRequestTrack } from "./latest-resource-requests.mjs";

const event = (transportSequence, overrides = {}) => ({
  id: `resource-request:${transportSequence}:0`,
  origin: "network",
  opcode: 984,
  kind: "push",
  entityId: 10,
  time: 1,
  transportSequence,
  entryOrder: 0,
  stream: 1,
  chunkId: 2,
  blockOffset: 20,
  status: "appearance-stack-request",
  acceptedByLiveUnit: null,
  resourceIdentity: null,
  strings: { character: "RecordedName" },
  modifierNames: [],
  ...overrides,
});

test("resource requests retain repeated values and same-time original transport ordering", () => {
  const track = createLatestResourceRequestTrack([
    event(9),
    event(7),
    event(8),
  ]);
  expect(track.records.map((record) => record.transportSequence)).toEqual([
    7, 8, 9,
  ]);
  expect(
    track
      .requests(10, 1, 1, {
        transportSequence: 8,
        entryOrder: 0,
        exclusive: true,
      })
      .map((record) => record.transportSequence),
  ).toEqual([7]);
  expect(
    track
      .requests(10, 1, 1, { transportSequence: 8, entryOrder: 0 })
      .map((record) => record.transportSequence),
  ).toEqual([7, 8]);
  expect(track.requests(10, 1, 1)).toHaveLength(3);
  expect(track.scope).toEqual({
    acceptedMutations: false,
    liveResourceStacks: false,
  });
});

test("backward seeking and stream provenance do not invent accepted resource mutations", () => {
  const initial = event(2, { stream: 2, time: 0 });
  const copy = event(5, { opcode: 965, kind: "copy", sourceEntityId: 20 });
  const form = event(6, {
    opcode: 129,
    kind: undefined,
    status: "unit-form-selection-request",
    index: 255,
    signedIndex: -1,
    nativeFlag: false,
  });
  const track = createLatestResourceRequestTrack([form, copy, initial]);
  expect(track.requests(10, 2, 1).map((record) => record.opcode)).toEqual([
    965, 129,
  ]);
  expect(track.requests(10, 0, 2)).toEqual([initial]);
  expect(track.requests(10, 0, 1)).toEqual([]);
  expect(track.requests(10, 1, 1).at(-1).signedIndex).toBe(-1);
  expect(track.requests(20, 2, 1)).toEqual([]);
  expect(
    track
      .requests(10, 2, 1)
      .every(
        (record) =>
          record.acceptedByLiveUnit === null &&
          record.resourceIdentity === null,
      ),
  ).toBe(true);
});

test("request ownership clones and freezes nested decoded values", () => {
  const input = event(2);
  const track = createLatestResourceRequestTrack([input]);
  input.strings.character = "ChangedAfterIngestion";
  input.modifierNames.push("Changed");
  expect(track.records[0].strings.character).toBe("RecordedName");
  expect(track.records[0].modifierNames).toEqual([]);
  expect(() => {
    track.records[0].strings.character = "MutatedQuery";
  }).toThrow();
  expect(track.requests(10, 2, 1)[0].strings.character).toBe("RecordedName");
});

test("corrupt provenance, duplicate packets and accepted-state substitution fail loudly", () => {
  expect(() => createLatestResourceRequestTrack([event(2), event(2)])).toThrow(
    "Duplicate",
  );
  for (const override of [
    { acceptedByLiveUnit: true },
    { resourceIdentity: 123 },
    { transportSequence: -1 },
    { entryOrder: 1 },
    { stream: 3 },
    { id: "replacement" },
    { kind: "clear" },
    {
      opcode: 129,
      status: "unit-form-selection-request",
      index: 255,
      signedIndex: 255,
      nativeFlag: false,
    },
  ])
    expect(() =>
      createLatestResourceRequestTrack([event(2, override)]),
    ).toThrow();
  const track = createLatestResourceRequestTrack([event(2)]);
  expect(() => track.requests(10, 1, 1, { transportSequence: 2 })).toThrow(
    "causal cursor",
  );
  expect(() => track.requests(10, 1)).toThrow("stream");
});
