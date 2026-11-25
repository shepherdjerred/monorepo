import { afterEach, describe, expect, test, vi } from "vitest";
import {
  parseMaxBlockingPriority,
  reviewRecheckCommand,
} from "#commands/pr/review.ts";
import { handlePrCommand } from "#handlers/pr.ts";
import {
  CODE_REVIEW_GATE_CONTEXT,
  codeReviewHarvestVerdict,
  CODEX_GATE_CONTEXT,
  harvestVerdict,
  pipelineNumberFromTargetUrl,
  prCodeReviewWorkflowId,
  nextPageUrl,
  REQUIRED_REVIEW_GATES,
  type GateStatus,
} from "#lib/review/harvest.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Woodpecker restarts at pipeline granularity, so the retry unit is a number. */
const PIPELINE = "9633";
const failed: GateStatus = {
  state: "failure",
  targetUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${PIPELINE}`,
};

test("declares the required Temporal and legacy Codex gate contexts", () => {
  expect(CODE_REVIEW_GATE_CONTEXT).toBe("ci/code-review");
  expect(CODEX_GATE_CONTEXT).toBe("ci/woodpecker/pr/codex-review-gate");
  expect(REQUIRED_REVIEW_GATES).toEqual([
    { providerId: "codex", context: CODEX_GATE_CONTEXT },
  ]);
});

describe("prCodeReviewWorkflowId", () => {
  test("matches Temporal's per-PR workflow ID format", () => {
    const sha = "a".repeat(40);
    expect(prCodeReviewWorkflowId("shepherdjerred/monorepo", 42, sha)).toBe(
      `pr-code-review/shepherdjerred/monorepo/42/${sha}`,
    );
  });

  test("rejects malformed repository slugs", () => {
    expect(() => prCodeReviewWorkflowId("monorepo", 42, "abc")).toThrow(
      "Expected <owner>/<repo>",
    );
    expect(() => prCodeReviewWorkflowId("a/b/c", 42, "abc")).toThrow(
      "Expected <owner>/<repo>",
    );
  });
});

describe("codeReviewHarvestVerdict", () => {
  test("marks failing ci/code-review with zero blocking findings retryable", () => {
    expect(
      codeReviewHarvestVerdict({
        gate: { state: "failure", targetUrl: null },
        blockingCount: 0,
      }),
    ).toEqual({ retryable: true });
  });

  test("refuses non-failing or still-blocked ci/code-review statuses", () => {
    expect(
      codeReviewHarvestVerdict({
        gate: { state: "failure", targetUrl: null },
        blockingCount: 1,
      }),
    ).toEqual({ retryable: false, reason: "1 blocking finding(s) remain" });
    expect(
      codeReviewHarvestVerdict({
        gate: { state: "pending", targetUrl: null },
        blockingCount: 0,
      }),
    ).toEqual({ retryable: false, reason: "gate is pending" });
    expect(
      codeReviewHarvestVerdict({
        gate: null,
        blockingCount: 0,
      }),
    ).toEqual({ retryable: false, reason: "no gate status" });
  });
});

describe("reviewRecheckCommand", () => {
  const head = "b".repeat(40);

  test("infers the open PR, signals Temporal recheckReview, and supports JSON output", async () => {
    const priorTemporalAddress = Bun.env["TEMPORAL_ADDRESS"];
    delete Bun.env["TEMPORAL_ADDRESS"];
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const spawned: {
      cmd: string[];
      env: Record<string, string | undefined>;
    }[] = [];
    try {
      await reviewRecheckCommand(
        undefined,
        { json: true },
        {
          resolvePr: async (prNumber, repo) => {
            expect(prNumber).toBeUndefined();
            expect(repo).toBe("shepherdjerred/monorepo");
            return 128;
          },
          getToken: () => "ghs_secret_token_value",
          fetchHead: async ({ repo, number, token }) => {
            expect(repo).toBe("shepherdjerred/monorepo");
            expect(number).toBe(128);
            expect(token).toBe("ghs_secret_token_value");
            return head;
          },
          resolveTemporalCredentials: () => Promise.resolve(),
          lookupTemporalExecutable: (executable) => {
            expect(executable).toBe("temporal");
            return "/usr/local/bin/temporal";
          },
          spawnSync: (cmd, options) => {
            spawned.push({ cmd, env: options.env });
            return {
              exitCode: 0,
              stdout: new Uint8Array(),
              stderr: new Uint8Array(),
            };
          },
        },
      );
    } finally {
      if (priorTemporalAddress === undefined) {
        delete Bun.env["TEMPORAL_ADDRESS"];
      } else {
        Bun.env["TEMPORAL_ADDRESS"] = priorTemporalAddress;
      }
    }

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.cmd).toEqual([
      "/usr/local/bin/temporal",
      "--profile",
      "homelab",
      "--namespace",
      "prod",
      "workflow",
      "signal",
      "--workflow-id",
      `pr-code-review/shepherdjerred/monorepo/128/${head}`,
      "--name",
      "recheckReview",
    ]);
    expect(JSON.parse(logs[0] ?? "{}")).toEqual({
      repo: "shepherdjerred/monorepo",
      pr: 128,
      head,
      workflowId: `pr-code-review/shepherdjerred/monorepo/128/${head}`,
      signal: "recheckReview",
      signaled: true,
    });

    await reviewRecheckCommand(
      "128",
      {},
      {
        env: { PATH: "/usr/local/bin", TEMPORAL_ADDRESS: "127.0.0.1:7233" },
        resolvePr: async () => 128,
        getToken: () => "ghs_secret_token_value",
        fetchHead: async () => head,
        resolveTemporalCredentials: () => Promise.resolve(),
        lookupTemporalExecutable: () => "/usr/local/bin/temporal",
        spawnSync: (cmd, options) => {
          spawned.push({ cmd, env: options.env });
          return {
            exitCode: 0,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
          };
        },
      },
    );
    expect(spawned[1]?.cmd).toEqual([
      "/usr/local/bin/temporal",
      "--namespace",
      "prod",
      "workflow",
      "signal",
      "--workflow-id",
      `pr-code-review/shepherdjerred/monorepo/128/${head}`,
      "--name",
      "recheckReview",
    ]);
  });

  test("redacts tokens from failed temporal signal stderr", async () => {
    const secret = "ghs_super_secret_token_123456";
    await expect(
      reviewRecheckCommand(
        "55",
        {},
        {
          resolvePr: async () => 55,
          getToken: () => secret,
          fetchHead: async () => head,
          resolveTemporalCredentials: () => Promise.resolve(),
          lookupTemporalExecutable: () => "/usr/local/bin/temporal",
          spawnSync: () => ({
            exitCode: 1,
            stdout: new Uint8Array(),
            stderr: new TextEncoder().encode(
              `workflow not found (auth ${secret})`,
            ),
          }),
        },
      ),
    ).rejects.toThrow("workflow not found (auth [REDACTED])");
  });

  test("surfaces recheck in toolkit pr review --help", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    await handlePrCommand("review", ["--help"]);
    expect(logs.join("\n")).toContain("recheck [PR]");
  });
});

test("rejects malformed blocking-priority configuration", () => {
  expect(() => parseMaxBlockingPriority("2foo")).toThrow(
    "REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3]",
  );
});

describe("pipelineNumberFromTargetUrl", () => {
  test("reads the pipeline number out of the status URL", () => {
    expect(pipelineNumberFromTargetUrl(failed.targetUrl)).toBe(PIPELINE);
    expect(
      pipelineNumberFromTargetUrl(
        `https://woodpecker.sjer.red/repos/1/pipeline/${PIPELINE}/2`,
      ),
    ).toBe(PIPELINE);
  });

  // Anything non-null here is reported as retryable and handed straight to
  // `woodpecker-cli pipeline start`, so the match has to be strict.
  test("returns null for a URL that names no pipeline", () => {
    expect(
      pipelineNumberFromTargetUrl("https://woodpecker.sjer.red/repos/1"),
    ).toBeNull();
    expect(
      pipelineNumberFromTargetUrl("https://woodpecker.sjer.red/pipeline/abc"),
    ).toBeNull();
    expect(pipelineNumberFromTargetUrl(null)).toBeNull();
  });
});

describe("harvestVerdict", () => {
  const stale = {
    gate: failed,
    reviewedAtHead: true,
    completionSignal: "issue-comment",
    blockingCount: 0,
  };

  test("retries a gate that expired before a clean review landed", () => {
    expect(harvestVerdict(stale)).toEqual({
      retryable: true,
      pipelineNumber: PIPELINE,
    });
  });

  test("leaves a gate that failed on real findings alone", () => {
    // This is the case a looser rule would re-run forever: the job fails
    // again, and a genuine finding starts to look like flakiness.
    const verdict = harvestVerdict({ ...stale, blockingCount: 2 });
    expect(verdict.retryable).toBe(false);
    expect(verdict).toMatchObject({ reason: "2 blocking finding(s) remain" });
  });

  test("waits when the review is for an older commit", () => {
    const verdict = harvestVerdict({ ...stale, reviewedAtHead: false });
    expect(verdict).toEqual({
      retryable: false,
      reason: "no review for this head yet",
    });
  });

  test("waits when the provider has not finished", () => {
    const verdict = harvestVerdict({ ...stale, completionSignal: "none" });
    expect(verdict).toEqual({
      retryable: false,
      reason: "provider has not finished reviewing",
    });
  });

  test("does nothing to a gate that is not failing", () => {
    for (const state of ["success", "pending", "error"]) {
      expect(harvestVerdict({ ...stale, gate: { ...failed, state } })).toEqual({
        retryable: false,
        reason: `gate is ${state}`,
      });
    }
  });

  test("does nothing when there is no gate at all", () => {
    expect(harvestVerdict({ ...stale, gate: null })).toEqual({
      retryable: false,
      reason: "no gate status",
    });
  });

  test("does not retry when the status names no pipeline", () => {
    const verdict = harvestVerdict({
      ...stale,
      gate: { state: "failure", targetUrl: null },
    });
    expect(verdict).toEqual({
      retryable: false,
      reason: "gate status names no CI pipeline",
    });
  });
});

describe("nextPageUrl", () => {
  test("follows the next link when the statuses span pages", () => {
    expect(
      nextPageUrl(
        '<https://api.github.com/repositories/1/commits/abc/status?page=2>; rel="next", ' +
          '<https://api.github.com/repositories/1/commits/abc/status?page=9>; rel="last"',
      ),
    ).toBe("https://api.github.com/repositories/1/commits/abc/status?page=2");
  });

  test("stops on the last page, which carries prev and first but no next", () => {
    expect(
      nextPageUrl(
        '<https://api.github.com/repositories/1/commits/abc/status?page=8>; rel="prev", ' +
          '<https://api.github.com/repositories/1/commits/abc/status?page=1>; rel="first"',
      ),
    ).toBeNull();
  });

  test("stops when the response carries no Link header at all", () => {
    expect(nextPageUrl(null)).toBeNull();
  });
});
