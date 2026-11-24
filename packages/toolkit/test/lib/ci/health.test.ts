import { expect, test } from "vitest";
import { buildPrHealthReport, type PrHealthEvidence } from "#lib/ci/health.ts";
import { ciFixture, CI_HEAD } from "./fixtures.ts";

function evidence(): PrHealthEvidence {
  const snapshot = ciFixture();
  return {
    snapshot,
    pr: {
      number: 99,
      title: "Test PR",
      url: snapshot.pr.html_url,
      headRefName: "feature",
      headRefOid: CI_HEAD,
      baseRefName: "main",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      reviewDecision: null,
    },
    merge: {
      hasConflicts: false,
      conflictingFiles: [],
      upToDate: false,
      baseBranch: "main",
      headSha: CI_HEAD,
    },
    githubChecks: [],
    ciPipeline: snapshot.pipeline,
    reviews: [],
  };
}

test("PR health shares readiness when only optional work is still running", () => {
  const input = evidence();
  if (input.ciPipeline === null) throw new Error("Missing pipeline fixture");
  input.ciPipeline.status = "running";
  input.ciPipeline.workflows.push({ name: "optional", state: "running" });
  const report = buildPrHealthReport(input);
  expect(report.overallStatus).toBe("HEALTHY");
  expect(report.nextSteps).toEqual([]);
});

test("PR health retains pending publication and keeps work moving when main is red", () => {
  const input = evidence();
  if (input.snapshot === undefined) throw new Error("Missing snapshot fixture");
  input.snapshot.checks = [];
  expect(buildPrHealthReport(input).overallStatus).toBe("PENDING");
  input.snapshot.main.state = "red";
  const report = buildPrHealthReport(input);
  // A red main is surfaced but does not override the PR's own pending verdict.
  expect(report.overallStatus).toBe("PENDING");
  expect(report.nextSteps.join(" ")).toContain("keep working");
  expect(report.nextSteps.join(" ")).toContain(
    "repair main if your changes caused the failure, or claim/post a notice (--owner me) to fix an unowned blocker",
  );
  expect(report.nextSteps.join(" ")).not.toContain("fix hard failures");
});

test("PR health reports a ready PR against a red main as main red", () => {
  const input = evidence();
  if (input.snapshot === undefined) throw new Error("Missing snapshot fixture");
  input.snapshot.main.state = "red";
  const report = buildPrHealthReport(input);
  expect(report.overallStatus).toBe("UNHEALTHY");
  expect(report.nextSteps.join(" ")).toContain(
    "The PR is ready, but main is red",
  );
});

test.each([
  {
    githubState: "PENDING",
    bucket: "pending",
    snapshotState: "pending" as const,
    expectedStatus: "PENDING" as const,
  },
  {
    githubState: "FAILURE",
    bucket: "fail",
    snapshotState: "fail" as const,
    expectedStatus: "UNHEALTHY" as const,
  },
])(
  "PR health surfaces $githubState ci/code-review in CI Status and Merge Readiness",
  ({ githubState, bucket, snapshotState, expectedStatus }) => {
    const input = evidence();
    if (input.snapshot === undefined)
      throw new Error("Missing snapshot fixture");
    input.snapshot.rules.checks.push({ name: "ci/code-review", appId: null });
    input.snapshot.checks.push({
      name: "ci/code-review",
      state: snapshotState,
      url: null,
      appId: null,
    });
    const report = buildPrHealthReport({
      ...input,
      githubChecks: [
        {
          name: "ci/code-review",
          state: githubState,
          bucket,
        },
      ],
    });
    expect(report.overallStatus).toBe(expectedStatus);
    const ciStatus = report.checks.find((check) => check.name === "CI Status");
    expect(ciStatus?.status).toBe(expectedStatus);
    expect(ciStatus?.details).toContain(
      `GitHub check "ci/code-review" - ${githubState}`,
    );
    const readiness = report.checks.find(
      (check) => check.name === "Merge Readiness",
    );
    expect(readiness?.status).toBe(expectedStatus);
    if (expectedStatus === "UNHEALTHY") {
      expect(readiness?.details).toContain("ci/code-review failed");
    }
  },
);
