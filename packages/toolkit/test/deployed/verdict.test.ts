import { test, expect, describe } from "bun:test";
import { computeVerdict } from "#commands/deployed/deployed.ts";
import type { ArgoStatus } from "#lib/deployed/types.ts";

const base: Parameters<typeof computeVerdict>[0] = {
  pinExists: true,
  writingIsBump: true,
  merged: true,
  commitInImage: true,
  argo: null,
  pinBuild: 3637,
  digestMatch: false,
};

describe("computeVerdict ladder", () => {
  test("no pin → UNKNOWN", () => {
    expect(computeVerdict({ ...base, pinExists: false })).toBe("UNKNOWN");
  });

  test("NOT_MERGED outranks NO_IMAGE (regression: ladder order)", () => {
    // Unmerged commit on a seed-pinned (never-built) service must report
    // NOT_MERGED, not NO_IMAGE — the more actionable signal.
    expect(
      computeVerdict({ ...base, merged: false, writingIsBump: false }),
    ).toBe("NOT_MERGED");
  });

  test("merged + seed pin → NO_IMAGE", () => {
    expect(computeVerdict({ ...base, writingIsBump: false })).toBe("NO_IMAGE");
  });

  test("merged, real bump, commit not in image → PENDING", () => {
    expect(computeVerdict({ ...base, commitInImage: false })).toBe("PENDING");
  });

  test("commit in image + pod digest match → RUNNING", () => {
    expect(computeVerdict({ ...base, digestMatch: true })).toBe("RUNNING");
  });

  test("commit in image, argo chart ≥ pin, no digest match → SYNCED", () => {
    const argo: ArgoStatus = {
      app: "birmel",
      syncStatus: "Synced",
      healthStatus: "Healthy",
      revision: "2.0.0-3668",
      revisionBuild: 3668,
    };
    expect(computeVerdict({ ...base, argo })).toBe("SYNCED");
  });

  test("commit in image, cluster unknown → PINNED", () => {
    expect(computeVerdict(base)).toBe("PINNED");
  });
});
