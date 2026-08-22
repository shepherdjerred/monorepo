import { describe, expect, test } from "vitest";
import { captureFlowToday, parseSimulatorToday } from "./simulator-date";

const readToday = (): string => "2026-08-08\n";

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

describe("captureFlowToday", () => {
  test("captures only the dated flows at their boundary", () => {
    expect(captureFlowToday("01-create-task.yaml", readToday)).toBe(
      "2026-08-08",
    );
    expect(
      captureFlowToday("08-contextual-quick-capture.yaml", readToday),
    ).toBe("2026-08-08");
    expect(captureFlowToday("03-recurring-complete.yaml", readToday)).toBe("");
  });
});
