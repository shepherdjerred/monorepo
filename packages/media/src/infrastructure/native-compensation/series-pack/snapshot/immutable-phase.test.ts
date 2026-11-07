import { expect, test } from "vitest";
import { sealSeriesPackNativePhaseDataV1 } from "./immutable-phase.ts";

test("one phase seals shared nested parents and detects Date internal mutation", () => {
  const date = new Date("2026-10-28T00:00:00.000Z");
  const entry = { checksum: "actual", createdAt: date, sizeBytes: 123n };
  const graph = { entries: [entry], shared: entry };
  const assertCurrent = sealSeriesPackNativePhaseDataV1(graph);
  assertCurrent();
  expect(() => {
    entry.checksum = "substituted";
  }).toThrow(TypeError);
  expect(() => graph.entries.push(entry)).toThrow(TypeError);
  expect(() => {
    graph.shared = { ...entry };
  }).toThrow(TypeError);
  assertCurrent();
  date.setTime(date.getTime() + 1);
  expect(assertCurrent).toThrow("timestamps changed");
});

test("the data seal rejects process capabilities instead of freezing their runtime", () => {
  expect(() => sealSeriesPackNativePhaseDataV1({ budget: new Map() })).toThrow(
    "validated data",
  );
  expect(() => sealSeriesPackNativePhaseDataV1({ check: () => true })).toThrow(
    "validated data",
  );
});
