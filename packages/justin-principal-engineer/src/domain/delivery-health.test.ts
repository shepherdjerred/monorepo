import { describe, expect, test } from "vitest";

import {
  deliveryIsHealthy,
  deliveryNeedsRestack,
} from "#src/domain/delivery-health.ts";
import type { PrHealth } from "#src/domain/schemas.ts";

function health(mergeStatus: "HEALTHY" | "PENDING" | "UNHEALTHY"): PrHealth {
  return {
    prNumber: 42,
    prUrl: "https://github.com/shepherdjerred/monorepo",
    overallStatus: mergeStatus,
    checks: [
      { name: "Merge Conflicts", status: mergeStatus, details: [] },
      { name: "CI Status", status: "HEALTHY", details: [] },
      { name: "Approval", status: "PENDING", details: [] },
    ],
    nextSteps: [],
  };
}

describe("delivery health", () => {
  test("treats an out-of-date base as a restack transition", () => {
    const report = health("PENDING");

    expect(deliveryNeedsRestack(report)).toBe(true);
    expect(deliveryIsHealthy(report)).toBe(false);
  });

  test("accepts green CI independently of owner approval", () => {
    const report = health("HEALTHY");

    expect(deliveryNeedsRestack(report)).toBe(false);
    expect(deliveryIsHealthy(report)).toBe(true);
  });
});
