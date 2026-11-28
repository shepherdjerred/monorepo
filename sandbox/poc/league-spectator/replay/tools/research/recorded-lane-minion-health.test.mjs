import { expect, test } from "bun:test";
import {
  foldRecordedLaneMinionHealth,
  sampleRecordedLaneMinionHealth,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-lane-minion-health.mjs";
import { extractRecordedLaneMinionHealth } from "./recorded-lane-minion-health.mjs";

const laneLife = {
  context: 101,
  creationTimeSeconds: 30,
  killTimeSeconds: 35,
  removalTimeSeconds: 36,
};
const healthGroup = (timeSeconds, fieldMask, hex, overrides) => ({
  participantId: laneLife.context,
  stream: 1,
  group: 8,
  fieldMask,
  timeSeconds,
  bytes: Uint8Array.from(Buffer.from(hex, "hex")),
  ...overrides,
});

test("uses chronological group-8 prefixes within the proven life and restores on reverse seeks", () => {
  const [track] = foldRecordedLaneMinionHealth(
    [laneLife, { ...laneLife, context: 102, killTimeSeconds: null }],
    [
      healthGroup(29, 3, ""),
      healthGroup(30, 3, "0080e8430080e843", { stream: 2 }),
      healthGroup(30, 3, "", { participantId: 102 }),
      healthGroup(30, 3, "", { participantId: 103 }),
      healthGroup(30, 3, "", { group: 32 }),
      healthGroup(30.1, 1, "0080e843"),
      healthGroup(30.2, 3, "0080e8430080e843", { stream: 2 }),
      healthGroup(30.3, 0x103, "0080e8430080e843ff"),
      healthGroup(31, 1, "fe0000c842"),
      healthGroup(31, 1, "fe00004842"),
      healthGroup(32, 2, "0000fa43"),
      healthGroup(33, 1, "00004842"),
      healthGroup(34.9, 1, "ff"),
      healthGroup(35, 1, ""),
      healthGroup(36, 1, ""),
    ],
  );
  expect(track).toEqual({
    context: 101,
    start: 30,
    end: 35,
    points: [
      [30.3, 465, 465],
      [31, 50, 465],
      [32, 50, 500],
      [34.9, 0, 500],
    ],
  });
  for (const [time, expected] of [
    [29.9, undefined],
    [30.2, undefined],
    [30.3, { current: 465, max: 465 }],
    [32.9, { current: 50, max: 500 }],
    [34.9, { current: 0, max: 500 }],
    [35, undefined],
    [31, { current: 50, max: 465 }],
    [30, undefined],
  ])
    expect(sampleRecordedLaneMinionHealth(track, time)).toEqual(expected);
});

test("refuses unsupported build provenance, malformed prefixes and inconsistent life or health", () => {
  expect(() =>
    extractRecordedLaneMinionHealth(null, null, { build: "16.23.841.3489" }),
  ).toThrow("Exact .8428");
  expect(() => foldRecordedLaneMinionHealth([laneLife, laneLife], [])).toThrow(
    "Duplicate lane-minion context",
  );
  expect(() =>
    foldRecordedLaneMinionHealth([{ ...laneLife, removalTimeSeconds: 34 }], []),
  ).toThrow("Invalid lane-minion life bounds");
  expect(() =>
    foldRecordedLaneMinionHealth([laneLife], [healthGroup(31, 1, "fe00")]),
  ).toThrow("Truncated lane-minion health");
  expect(() =>
    foldRecordedLaneMinionHealth([laneLife], [healthGroup(31, 1, "0000807f")]),
  ).toThrow("Invalid lane-minion health");
  expect(() =>
    foldRecordedLaneMinionHealth(
      [laneLife],
      [healthGroup(31, 3, "0080e8430000c842")],
    ),
  ).toThrow("exceeds its recorded maximum");
  expect(() =>
    foldRecordedLaneMinionHealth(
      [laneLife],
      [healthGroup(31, 3, "0080e8430080e843"), healthGroup(31.5, 2, "ff")],
    ),
  ).toThrow("lost its recorded maximum");
  expect(() =>
    foldRecordedLaneMinionHealth(
      [laneLife],
      [healthGroup(31, 3, "0080e8430080e843"), healthGroup(30.5, 1, "ff")],
    ),
  ).toThrow("observations are out of order");
});
