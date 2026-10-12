import { describe, expect, test } from "vitest";
import {
  formatDareCustomId,
  isDareCustomId,
  parseDareCustomId,
  type DareCustomId,
} from "#src/betting/dares/lifecycle/dare-custom-id.ts";

const CASES: DareCustomId[] = [
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

describe("Dare Discord custom IDs", () => {
  test.each(CASES)("round-trips $kind controls", (input) => {
    const formatted = formatDareCustomId(input);
    expect(formatted.length).toBeLessThanOrEqual(100);
    expect(isDareCustomId(formatted)).toBe(true);
    expect(parseDareCustomId(formatted)).toEqual(input);
  });

  test("rejects malformed, unknown-version, and out-of-range controls", () => {
    expect(parseDareCustomId("bbd2:2:x:1:1")).toBeUndefined();
    expect(parseDareCustomId("bbd2:1:q:1:1:z:0")).toBeUndefined();
    expect(parseDareCustomId("bbd2:1:q:0:1:a:0")).toBeUndefined();
    expect(parseDareCustomId("bbd:1:c:7")).toBeUndefined();
  });
});
