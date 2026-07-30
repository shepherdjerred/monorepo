import { describe, expect, test } from "bun:test";
import {
  automatedReviewFinding,
  parseBuildkiteBuild,
  severityFromBody,
} from "@shepherdjerred/pr-fleet-controller/src/evidence-parsers.ts";
import { WorkerResultSchema } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

describe("external evidence parsing", () => {
  test("keeps automated unknown-severity findings blocking", () => {
    const finding = automatedReviewFinding({
      id: "review",
      author: "greptile-apps",
      body: "This changes retry behavior.",
      commit: "old",
      headSha: "new",
    });
    expect(finding?.severity).toBe("unknown");
    expect(finding?.outdated).toBe(true);
    expect(
      automatedReviewFinding({
        id: "clean",
        author: "codex",
        body: "No findings.",
        commit: "new",
        headSha: "new",
      }),
    ).toBeNull();
    expect(severityFromBody("[P2] Broken invariant")).toBe("P2");
  });

  test("validates Buildkite job metadata without loose casts", () => {
    const build = parseBuildkiteBuild(
      JSON.stringify({
        commit: "abc",
        jobs: [
          {
            id: "job",
            name: "verify",
            state: "failed",
            web_url: "https://buildkite.com/example/builds/1#job",
            started_at: "2026-07-29T00:00:00Z",
            soft_failed: false,
          },
        ],
      }),
    );
    expect(build.commit).toBe("abc");
    expect(build.jobs[0]?.name).toBe("verify");
  });
});

test("worker structured output fails closed when required fields are absent", () => {
  expect(() => WorkerResultSchema.parse({ pr: 1, state: "green" })).toThrow();
});
