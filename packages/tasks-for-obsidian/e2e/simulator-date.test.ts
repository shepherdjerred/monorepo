import { describe, expect, test } from "bun:test";
import { parseSimulatorToday } from "./simulator-date";

describe("parseSimulatorToday", () => {
  test("accepts a simulator-local calendar date", () => {
    expect(parseSimulatorToday("2026-08-08\n")).toBe("2026-08-08");
  });

  test("rejects malformed simulator output", () => {
    expect(() => parseSimulatorToday("Sat Aug 8")).toThrow(
      "simulator returned an invalid date",
    );
  });
});
