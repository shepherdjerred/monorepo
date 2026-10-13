import { expect, it } from "vitest";
import {
  TraversalStatus,
  summarizeTraversal,
  compareFlatTraversal,
} from "./traversal-wire.ts";

function trial(state: "passed" | "failed") {
  return TraversalStatus.parse({
    version: 2,
    state,
    scenario: "drop-four",
    ticks: 22,
    driveTicks: 2,
    body: "native-body",
    samples: Array.from({ length: 22 }, (_, index) => ({
      tick: index + 1,
      position: [index < 21 ? 401.5 : 409.5, index < 21 ? 104 : 100, 402.5],
      velocity: [0.2, index < 21 ? -0.1 : 0, 0],
      health: index < 21 ? 20 : 19,
      fallDistance: index < 21 ? 2 : 0,
      onGround: index === 21,
      inWater: false,
      climbing: false,
      jump: false,
      damage: index < 21 ? 0 : 1,
    })),
  });
}

it("retains observed damage and failed outcomes in calibration summaries", () => {
  expect(summarizeTraversal(trial("passed"))).toMatchObject({
    reached: true,
    damage: 1,
    health: 19,
    groundedTicks: 1,
    driveTicks: 2,
  });
  expect(summarizeTraversal(trial("failed")).reached).toBe(false);
});

it("rejects truncated/reordered physics instead of reporting a calibrated success", () => {
  const value = trial("passed");
  expect(() =>
    summarizeTraversal({ ...value, samples: value.samples.slice(1) }),
  ).toThrow("omitted or reordered");
  expect(() =>
    summarizeTraversal({ ...value, samples: value.samples.toReversed() }),
  ).toThrow("omitted or reordered");
});

it("rejects a claimed dive that sank to its destination before control began", () => {
  const value = trial("passed");
  expect(() =>
    summarizeTraversal({
      ...value,
      scenario: "water-dive",
      samples: value.samples.map((sample) => ({
        ...sample,
        position: [401.5, 96.32, 402.5],
      })),
    }),
  ).toThrow("authored starting state");
});

it("rejects a claimed hold without the complete requested controlled interval", () => {
  const value = trial("passed");
  expect(() =>
    summarizeTraversal({
      ...value,
      scenario: "water-hold",
      samples: value.samples.map((sample) => ({
        ...sample,
        position: [401.5, 98, 402.5],
      })),
    }),
  ).toThrow("full duration and destination");
});

it("requires measured improvement instead of declaring any successful jumping optimal", () => {
  const value = summarizeTraversal(trial("passed"));
  expect(
    compareFlatTraversal([
      { ...value, scenario: "sprint-flat", driveTicks: 50 },
      { ...value, scenario: "sprint-jump-flat", driveTicks: 48 },
    ]),
  ).toMatchObject({ savedTicks: 2 });
  expect(() =>
    compareFlatTraversal([
      { ...value, scenario: "sprint-flat", driveTicks: 50 },
      { ...value, scenario: "sprint-jump-flat", driveTicks: 70 },
    ]),
  ).toThrow("did not improve");
});

it("requires lateral depth continuity and an observed dive through the submerged throat", () => {
  const value = trial("passed");
  function swimming(scenario: string, middleY: number) {
    return TraversalStatus.parse({
      ...value,
      scenario,
      ticks: 23,
      driveTicks: 3,
      samples: Array.from({ length: 23 }, (_, index) => ({
        ...value.samples[0],
        tick: index + 1,
        position: [
          index < 21 ? 401.5 : index === 21 ? 403.5 : 407.5,
          index === 21 ? middleY : 98,
          402.5,
        ],
      })),
    });
  }
  expect(summarizeTraversal(swimming("water-lateral", 98)).reached).toBe(true);
  expect(() => summarizeTraversal(swimming("water-lateral", 96))).toThrow(
    "gratuitously changed depth",
  );
  expect(summarizeTraversal(swimming("water-throat", 96)).reached).toBe(true);
  expect(() => summarizeTraversal(swimming("water-throat", 98))).toThrow(
    "not actually traversed",
  );
});

it("requires observed climbing while actually immersed for the waterlogged ladder", () => {
  const value = trial("passed");
  const wet = TraversalStatus.parse({
    ...value,
    scenario: "wet-ladder",
    samples: value.samples.map((sample, index) => ({
      ...sample,
      position: index < 21 ? [401.5, 100, 402.5] : [401.5, 105, 401.5],
      inWater: index === 20,
      climbing: index === 20,
    })),
  });
  expect(summarizeTraversal(wet).reached).toBe(true);
  expect(() =>
    summarizeTraversal({
      ...wet,
      samples: wet.samples.map((sample) => ({ ...sample, inWater: false })),
    }),
  ).toThrow("not actually climbed while immersed");
});
