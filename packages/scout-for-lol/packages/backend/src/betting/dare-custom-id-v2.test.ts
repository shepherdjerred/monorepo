import { describe, expect, test } from "vitest";
import {
  formatDareV2CustomId,
  isDareV2CustomId,
  parseDareV2CustomId,
  type DareV2CustomId,
} from "#src/betting/dare-custom-id-v2.ts";

const CASES: DareV2CustomId[] = [
  {
    kind: "intent",
    intentId: "07cab11b-536f-4c82-9680-3729491f204a",
  },
  { kind: "delete", dareId: 42, revision: 3 },
  {
    kind: "prepare",
    dareId: 42,
    revision: 3,
    action: "accept",
    amount: null,
  },
  {
    kind: "prepare",
    dareId: 42,
    revision: 3,
    action: "contribute",
    amount: 25,
  },
];

describe("Dare v2 Discord custom IDs", () => {
  test.each(CASES)("round-trips $kind controls", (input) => {
    const formatted = formatDareV2CustomId(input);
    expect(formatted.length).toBeLessThanOrEqual(100);
    expect(isDareV2CustomId(formatted)).toBe(true);
    expect(parseDareV2CustomId(formatted)).toEqual(input);
  });

  test("rejects malformed, unknown-version, and out-of-range controls", () => {
    expect(parseDareV2CustomId("bbd2:2:x:1:1")).toBeUndefined();
    expect(parseDareV2CustomId("bbd2:1:q:1:1:z:0")).toBeUndefined();
    expect(parseDareV2CustomId("bbd2:1:q:0:1:a:0")).toBeUndefined();
    expect(parseDareV2CustomId("bbd:1:c:7")).toBeUndefined();
  });
});
