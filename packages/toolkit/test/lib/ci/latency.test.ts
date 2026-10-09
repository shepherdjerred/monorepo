import { afterEach, expect, test, vi } from "vitest";
import { distribution, latencyReport, pipelineKind } from "#lib/ci/latency.ts";
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
        workflows: ["verify", "images", "helm-push", "argocd-sync"].map(
          (name) => ({ name, state: "success" }),
        ),
      }),
    ),
  ).toBe("main");
  expect(pipelineKind(pipeline({ workflows: [] }))).toBe("other");
});

test("percentiles expose missing samples and use nearest rank", () => {
  expect(distribution([10, 20, null, 30, 40])).toEqual({
    count: 4,
    missing: 1,
    p50Seconds: 20,
    p95Seconds: 40,
  });
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
    p95Seconds: 30,
  });
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
