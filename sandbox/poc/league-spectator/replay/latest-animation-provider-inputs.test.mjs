import { expect, test } from "bun:test";
import { COMBAT_STATS_SHA } from "./latest-combat-stats.mjs";
import { createLatestAnimationMoveSpeedProvider } from "./latest-animation-provider-inputs.mjs";
function fixture() {
  return {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    endTime: 10,
    combatStatPackageSha256: COMBAT_STATS_SHA,
    heroes: [{ entityId: 17 }],
    combatStatUpdates: [
      {
        entityId: 17,
        time: 0,
        transportSequence: 4,
        recordIndex: 3,
        moveSpeed: 345,
      },
      {
        entityId: 17,
        time: 2,
        transportSequence: 8,
        recordIndex: 1,
        moveSpeed: 380,
      },
      {
        entityId: 17,
        time: 2,
        transportSequence: 8,
        recordIndex: 4,
        moveSpeed: 400,
      },
    ],
  };
}
test("retains original same-time packet and record boundaries without a pre-observation default", () => {
  const provider = createLatestAnimationMoveSpeedProvider(fixture());
  expect(
    provider.sample(17, 0, { transportSequence: 4, recordIndex: 2 }).status,
  ).toBe("unavailable");
  expect(
    provider.sample(17, 0, {
      transportSequence: 4,
      recordIndex: 3,
      exclusive: true,
    }).status,
  ).toBe("unavailable");
  expect(
    provider.sample(17, 0, { transportSequence: 4, recordIndex: 3 }).value,
  ).toBe(345);
  expect(
    provider.sample(17, 2, {
      transportSequence: 8,
      recordIndex: 4,
      exclusive: true,
    }).value,
  ).toBe(380);
  expect(
    provider.sample(17, 2, { transportSequence: 8, recordIndex: 4 }).value,
  ).toBe(400);
  expect(provider.sample(17, 2).value).toBe(400);
  expect(provider.sample(17, 1).value).toBe(345);
});
test("owns observation values and provenance across backward queries and caller mutations", () => {
  const report = fixture(),
    provider = createLatestAnimationMoveSpeedProvider(report);
  report.combatStatUpdates[0].moveSpeed = 999;
  const sampled = provider.sample(17, 3);
  sampled.provenance.recordIndex = 999;
  const described = provider.describe();
  described.firstObserved[17].value = 999;
  expect(provider.sample(17, 0).value).toBe(345);
  expect(provider.sample(17, 2).provenance.recordIndex).toBe(4);
  expect(provider.describe().firstObserved[17].value).toBe(345);
  expect(provider.describe().nativeGraphInputsAdmitted).toBe(false);
});
test("rejects unverified programs, malformed original cursors and nonfloat observations", () => {
  for (const mutate of [
    (value) => {
      value.combatStatPackageSha256 = "f".repeat(64);
    },
    (value) => {
      value.combatStatUpdates[0].moveSpeed = 1 / 3;
    },
    (value) => {
      value.combatStatUpdates[0].recordIndex = -1;
    },
    (value) => {
      value.combatStatUpdates.push({ ...value.combatStatUpdates[0] });
    },
  ]) {
    const value = fixture();
    mutate(value);
    expect(() => createLatestAnimationMoveSpeedProvider(value)).toThrow();
  }
  const provider = createLatestAnimationMoveSpeedProvider(fixture());
  expect(() =>
    provider.sample(17, 0, { transportSequence: 4, recordIndex: 3.5 }),
  ).toThrow();
  expect(() => provider.sample(18, 0)).toThrow();
});
