import { expect, test } from "bun:test";
import {
  compareStructureFingerprints,
  verifyStructureFingerprints,
  verifyStructurePartitions,
} from "./verify-structure-fingerprints.mjs";

function frame(
  entries,
  marked = entries.map(([context]) => context),
  time = 0,
) {
  const clock = new DataView(new ArrayBuffer(4));
  clock.setFloat32(0, time, true);
  const packet = (explicitOpcode, paramBits, length, value) => ({
    stream: 2,
    marker: 1,
    explicitOpcode,
    paramBits,
    firstTimeBits: clock.getUint32(0, true),
    payload: new Uint8Array(length).fill(value),
  });
  return [
    ...marked.map((context) =>
      packet(
        1012,
        context,
        41,
        entries.find(([id]) => id === context)?.[2] ?? 0,
      ),
    ),
    ...entries.map(([context, value]) => packet(111, context, 13, value)),
  ].map((record, blockOffset) => ({ ...record, blockOffset }));
}

test("keeps singleton assignments and repeated groups separate across files", () => {
  const opening = [
    [1, 3],
    [2, 8],
    [3, 8],
  ];
  const left = verifyStructureFingerprints([
    ...frame(opening),
    ...frame(opening, [1, 3]),
  ]);
  const right = verifyStructureFingerprints(
    frame([
      [10, 3],
      [20, 8],
      [30, 8],
    ]),
  );
  const { uniqueAssignments, unresolvedGroups } = compareStructureFingerprints(
    left,
    right,
  );
  expect(
    uniqueAssignments.map(({ leftContext, rightContext }) => [
      leftContext,
      rightContext,
    ]),
  ).toEqual([[1, 10]]);
  expect(
    unresolvedGroups.map(({ leftContexts, rightContexts }) => [
      leftContexts,
      rightContexts,
    ]),
  ).toEqual([
    [
      [2, 3],
      [20, 30],
    ],
  ]);
  expect(left.stableRecords).toBe(6);
  expect(left.keyframes).toBe(2);
  expect(left.missingLaterMarkers).toBe(1);
});

test("corroborates observed turret snapshot states and leaves missing and tied clocks unknown", () => {
  const active = [[1, 3, 8]];
  const dead = [[1, 3, 0]];
  const losses = [{ context: 1, timeSeconds: 2 }];
  const snapshots = [
    ...frame(active),
    ...frame(active, [], 1),
    ...frame(active, [1], 2),
    ...frame(dead, [1], 3),
  ];
  expect(
    verifyStructureFingerprints(snapshots, losses).turretSnapshots,
  ).toEqual({
    cohort: "verified-destroyed-turrets",
    contexts: 1,
    alive: 1,
    dead: 1,
    unknownMissing: 1,
    unknownSameTime: 1,
  });
  expect(() =>
    verifyStructureFingerprints(
      [...frame(active), ...frame(active, [1], 3)],
      losses,
    ),
  ).toThrow("disagrees with verified loss history");

  const conflicting = {
    ...frame(dead)[0],
    blockOffset: 1,
  };
  expect(() =>
    verifyStructureFingerprints(
      [...frame(active), ...frame(active, [1], 3), conflicting],
      losses,
    ),
  ).toThrow("Conflicting turret snapshot bits");
});

test("opening composite splits different markers and leaves exact repeats unresolved", () => {
  const left = verifyStructureFingerprints([
    ...frame([
      [1, 8, 4],
      [2, 8, 5],
      [3, 8, 5],
    ]),
    ...frame([
      [1, 8, 6],
      [2, 8, 6],
      [3, 8, 6],
    ]),
  ]);
  const right = verifyStructureFingerprints(
    frame([
      [10, 8, 4],
      [20, 8, 5],
      [30, 8, 5],
    ]),
  );
  const result = compareStructureFingerprints(left, right);
  expect(result.uniqueAssignments).toHaveLength(0);
  expect(result.openingIdentity.uniqueAssignments).toEqual([
    expect.objectContaining({ leftContext: 1, rightContext: 10 }),
  ]);
  expect(result.openingIdentity.unresolvedGroups).toEqual([
    expect.objectContaining({ leftContexts: [2, 3], rightContexts: [20, 30] }),
  ]);
  expect(left.stableRecords).toBe(6);
});

test("requires exactly one unchanged full body for each opening context", () => {
  const start = frame([[1, 3]]);
  expect(() =>
    verifyStructureFingerprints([...start, ...frame([[1, 4]])]),
  ).toThrow("changed after the opening keyframe");
  expect(() =>
    verifyStructureFingerprints([...start, ...frame([], [1])]),
  ).toThrow("Expected one structure fingerprint");
  expect(() =>
    verifyStructureFingerprints(
      frame([
        [1, 3],
        [1, 3],
      ]),
    ),
  ).toThrow("Expected one structure fingerprint");
});

test("validates inverted side bit independently against reported losses", () => {
  const fingerprints = verifyStructureFingerprints(
    frame([
      [1, 32],
      [2, 0],
    ]),
  );
  const losses = [
    { context: 1, defendingPartition: 0 },
    { context: 2, defendingPartition: 1 },
  ];
  const result = verifyStructurePartitions(fingerprints, losses, [1, 1]);
  expect(result.candidateAssignments).toEqual([
    { context: 1, partition: 0 },
    { context: 2, partition: 1 },
  ]);
  expect(result.verifiedLosses).toEqual([1, 1]);
  expect(result.evidence).toBe("loss-corroborated");
  expect(verifyStructurePartitions(fingerprints, [], [0, 0]).evidence).toBe(
    "zero-loss-control",
  );
  expect(() => verifyStructurePartitions(fingerprints, losses, [0, 2])).toThrow(
    "footer turret losses",
  );
  expect(() =>
    verifyStructurePartitions(
      fingerprints,
      [{ context: 1, defendingPartition: 1 }],
      [0, 1],
    ),
  ).toThrow("reported turret loss");
});
