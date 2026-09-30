import { describe, expect, test } from "vitest";
import { childSyncTimeoutSeconds } from "./argocd-child-sync-timeout.ts";

// Arbitrary floor values: this tests the minimum-budget semantics, not the
// real budgets, which live in temporal-release-budgets.ts.
const FLOORS: ReadonlyMap<string, number> = new Map([["temporal", 1200]]);

describe("childSyncTimeoutSeconds", () => {
  test("raises a floored child to its minimum budget", () => {
    expect(childSyncTimeoutSeconds("temporal", 300, FLOORS)).toBe(1200);
  });

  test("leaves every other child on the pipeline default", () => {
    expect(childSyncTimeoutSeconds("apps", 300, FLOORS)).toBe(300);
    expect(childSyncTimeoutSeconds("prometheus", 300, FLOORS)).toBe(300);
  });

  test("treats the floor as a minimum when the default is higher", () => {
    expect(childSyncTimeoutSeconds("temporal", 3600, FLOORS)).toBe(3600);
  });
});
