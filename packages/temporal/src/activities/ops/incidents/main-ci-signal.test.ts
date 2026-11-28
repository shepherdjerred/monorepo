import { describe, expect, test } from "vitest";
import type {
  BranchStatus,
  WoodpeckerPipeline,
  WoodpeckerPipelineDetail,
} from "@shepherdjerred/ops-clients/woodpecker.ts";
import { register } from "#observability/metrics.ts";
import {
  buildMainCiSignalBatch,
  MAIN_CI_EXIT_CONDITION,
  parseCommitSuspect,
  publishMainCiSignal,
} from "./main-ci-signal.ts";
import type { OpsPoster } from "#activities/ops/ops-publish.ts";

const now = new Date("2026-11-25T18:00:00.000Z");
const SHA = "41ff86919fd1f2c12f1bbb8640bb4e762988d646";
const PIPELINE_URL = "https://ci.sjer.red/repos/1/pipeline/19260";

/** A squash merge as it lands on main, trailers and all. */
const SQUASH_MESSAGE = [
  "feat(errors): activate errors/prod and the logging tunnel (#5144)",
  "",
  "Why:",
  "PR 2 activates the live errors/prod workload.",
  "",
  "* fix(errors): synthesize dockerhub stack",
  "",
  "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>",
  "Claude-Session: https://claude.ai/code/session_01EarlierSession",
  "",
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
  "Claude-Session: https://claude.ai/code/session_01FinalSessionAbc",
].join("\n");

function pipeline(
  overrides: Partial<WoodpeckerPipeline> = {},
): WoodpeckerPipeline {
  return {
    number: 19_260,
    status: "failure",
    url: PIPELINE_URL,
    commit: SHA,
    message:
      "feat(errors): activate errors/prod and the logging tunnel (#5144)",
    createdAt: "2026-11-25T17:40:00.000Z",
    finishedAt: "2026-11-25T17:55:00.000Z",
    ...overrides,
  };
}

function detail(
  overrides: Partial<WoodpeckerPipelineDetail> = {},
): WoodpeckerPipelineDetail {
  return {
    ...pipeline(),
    id: null,
    message: SQUASH_MESSAGE,
    startedAt: "2026-11-25T17:40:05.000Z",
    event: "push",
    branch: "main",
    ref: "refs/heads/main",
    refspec: "",
    attempt: 0,
    isDraft: false,
    eventReasons: [],
    author: "shepherdjerred",
    forgeUrl: `https://github.com/shepherdjerred/monorepo/commit/${SHA}`,
    workflows: [],
    ...overrides,
  };
}

function status(verdict: WoodpeckerPipeline): BranchStatus {
  return { latest: verdict, verdict };
}

async function gauge(name: string): Promise<number | undefined> {
  const metrics = await register.getMetricsAsJSON();
  const metric = metrics.find((candidate) => candidate.name === name);
  return metric?.values.find((value) => value.labels["source"] === "main-ci")
    ?.value;
}

describe("parseCommitSuspect", () => {
  test("reads the PR from the squash subject and the last harness session trailer", () => {
    expect(parseCommitSuspect(detail())).toEqual({
      commitSha: SHA,
      prNumber: 5144,
      sessionId: "session_01FinalSessionAbc",
      author: "shepherdjerred",
    });
  });

  test("keeps only the commit and author for a direct push without trailers", () => {
    expect(
      parseCommitSuspect({
        commit: SHA.toUpperCase(),
        message: "chore: bump pins\n\nNo PR here (#12) in the body.",
        author: "shepherdjerred",
      }),
    ).toEqual({ commitSha: SHA, author: "shepherdjerred" });
  });

  test("ignores a PR reference that does not end the subject", () => {
    expect(
      parseCommitSuspect({
        commit: SHA,
        message: "revert (#5100) partially",
        author: "",
      }),
    ).toEqual({ commitSha: SHA });
  });

  test("accepts a bare session id trailer", () => {
    expect(
      parseCommitSuspect({
        commit: SHA,
        message: "fix: x (#7)\n\nclaude-session: session_01Bare",
        author: "bot",
      }),
    ).toEqual({
      commitSha: SHA,
      prNumber: 7,
      sessionId: "session_01Bare",
      author: "bot",
    });
  });
});

describe("buildMainCiSignalBatch", () => {
  test("a red main fires a sev2 main-ci signal naming the failing commit", () => {
    expect(
      buildMainCiSignalBatch({
        status: status(pipeline()),
        failing: detail(),
        observedAt: now,
      }),
    ).toEqual({
      signals: [
        {
          source: "main-ci",
          key: "main-ci:main",
          firing: true,
          system: "main-ci",
          severity: "sev2",
          title: "main is red: pipeline #19260 failure",
          summary:
            "feat(errors): activate errors/prod and the logging tunnel (#5144)",
          exitCondition: MAIN_CI_EXIT_CONDITION,
          observedAt: "2026-11-25T18:00:00.000Z",
          suspect: {
            commitSha: SHA,
            prNumber: 5144,
            sessionId: "session_01FinalSessionAbc",
            author: "shepherdjerred",
          },
          links: [
            {
              kind: "pipeline",
              ref: "19260",
              url: PIPELINE_URL,
              title: "Pipeline #19260",
            },
            {
              kind: "commit",
              ref: SHA,
              url: `https://github.com/shepherdjerred/monorepo/commit/${SHA}`,
              title: "Commit 41ff869",
            },
            {
              kind: "pr",
              ref: "5144",
              url: "https://github.com/shepherdjerred/monorepo/pull/5144",
              title: "PR #5144",
            },
          ],
        },
      ],
    });
  });

  test("a green main clears the same key without a suspect", () => {
    const [signal] = buildMainCiSignalBatch({
      status: status(pipeline({ status: "success", number: 19_261 })),
      failing: undefined,
      observedAt: now,
    }).signals;
    expect(signal).toMatchObject({
      key: "main-ci:main",
      firing: false,
      title: "main is green: pipeline #19261 passed",
    });
    expect(signal?.suspect).toBeUndefined();
    expect(signal?.links?.map((link) => link.kind)).toEqual([
      "pipeline",
      "commit",
    ]);
  });

  test("an error verdict is red too", () => {
    const verdict = pipeline({ status: "error" });
    expect(
      buildMainCiSignalBatch({
        status: status(verdict),
        failing: detail({ status: "error" }),
        observedAt: now,
      }).signals[0]?.firing,
    ).toBe(true);
  });

  test("refuses a red signal without the failing pipeline's detail", () => {
    expect(() =>
      buildMainCiSignalBatch({
        status: status(pipeline()),
        failing: detail({ number: 19_259 }),
        observedAt: now,
      }),
    ).toThrow("needs pipeline #19260's detail");
  });
});

describe("publishMainCiSignal", () => {
  test("posts the batch to Hub's Incidents signal endpoint with the ops token", async () => {
    const calls: Parameters<OpsPoster>[0][] = [];
    const outcome = await publishMainCiSignal({
      status: status(pipeline()),
      fetchPipeline: (number) => {
        expect(number).toBe(19_260);
        return Promise.resolve(detail());
      },
      dashboardUrl:
        "http://alert-dashboard-alert-dashboard-service.alert-dashboard.svc.cluster.local:7341",
      token: "ops-token",
      post: (call) => {
        calls.push(call);
        return Promise.resolve();
      },
      now,
      secrets: ["ops-token"],
    });
    expect(outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard.svc.cluster.local:7341/api/incidents/internal/signals",
    );
    expect(calls[0]?.token).toBe("ops-token");
    expect(await gauge("incidents_signal_post_ok")).toBe(1);
    expect(await gauge("incidents_signal_last_success_timestamp_seconds")).toBe(
      Math.floor(now.getTime() / 1000),
    );
  });

  test("a green main posts without fetching pipeline detail", async () => {
    let fetched = false;
    const outcome = await publishMainCiSignal({
      status: status(pipeline({ status: "success" })),
      fetchPipeline: () => {
        fetched = true;
        return Promise.resolve(detail());
      },
      dashboardUrl: "http://hub:7341",
      token: "ops-token",
      post: () => Promise.resolve(),
      now,
      secrets: [],
    });
    expect(outcome).toEqual({ ok: true });
    expect(fetched).toBe(false);
  });

  test("a rejected post is reported, redacted, and recorded instead of thrown", async () => {
    const outcome = await publishMainCiSignal({
      status: status(pipeline()),
      fetchPipeline: () => Promise.resolve(detail()),
      dashboardUrl: "http://hub:7341",
      token: "ops-token",
      post: () =>
        Promise.reject(
          new Error(
            "POST /api/incidents/internal/signals returned HTTP 503: token ops-token rejected",
          ),
        ),
      now,
      secrets: ["ops-token"],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toContain("HTTP 503");
    expect(outcome.ok ? "" : outcome.error).not.toContain("ops-token");
    expect(await gauge("incidents_signal_post_ok")).toBe(0);
  });

  test("a failed detail fetch is recorded without posting", async () => {
    let posted = false;
    const outcome = await publishMainCiSignal({
      status: status(pipeline()),
      fetchPipeline: () => Promise.reject(new Error("woodpecker: HTTP 502")),
      dashboardUrl: "http://hub:7341",
      token: "ops-token",
      post: () => {
        posted = true;
        return Promise.resolve();
      },
      now,
      secrets: [],
    });
    expect(outcome).toEqual({ ok: false, error: "woodpecker: HTTP 502" });
    expect(posted).toBe(false);
    expect(await gauge("incidents_signal_post_ok")).toBe(0);
  });
});
