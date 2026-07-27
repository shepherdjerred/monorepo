import { expect, test } from "bun:test";
import { outcomeIcon, summaryLanes, summarySteps } from "./migration-core.ts";

test("summary has unique step and lane keys", () => {
  expect(new Set(summarySteps).size).toBe(summarySteps.length);
  expect(new Set(summaryLanes).size).toBe(summaryLanes.length);
});

test("only passed outcomes are green", () => {
  expect(outcomeIcon("passed")).toBe(":white_check_mark:");
  expect(outcomeIcon("failed")).toBe(":x:");
});
