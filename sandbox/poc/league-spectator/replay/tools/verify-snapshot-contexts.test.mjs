import { expect, test } from "bun:test";
import { verifySnapshotContexts } from "./verify-snapshot-contexts.mjs";

const index = [{ chunkOffset: 101 }, { chunkOffset: 201 }];
const roster = Array.from({ length: 10 }, (_, ordinal) => ({
  team: ordinal < 5 ? 100 : 200,
}));

function fixture() {
  return [
    ...index.flatMap(({ chunkOffset }, frame) =>
      roster.map((_, ordinal) => {
        const payload = new Uint8Array(1263);
        payload[1230] = ordinal < 5 ? 61 : 19;
        if (frame) payload[500] = ordinal;
        return {
          stream: 2,
          chunkOffset,
          blockOffset: ordinal,
          explicitOpcode: 313,
          marker: 1,
          paramBits: 5000 + ordinal,
          payload,
        };
      }),
    ),
    ...roster.map((_, ordinal) => ({
      stream: 1,
      chunkOffset: 301,
      blockOffset: ordinal,
      explicitOpcode: 75,
      marker: 1,
      paramBits: 5000 + ordinal,
      payload: new Uint8Array(0),
    })),
  ];
}

test("verifies a stable snapshot context and partition without emitting individual bindings", () => {
  expect(verifySnapshotContexts(index, roster, fixture())).toEqual({
    snapshotOpcode: 313,
    snapshotCount: 2,
    payloadBytes: 1263,
    contextsPerSnapshot: 10,
    recordsVerified: 20,
    partitionOffset: 1230,
    partitionSizes: [5, 5],
    gameplayOverlap: {
      opcode: 75,
      contextHypothesis: "signed-i8",
      distinctOverlappingContexts: 10,
      overlappingRecords: 10,
      totalRecords: 10,
    },
  });
});

test("rejects an eleventh snapshot record before reading another chunk", () => {
  function* tooMany() {
    const records = fixture();
    yield* records.slice(0, 20);
    yield { ...records[19], blockOffset: 10 };
    throw Error("Read beyond the invalid snapshot");
  }
  expect(() => verifySnapshotContexts(index, roster, tooMany())).toThrow(
    "Expected ten records in every snapshot",
  );
});

test("rejects an altered grouping, context, record count or gameplay overlap", () => {
  const altered = fixture();
  altered[10].payload[1230] = 0;
  expect(() => verifySnapshotContexts(index, roster, altered)).toThrow(
    "Snapshot context or partition differs",
  );
  const alteredContext = fixture();
  alteredContext[10].paramBits++;
  expect(() => verifySnapshotContexts(index, roster, alteredContext)).toThrow(
    "Snapshot context or partition differs",
  );
  expect(() =>
    verifySnapshotContexts(
      index,
      roster,
      fixture().filter((_, index) => index !== 19),
    ),
  ).toThrow("Expected ten records in every snapshot");
  expect(() =>
    verifySnapshotContexts(index, roster, fixture().slice(0, -1)),
  ).toThrow("does not overlap all snapshot contexts");
});
