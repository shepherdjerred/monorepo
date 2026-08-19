import { describe, expect, test } from "bun:test";
import type { BuildkiteBuild } from "#lib/buildkite/ci.ts";
import type { GitHubCheck, PullRequest } from "#lib/github/types.ts";
import { buildPrHealthReport, ciHealth } from "#commands/pr/health.ts";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function build(
  state: string,
  jobs: BuildkiteBuild["jobs"] = [],
): BuildkiteBuild {
  return {
    number: 1234,
    commit: HEAD_SHA,
    state,
    web_url: "https://buildkite.com/sjerred/monorepo/builds/1234",
    jobs,
  };
}

function job(
  state: string,
  softFailed = false,
  id = "job-uuid",
): BuildkiteBuild["jobs"][number] {
  return {
    id,
    name: id,
    state,
    web_url: `https://buildkite.com/sjerred/monorepo/builds/1234#${id}`,
    soft_failed: softFailed,
  };
}

function githubCheck(
  bucket: string,
  name = "buildkite/monorepo/pr",
): GitHubCheck {
  return {
    name,
    state: bucket.toUpperCase(),
    bucket,
    link: "https://buildkite.com/sjerred/monorepo/builds/1234",
  };
}

describe("PR health CI fixtures", () => {
  test("passing exact-head Buildkite build is healthy", () => {
    const result = ciHealth(HEAD_SHA, [githubCheck("pass")], build("passed"));
    expect(result.status).toBe("HEALTHY");
    expect(result.details).toContain(
      "Buildkite build #1234 for exact head 0123456789ab: PASSED",
    );
  });

  test("running exact-head Buildkite build is pending", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      build("running"),
    );
    expect(result.status).toBe("PENDING");
  });

  test("running build with a hard-failed job is unhealthy", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      build("running", [job("failed", false, "failed-job")]),
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.commands).toContain("toolkit bk job log failed-job --agent");
  });

  test("waiting exact-head Buildkite build is pending", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("pending")],
      build("waiting"),
    );
    expect(result.status).toBe("PENDING");
  });

  test("failed build is unhealthy and prints per-job log commands", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("fail")],
      build("failed", [
        {
          id: "job-uuid",
          name: "Typecheck",
          state: "failed",
          web_url:
            "https://buildkite.com/sjerred/monorepo/builds/1234#job-uuid",
        },
      ]),
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.commands).toContain("toolkit bk job log job-uuid --agent");
  });

  test("canceled build is unhealthy", () => {
    expect(
      ciHealth(HEAD_SHA, [githubCheck("cancel")], build("canceled")).status,
    ).toBe("UNHEALTHY");
  });

  test.each(["skipped", "not_run"])(
    "terminal %s build is unhealthy",
    (state) => {
      expect(ciHealth(HEAD_SHA, [], build(state)).status).toBe("UNHEALTHY");
    },
  );

  test("absent exact-head Buildkite build is pending", () => {
    const result = ciHealth(HEAD_SHA, [], null);
    expect(result.status).toBe("PENDING");
    expect(result.details[0]).toContain("No Buildkite build found");
    expect(result.commands).toContain(
      `toolkit bk build list --pipeline sjerred/monorepo --commit ${HEAD_SHA}`,
    );
  });

  test("authoritative passed Buildkite state wins over stale failed GitHub metadata", () => {
    const result = ciHealth(HEAD_SHA, [githubCheck("fail")], build("passed"));
    expect(result.status).toBe("HEALTHY");
    expect(result.details).toContain(
      "GitHub's Buildkite check metadata does not match authoritative build #1234; using Buildkite",
    );
  });

  test("authoritative failed Buildkite state wins over stale passing GitHub metadata", () => {
    const result = ciHealth(HEAD_SHA, [githubCheck("pass")], build("failed"));
    expect(result.status).toBe("UNHEALTHY");
    expect(result.details).toContain(
      "GitHub's Buildkite check metadata does not match authoritative build #1234; using Buildkite",
    );
  });

  test("non-Buildkite GitHub checks still contribute to health", () => {
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
      build("passed"),
    );
    expect(result.status).toBe("UNHEALTHY");
  });

  test("soft-failed Buildkite jobs do not make a passed build unhealthy", () => {
    const result = ciHealth(
      HEAD_SHA,
      [githubCheck("fail")],
      build("passed", [
        {
          id: "soft-job",
          name: "Trivy findings",
          state: "failed",
          web_url:
            "https://buildkite.com/sjerred/monorepo/builds/1234#soft-job",
          soft_failed: true,
        },
      ]),
    );
    expect(result.status).toBe("HEALTHY");
    expect(result.commands).not.toContain(
      "toolkit bk job log soft-job --agent",
    );
  });

  test("conditionally broken jobs are not reported as hard failures", () => {
    const result = ciHealth(
      HEAD_SHA,
      [],
      build("running", [job("broken", false, "conditional-job")]),
    );
    expect(result.status).toBe("PENDING");
    expect(result.details.join("\n")).not.toContain("conditional-job");
    expect(result.commands).not.toContain(
      "toolkit bk job log conditional-job --agent",
    );
  });

  test("mixed passed and pending Buildkite checks match a running build", () => {
    const result = ciHealth(
      HEAD_SHA,
      [
        githubCheck("pending", "buildkite/monorepo/pr"),
        githubCheck("pass", "buildkite/monorepo/pr/upload"),
      ],
      build("running"),
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
      buildkiteBuild: build("passed"),
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
      buildkiteBuild: build("passed"),
      reviews: [{ author: "reviewer", state: "APPROVED" }],
    });
    expect(report.overallStatus).toBe("UNHEALTHY");
    expect(report.checks[0]?.details).toContain(
      "Conflicting file: src/conflict.ts",
    );
  });
});
