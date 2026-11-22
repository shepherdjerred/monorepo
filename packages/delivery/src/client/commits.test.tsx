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
  tallyText,
  unchangedLine,
  verdictView,
} from "./routes/commit-model.ts";

const NEWER = "69765c4ae8".padEnd(40, "0");

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

  it("says a failed build a newer passing commit includes was not built on its own, instead of CI failed", () => {
    const failed = build("ci", "failed");
    const statement = commitStatement(
      status({
        verdict: "nothing_to_deploy",
        failedBuilds: [failed],
        carriedFailures: [{ buildId: failed.id, includedIn: NEWER }],
      }),
    );
    expect(statement).toBe(
      "CI failed for 1 service here, so it was not built on its own; included in 69765c4, which passed.",
    );
    expect(statement).not.toContain("nothing from this commit was published");
    expect(statement).not.toContain("changed nothing");
  });

  it("leads with the real blocker when the only CI failure is carried by a newer commit", () => {
    const failed = build("ci", "failed");
    expect(
      commitStatement(
        status({
          verdict: "waiting",
          failedBuilds: [failed],
          carriedFailures: [{ buildId: failed.id, includedIn: NEWER }],
          changed: [
            changed("temporal-data", "manual"),
            changed("media", "live"),
          ],
          blocker: {
            service: "Temporal data layer",
            environment: "prod",
            state: "manual",
          },
        }),
      ),
    ).toBe(
      "Nothing that would deliver it is queued or running. CI failed for 1 service here, so it was not built on its own; included in 69765c4, which passed. 1 of 2 changed services are live. Temporal data layer prod needs a manual promotion or release; nothing is in flight.",
    );
  });

  it("still says CI failed for a failure nothing newer carries beside a more urgent verdict", () => {
    expect(
      commitStatement(
        status({
          verdict: "recovery_required",
          failedBuilds: [build("birmel", "failed")],
          changed: [changed("media", "recovery_required")],
          blocker: {
            service: "MEDIA",
            environment: "prod",
            state: "recovery_required",
          },
        }),
      ),
    ).toBe(
      "A failed deployment locked an environment, so nothing reaches it until an operator recovers it. CI failed for 1 service, so Delivery published nothing for it. 0 of 1 changed service is live. MEDIA prod is locked by a failed deployment until an operator recovers it.",
    );
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

  it("says a carried failure was included in the newer commit, not that CI failed", () => {
    expect(
      rowNotes({
        ...row,
        verdict: "nothing_to_deploy",
        carriedFailures: [{ buildId: "ci-build", includedIn: NEWER }],
      }),
    ).toEqual(["Not built on its own; included in 69765c4, which passed"]);
    expect(
      rowNotes({
        ...row,
        failedBuildCount: 2,
        carriedFailures: [{ buildId: "ci-build", includedIn: NEWER }],
      }),
    ).toEqual([
      "CI failed for 1 service",
      "Not built on its own; included in 69765c4, which passed",
    ]);
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

describe("commit verdict and tallies", () => {
  it("shows a commit whose failures a newer commit carries as included, not nothing to deploy", () => {
    expect(
      verdictView("nothing_to_deploy", [
        { buildId: "ci-build", includedIn: NEWER },
      ]),
    ).toEqual({ status: "not_started", label: "Included in newer" });
    expect(verdictView("nothing_to_deploy").label).toBe("Nothing to deploy");
    expect(
      verdictView("waiting", [{ buildId: "ci-build", includedIn: NEWER }])
        .label,
    ).toBe("Not released");
  });

  it("explains an environment tally in short on screen and in full to a screen reader", () => {
    expect(tallyText({ name: "prod", liveCount: 14, total: 19 })).toEqual({
      short: "prod 14/19 live",
      full: "prod: 14 of 19 changed services live",
    });
    expect(tallyText({ name: "beta", liveCount: 1, total: 1 }).full).toBe(
      "beta: 1 of 1 changed service live",
    );
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
