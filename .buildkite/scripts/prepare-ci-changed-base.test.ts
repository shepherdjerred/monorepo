import { expect, test } from "bun:test";
import { laneMetadata, selectBase } from "./migration-core.ts";

test("selects the newest green commit other than the head", () => {
  expect(selectBase([{ commit: "head" }, { commit: "base" }], "head")).toBe(
    "base",
  );
});

test("rejects malformed API data", () => {
  expect(() => selectBase({}, "head")).toThrow("array");
  expect(() => selectBase([{}, { commit: "" }], "head")).toThrow(
    "no earlier green commit",
  );
});

test("precomputes non-Bun lane decisions with fail-open metadata defaults", () => {
  expect(laneMetadata("resume", false, "base")).toEqual({
    "ci-lane-run-resume": "false",
    "ci-lane-decision-resume": "skipped — unchanged since base",
  });
  expect(laneMetadata("playwright", true, "base")).toEqual({
    "ci-lane-run-playwright": "true",
    "ci-lane-decision-playwright": "ran — matching changes since base",
  });
});
