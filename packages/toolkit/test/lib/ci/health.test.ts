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

test("PR health retains pending publication and gives main-red stop guidance", () => {
  const input = evidence();
  if (input.snapshot === undefined) throw new Error("Missing snapshot fixture");
  input.snapshot.checks = [];
  expect(buildPrHealthReport(input).overallStatus).toBe("PENDING");
  input.snapshot.main.state = "red";
  const report = buildPrHealthReport(input);
  expect(report.overallStatus).toBe("UNHEALTHY");
  expect(report.nextSteps.join(" ")).toContain("Do not repair main");
  expect(report.nextSteps.join(" ")).not.toContain("fix hard failures");
});
