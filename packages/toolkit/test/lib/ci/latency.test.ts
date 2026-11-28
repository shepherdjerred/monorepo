import { afterEach, expect, test, vi } from "vitest";
import {
  distribution,
  formatLatency,
  latencyReport,
  pipelineKind,
} from "#lib/ci/latency.ts";
import { pipelineHistory } from "#lib/ci/history.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  repoId: 1,
  token: "test-private-token",
};
const pipeline = (
  extra: Partial<WoodpeckerPipeline> = {},
): WoodpeckerPipeline => ({
  number: 1,
  commit: "a".repeat(40),
  status: "success",
  event: "pull_request",
  ref: "refs/pull/7/head",
  created: 100,
  finished: 300,
  workflows: [
    {
      name: "verify",
      state: "success",
      started: 120,
      finished: 250,
      children: [
        {
          id: 1,
          pid: 1,
          name: "clone",
          state: "success",
          exit_code: 0,
          started: 120,
          finished: 150,
        },
      ],
    },
    { name: "code-review", state: "success", started: 120, finished: 200 },
    { name: "ci-complete", state: "success", started: 290, finished: 300 },
  ],
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());

test("classifies executed workflow shapes, retaining legacy expensive drafts", () => {
  expect(pipelineKind(pipeline())).toBe("ready-pr");
  expect(pipelineKind(pipeline({ pr_draft: true }))).toBe(
    "legacy-draft-verification",
  );
  for (const [name = "", kind] of [
    ["ci-noop", "noop"],
    ["draft-preflight", "draft"],
    ["maintenance-release-notes", "maintenance"],
    ["maintenance-workspace-golden", "maintenance"],
    ["maintenance-workspace-seeds", "maintenance"],
    ["verify-extended", "extended"],
  ]) {
    expect(
      pipelineKind(pipeline({ workflows: [{ name, state: "success" }] })),
    ).toBe(kind);
  }
  expect(
    pipelineKind(
      pipeline({
        event: "manual",
        ref: "refs/heads/main",
        branch: "main",
        workflows: [
          { name: "extended-superseded", state: "success" },
          { name: "verify-extended", state: "failure" },
        ],
      }),
    ),
  ).toBe("extended");
  expect(
    pipelineKind(
      pipeline({
        event: "manual",
        ref: "refs/heads/main",
        branch: "main",
        workflows: ["verify", "images", "helm-push", "delivery-publish"].map(
          (name) => ({ name, state: "success" }),
        ),
      }),
    ),
  ).toBe("main");
  // A current main push, including a superseded one whose workflows all skipped.
  for (const state of ["running", "skipped"])
    expect(
      pipelineKind(
        pipeline({
          event: "push",
          ref: "refs/heads/main",
          branch: "main",
          workflows: [
            "verify",
            "images",
            "helm-push",
            "delivery-publish",
            "playwright-e2e",
            "release-please",
          ].map((name) => ({ name, state })),
        }),
      ),
    ).toBe("main");
  // A pull request that merely contains verify is not a main push.
  expect(
    pipelineKind(
      pipeline({
        event: "push",
        branch: "feature",
        ref: "refs/heads/feature",
        workflows: ["verify", "images", "helm-push"].map((name) => ({
          name,
          state: "success",
        })),
      }),
    ),
  ).toBe("other");
  expect(pipelineKind(pipeline({ workflows: [] }))).toBe("other");
});

test("percentiles expose missing samples and use nearest rank", () => {
  expect(distribution([10, 20, null, 30, 40])).toEqual({
    count: 4,
    missing: 1,
    p50Seconds: 20,
    p90Seconds: 40,
    p95Seconds: 40,
  });
  expect(distribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({
    count: 10,
    missing: 0,
    p50Seconds: 5,
    p90Seconds: 9,
    p95Seconds: 10,
  });
  expect(distribution([]).p90Seconds).toBeNull();
  expect(distribution([]).p95Seconds).toBeNull();
});

test("never mixes canceled, rerun or unknown review work into a fresh SLO", () => {
  const report = latencyReport(
    [
      pipeline(),
      pipeline({ number: 2, status: "killed" }),
      pipeline({ number: 3, rerun_count: 1 }),
      pipeline({ number: 4, finished: 0, status: "running" }),
    ],
    50,
    400,
  );
  expect(report.cohorts).toHaveLength(4);
  expect(report.cohorts.map((group) => group.latency.count)).toEqual([
    1, 0, 1, 0,
  ]);
  expect(report.records[0]?.review).toBe("unknown");
  expect(report.records[0]?.queueSeconds).toBe(20);
  expect(report.cohorts[0]?.phases).toContainEqual({
    kind: "checkout",
    count: 1,
    missing: 0,
    p50Seconds: 30,
    p90Seconds: 30,
    p95Seconds: 30,
  });
  expect(report.cohorts[0]?.workflows).toContainEqual({
    name: "verify",
    count: 1,
    missing: 0,
    p50Seconds: 130,
    p90Seconds: 130,
    p95Seconds: 130,
  });
  const formatted = formatLatency(report);
  expect(formatted).toContain("p50=200s, p90=200s, p95=200s");
  expect(formatted).toContain(
    "workflow verify: n=1, p50=130s, p90=130s, p95=130s",
  );
});

test("missing timestamps remain unknown and secrets are not copied into records", () => {
  const report = latencyReport(
    [
      pipeline({
        created: undefined,
        finished: undefined,
        errors: [config.token],
      }),
    ],
    50,
    400,
  );
  expect(report.records[0]?.elapsedSeconds).toBeNull();
  expect(report.records[0]?.queueSeconds).toBeNull();
  expect(JSON.stringify(report)).not.toContain(config.token);
});

test("custom clone preparation remains part of checkout evidence", () => {
  const report = latencyReport(
    [
      pipeline({
        workflows: [
          {
            name: "verify",
            state: "success",
            started: 100,
            finished: 200,
            children: [
              {
                id: 1,
                pid: 1,
                name: "prepare-clone",
                type: "clone",
                state: "success",
                exit_code: 0,
                started: 100,
                finished: 105,
              },
            ],
          },
        ],
      }),
    ],
    50,
    400,
  );
  expect(report.records[0]?.workflows[0]?.phases[0]).toMatchObject({
    name: "prepare-clone",
    kind: "checkout",
    elapsedSeconds: 5,
  });
});

test("history paginates, deduplicates shifted pages and bounds concurrent details", async () => {
  let active = 0;
  let maximum = 0;
  const details: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/pipelines")) {
        const entries =
          url.searchParams.get("page") === "1"
            ? Array.from({ length: 50 }, (_, i) =>
                pipeline({ number: 100 - i }),
              )
            : [pipeline({ number: 51 }), pipeline({ number: 50, created: 10 })];
        return Response.json(entries);
      }
      active++;
      maximum = Math.max(maximum, active);
      const number = Number(url.pathname.split("/").at(-1));
      details.push(number);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return Response.json(pipeline({ number }));
    }),
  );
  const records = await pipelineHistory(config, 50, 400);
  expect(records).toHaveLength(50);
  expect(details).toHaveLength(50);
  expect(maximum).toBeLessThanOrEqual(4);
});

test("malformed history and changed detail identity fail visibly", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([pipeline({ created: 0 })])),
  );
  await expect(pipelineHistory(config, 50, 400)).rejects.toThrow(
    "creation timestamp",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      Response.json(
        url.pathname.endsWith("/pipelines")
          ? [pipeline()]
          : pipeline({ commit: "b".repeat(40) }),
      ),
    ),
  );
  await expect(pipelineHistory(config, 50, 400)).rejects.toThrow(
    "changed identity",
  );
});
