import { expect, test } from "bun:test";
import {
  attributeTurretSides,
  ReplayTurretSideValidationError,
} from "./replay-turret-sides.mjs";

const binding = {
  verified: [
    { context: 34, footerRow: 2 },
    { context: 35, footerRow: 8 },
  ],
  unresolved: [36],
};
const events = [
  { context: 70, secondTimeBits: 100 },
  { context: 71, secondTimeBits: 200 },
];
const evidence = new Map([
  [100, new Set([34])],
  [200, new Set([35])],
]);

test("resolves the opposite defending team and reconciles the aggregate footer losses", () => {
  expect(
    attributeTurretSides(events, evidence, evidence, binding, [1, 1]),
  ).toEqual([
    { ...events[0], defendingPartition: 1 },
    { ...events[1], defendingPartition: 0 },
  ]);
  expect(
    attributeTurretSides([], new Map(), new Map(), binding, [0, 0]),
  ).toEqual([]);
});

test("preserves events with absent, unresolved, or mixed same-clock evidence", () => {
  for (const primary of [
    new Map([[101, new Set([34])]]),
    new Map([[100, new Set([36])]]),
    new Map([[100, new Set([34, 36])]]),
    new Map([[100, new Set([34, 35])]]),
  ]) {
    expect(
      attributeTurretSides(events, primary, evidence, binding, [1, 1]),
    ).toEqual(events.map((event) => ({ ...event, defendingPartition: null })));
  }
});

test("unresolved corroborators leave the side unknown while non-roster packets can be ignored", () => {
  const mixed = new Map([
    [100, new Set([34, 36])],
    [200, new Set([35, 301])],
  ]);
  const primary = new Map([
    [100, new Set([34])],
    [200, new Set([35, 301])],
  ]);
  expect(attributeTurretSides(events, primary, mixed, binding, [1, 1])).toEqual(
    [
      { ...events[0], defendingPartition: null },
      { ...events[1], defendingPartition: 0 },
    ],
  );
});

test("fails typed on an opposing witness or overflowing footer partition", () => {
  expect(() =>
    attributeTurretSides(
      events,
      evidence,
      new Map([[100, new Set([35])]]),
      binding,
      [1, 1],
    ),
  ).toThrow(ReplayTurretSideValidationError);
  expect(() =>
    attributeTurretSides(events, evidence, evidence, binding, [2, 0]),
  ).toThrow("differ from footer losses");
});
