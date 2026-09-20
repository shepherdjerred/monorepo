import { describe, expect, test } from "vitest";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import type { GitHubCheck, PullRequest } from "#lib/github/types.ts";
import { buildPrHealthReport, ciHealth } from "#commands/pr/health.ts";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function pipeline(
  status: string,
  workflows: WoodpeckerPipeline["workflows"] = [],
): WoodpeckerPipeline {
  return { number: 1234, commit: HEAD_SHA, status, workflows };
}

function workflow(
  state: string,
  name = "verify",
): WoodpeckerPipeline["workflows"][number] {
  return { name, state };
}

function githubCheck(bucket: string, name = "ci/woodpecker/pr"): GitHubCheck {
  return {
    name,
    state: bucket.toUpperCase(),
    bucket,
    link: "https://woodpecker.sjer.red/repos/1/pipeline/1234",
  };
}

describe("PR health CI fixtures", () => {
  test("passing exact-head pipeline is healthy", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pass")],
      pipeline("success"),
    );
    expect(result.status).toBe("HEALTHY");
    expect(result.details).toContain(
      "Woodpecker pipeline #1234 for exact head 0123456789ab: SUCCESS",
    );
  });

  test("running exact-head pipeline is pending", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      pipeline("running"),
    );
    expect(result.status).toBe("PENDING");
  });

  test("running pipeline with a failed workflow is unhealthy", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      pipeline("running", [workflow("failure", "failed-workflow")]),
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.commands).toContain(
      "toolkit woodpecker pipeline log show shepherdjerred/monorepo 1234",
    );
  });

  test("pending exact-head pipeline is pending", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      pipeline("pending"),
    );
    expect(result.status).toBe("PENDING");
  });

  test("failed pipeline is unhealthy and prints a log command per workflow", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("fail")],
      pipeline("failure", [workflow("failure", "typecheck")]),
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.details.join("\n")).toContain("typecheck");
    expect(result.commands).toContain(
      "toolkit woodpecker pipeline log show shepherdjerred/monorepo 1234",
    );
  });

  test("killed pipeline is unhealthy", () => {
    expect(
      ciHealth(HEAD_SHA, [githubCheck("cancel")], pipeline("killed")).status,
    ).toBe("UNHEALTHY");
  });

  /** A skipped or declined pipeline never ran the gates. */
  test.each(["skipped", "declined", "error"])(
    "terminal %s pipeline is unhealthy",
    (state) => {
      expect(ciHealth(HEAD_SHA, [], pipeline(state)).status).toBe("UNHEALTHY");
    },
  );

  test("absent exact-head pipeline is pending", () => {
    const result = ciHealth(HEAD_SHA, [], null);
    expect(result.status).toBe("PENDING");
    expect(result.details[0]).toContain("No Woodpecker pipeline found");
    expect(result.commands).toContain(
      "toolkit woodpecker pipeline ls shepherdjerred/monorepo",
    );
  });

  test("authoritative success wins over stale failed GitHub metadata", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("fail")],
      pipeline("success"),
    );
    expect(result.status).toBe("HEALTHY");
    expect(result.details).toContain(
      "GitHub's check metadata disagrees with authoritative pipeline #1234; trusting Woodpecker",
    );
  });

  test("authoritative failure wins over stale passing GitHub metadata", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pass")],
      pipeline("failure"),
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.details).toContain(
      "GitHub's check metadata disagrees with authoritative pipeline #1234; trusting Woodpecker",
    );
  });

  test("external GitHub checks still contribute to health", () => {
    const result = ciHealth(
      HEAD_SHA,
      [
        {
          name: "external/security",
          state: "FAILURE",
          bucket: "fail",
          link: "https://example.test/check",
        },
      ],
      pipeline("success"),
    );
    expect(result.status).toBe("UNHEALTHY");
  });

  /**
   * There is no soft-failure state any more. The advisory scanners decide
   * inside their own command whether findings are fatal and exit 0 when they
   * are not, so a findings-only Trivy run reports success rather than needing
   * the health check to know it is advisory.
   */
  test("an advisory lane that found something still reports success", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pass")],
      pipeline("success", [workflow("success", "trivy")]),
    );
    expect(result.status).toBe("HEALTHY");
    expect(result.details.join("\n")).not.toContain("trivy");
  });

  test("unfinished workflows are not reported as failures", () => {
    const result = ciHealth(
      HEAD_SHA,
      [],
      pipeline("running", [workflow("running", "images")]),
    );
    expect(result.status).toBe("PENDING");
    expect(result.details.join("\n")).not.toContain("images");
  });

  test("mixed passed and pending checks match a running pipeline", () => {
    const result = ciHealth(
      HEAD_SHA,
      [
        githubCheck("pending", "ci/woodpecker/pr"),
        githubCheck("pass", "ci/woodpecker/pr/verify"),
      ],
      pipeline("running"),
    );
    expect(result.details.join("\n")).not.toContain("does not match");
  });
});

const PR: PullRequest = {
  number: 99,
  title: "Test PR",
  url: "https://github.com/shepherdjerred/monorepo/pull/99",
  headRefName: "feature",
  headRefOid: HEAD_SHA,
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "APPROVED",
};

describe("PR health report", () => {
  test("keeps the established top-level JSON shape", () => {
    const report = buildPrHealthReport({
      pr: PR,
      merge: {
        hasConflicts: false,
        conflictingFiles: [],
        upToDate: true,
        baseBranch: "main",
        headSha: HEAD_SHA,
      },
      githubChecks: [githubCheck("pass")],
      ciPipeline: pipeline("success"),
      reviews: [{ author: "reviewer", state: "APPROVED" }],
    });
    expect(Object.keys(report)).toEqual([
      "prNumber",
      "prUrl",
      "overallStatus",
      "checks",
      "nextSteps",
    ]);
    expect(report.overallStatus).toBe("HEALTHY");
  });

  test("merge-tree conflicts make the report unhealthy", () => {
    const report = buildPrHealthReport({
      pr: PR,
      merge: {
        hasConflicts: true,
        conflictingFiles: ["src/conflict.ts"],
        upToDate: false,
        baseBranch: "main",
        headSha: HEAD_SHA,
      },
      githubChecks: [githubCheck("pass")],
      ciPipeline: pipeline("success"),
      reviews: [{ author: "reviewer", state: "APPROVED" }],
    });
    expect(report.overallStatus).toBe("UNHEALTHY");
    expect(report.checks[0]?.details).toContain(
      "Conflicting file: src/conflict.ts",
    );
  });
});
