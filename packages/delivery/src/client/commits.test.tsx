import { describe, expect, it } from "vitest";
import type {
  CommitService,
  CommitStatus,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import {
  commitStatement,
  parseSha,
  rowNotes,
  unchangedLine,
} from "./routes/commit-model.ts";

const build = (serviceId: string, outcome: "verified" | "failed") => ({
  id: `${serviceId}-build`,
  serviceId,
  sourceRevision: "3".repeat(40),
  sourceKind: "ci" as const,
  ciUrl: null,
  status: outcome,
  qualificationReason: null,
  platformChanges: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  pipelineNumber: 18_050,
  links: [],
});

function changed(
  id: string,
  state: CommitService["environments"][number]["state"],
): CommitService {
  return {
    service: { id, title: id.toUpperCase(), kind: "product", links: [] },
    build: build(id, "verified"),
    versionSet: { id: `${id}/set`, revision: 5 },
    verdict:
      state === "live" || state === "superseded" ? "deployed" : "waiting",
    environments: [
      { environmentId: `${id}/prod`, name: "prod", state, deploymentId: null },
    ],
  };
}

function status(overrides: Partial<CommitStatus>): CommitStatus {
  return {
    sha: "3".repeat(40),
    title: null,
    author: null,
    verdict: "deployed",
    buildId: "b",
    seenAt: null,
    environments: [],
    changed: [],
    unchangedCount: 0,
    failedBuilds: [],
    pendingBuilds: [],
    blocker: null,
    ...overrides,
  };
}

describe("commit statement", () => {
  it("does not contradict itself when CI failed for one service and newer commits carry the rest", () => {
    const statement = commitStatement(
      status({
        verdict: "build_failed",
        failedBuilds: [build("scout-frontend", "failed")],
        changed: ["media", "delivery", "scout"].map((id) =>
          changed(id, "superseded"),
        ),
      }),
    );
    expect(statement).toBe(
      "CI failed for 1 service, so Delivery published nothing for it. All 3 changed services are live because newer commits include them.",
    );
    expect(statement).not.toContain("nothing from this commit was published");
  });

  it("keeps the plain sentence when CI failed for everything", () => {
    expect(
      commitStatement(
        status({
          verdict: "build_failed",
          failedBuilds: [build("birmel", "failed")],
        }),
      ),
    ).toBe("CI failed, so nothing from this commit was published.");
  });

  it("names the environment that is blocking and why", () => {
    expect(
      commitStatement(
        status({
          verdict: "waiting",
          changed: [changed("scout", "manual"), changed("media", "live")],
          blocker: { service: "SCOUT", environment: "prod", state: "manual" },
        }),
      ),
    ).toBe(
      "Nothing that would deliver it is queued or running. 1 of 2 changed services are live. SCOUT prod needs a manual promotion or release; nothing is in flight.",
    );
  });
});

describe("commit row notes", () => {
  const row: CommitSummary = {
    sha: "3".repeat(40),
    title: null,
    author: null,
    verdict: "build_failed",
    seenAt: null,
    blocker: null,
    changedCount: 5,
    liveCount: 5,
    environments: [],
    buildId: "b",
    failedBuildCount: 1,
  };

  it("says CI failed for how many services beside the tallies", () => {
    expect(rowNotes(row)).toEqual(["CI failed for 1 service"]);
  });

  it("names the blocking environment by its own words, never deploying when nothing is", () => {
    expect(
      rowNotes({
        ...row,
        verdict: "recovery_required",
        failedBuildCount: 0,
        blocker: {
          service: "Temporal",
          environment: "prod",
          state: "recovery_required",
        },
      }),
    ).toEqual(["Temporal / prod: recovery required"]);
  });
});

describe("commit finder and counts", () => {
  it("trims a pasted SHA and refuses anything but 7 to 40 hex digits", () => {
    expect(parseSha("  0F18E58\n")).toBe("0f18e58");
    expect(parseSha("0f18e5")).toBeNull();
    expect(parseSha("not-a-sha")).toBeNull();
  });

  it("counts the unchanged services in good grammar", () => {
    expect(unchangedLine(1)).toBe(
      "1 other service built with nothing to deploy.",
    );
    expect(unchangedLine(3)).toBe(
      "3 other services built with nothing to deploy.",
    );
  });
});
