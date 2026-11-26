import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import type { FetchLike } from "#src/http.ts";

const { flagGetter, flagFactory } = vi.hoisted(() => {
  const getter = vi.fn<FlagConfigSource["get"]>();
  return {
    flagGetter: getter,
    flagFactory: vi.fn(
      (options?: { onUnavailable?: (flag: string) => void }) => ({
        name: "flag" as const,
        get: async (
          names: { key: string; flag: string },
          context?: { targetingKey?: string },
        ) => {
          const result = await getter(names, context);
          if (result === undefined) {
            options?.onUnavailable?.(names.flag);
          }
          return result;
        },
      }),
    ),
  };
});

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: flagFactory,
}));

import {
  supersedeMainConfig,
  supersedeMainEnabled,
} from "#src/supersede/supersede-main-config.ts";
import {
  cancelSupersededMain,
  cleanupSupersededMain,
  hasStartedPublicationWorkflow,
  publicationWorkflowKeys,
  type SupersededMainLog,
} from "#src/supersede/superseded-main.ts";

function sha(num: number): string {
  return num.toString(16).padStart(40, "0");
}

type MockWorkflow = {
  readonly name: string;
  readonly state: string;
  readonly started?: number;
};

type MockPipeline = {
  readonly number: number;
  readonly commit: string;
  readonly ref: string;
  readonly branch: string;
  readonly event: string;
  readonly status: string;
  readonly workflows: readonly MockWorkflow[];
};

function makeMainPipeline(
  number: number,
  status: string,
  workflows: readonly MockWorkflow[] = [{ name: "verify", state: status }],
): MockPipeline {
  return {
    number,
    commit: sha(number),
    ref: "refs/heads/main",
    branch: "main",
    event: "push",
    status,
    workflows,
  };
}

function createSupersedeHarness(options: {
  pipelines: readonly MockPipeline[];
  compareStatus?: (base: string, head: string) => string;
  onDetailRead?: (pipeline: MockPipeline, readCount: number) => MockPipeline;
}) {
  const canceledCalls: number[] = [];
  const detailReadCounts = new Map<number, number>();
  const compareCalls: string[] = [];
  const logs: SupersededMainLog[] = [];

  const woodpeckerFetch: FetchLike = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const cancelMatch = /\/pipelines\/(\d+)\/cancel$/u.exec(url.pathname)?.[1];
    if (method === "POST" && cancelMatch !== undefined) {
      canceledCalls.push(Number(cancelMatch));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const detailMatch = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
    if (detailMatch !== undefined) {
      const num = Number(detailMatch);
      const found = options.pipelines.find((entry) => entry.number === num);
      if (found === undefined) {
        throw new Error(`Unexpected detail request for #${String(num)}`);
      }
      const nextCount = (detailReadCounts.get(num) ?? 0) + 1;
      detailReadCounts.set(num, nextCount);
      return Promise.resolve(
        Response.json(options.onDetailRead?.(found, nextCount) ?? found),
      );
    }
    const statusFilter = url.searchParams.get("status");
    return Promise.resolve(
      Response.json(
        options.pipelines.filter(
          (entry) => statusFilter === null || entry.status === statusFilter,
        ),
      ),
    );
  };

  const githubFetch: FetchLike = (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const match = /\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/u.exec(
      url.pathname,
    );
    if (match?.[1] === undefined || match[2] === undefined) {
      return Promise.resolve(new Response("bad url", { status: 400 }));
    }
    compareCalls.push(`${match[1].slice(-4)}...${match[2].slice(-4)}`);
    const status = options.compareStatus?.(match[1], match[2]) ?? "ahead";
    return Promise.resolve(Response.json({ status }));
  };

  return {
    canceledCalls,
    compareCalls,
    logs,
    run: (currentNumber: number, currentCommit = sha(currentNumber)) =>
      cancelSupersededMain({
        repoId: 1,
        defaultBranch: "main",
        current: {
          number: currentNumber,
          commit: currentCommit,
          branch: "main",
          event: "push",
        },
        woodpecker: {
          baseUrl: "https://woodpecker.example.com",
          token: "wp-token",
          fetchImpl: woodpeckerFetch,
        },
        github: {
          repo: "shepherdjerred/monorepo",
          token: "gh-token",
          fetchImpl: githubFetch,
        },
        log: (entry) => {
          logs.push(entry);
        },
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagGetter.mockReset();
});

describe("pre-publication push main supersession", () => {
  test("derives publication workflow keys directly from buildPipelineSteps", () => {
    const keys = publicationWorkflowKeys();
    for (const expected of [
      "images",
      "helm-push",
      "delivery-publish",
      "ci-images-register",
      "ci-base-refresh",
      "ci-playwright-refresh",
      "tofu-archives",
      "npm-package-archives",
      "trmnl-plugin-archives",
      "sites",
      "scout-site-archives",
      "release-please",
      "publish",
    ]) {
      expect(keys.has(expected), expected).toBe(true);
    }
    for (const gate of [
      "verify",
      "trivy",
      "semgrep",
      "playwright-e2e",
      "docker-e2e",
      "alert-dashboard-sqlite",
      "trmnl-validate",
      "resume-build",
      "tofu-validate",
      "pr-dryrun",
    ]) {
      expect(keys.has(gate), gate).toBe(false);
    }
    expect(
      hasStartedPublicationWorkflow([
        { name: "verify", state: "running", started: 1000 },
        { name: "playwright-e2e", state: "running", started: 1000 },
        { name: "images", state: "pending", started: 0 },
      ]),
    ).toBe(false);
    expect(
      hasStartedPublicationWorkflow([
        { name: "verify", state: "success", started: 1000 },
        { name: "images", state: "running", started: 1200 },
      ]),
    ).toBe(true);
  });

  test("coalesces a 10-pipeline merge burst down to [oldestRunning, current]", async () => {
    const burst = [
      makeMainPipeline(91, "running", [
        { name: "verify", state: "running", started: 1000 },
        { name: "playwright-e2e", state: "success", started: 1000 },
        { name: "images", state: "pending", started: 0 },
      ]),
      makeMainPipeline(92, "running", [
        { name: "verify", state: "running", started: 1010 },
        { name: "images", state: "pending", started: 0 },
      ]),
      ...Array.from({ length: 7 }, (_, index) =>
        makeMainPipeline(93 + index, "pending", [
          { name: "verify", state: "pending", started: 0 },
          { name: "images", state: "pending", started: 0 },
        ]),
      ),
    ];

    const harness = createSupersedeHarness({ pipelines: burst });
    const result = await harness.run(100);

    expect(result).toEqual({
      component: "superseded-main",
      currentPipeline: 100,
      canceledPipelines: [92, 93, 94, 95, 96, 97, 98, 99],
      keptPipelines: [{ number: 91, reason: "oldest-running" }],
    });
    expect(harness.canceledCalls).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
    expect(harness.logs).toEqual([result]);
  });

  test("never cancels a pipeline that started images or delivery-publish", async () => {
    const pipelines = [
      makeMainPipeline(88, "running", [
        { name: "verify", state: "success", started: 900 },
        { name: "images", state: "running", started: 950 },
        { name: "delivery-publish", state: "pending", started: 0 },
      ]),
      makeMainPipeline(89, "running", [
        { name: "verify", state: "success", started: 910 },
        { name: "images", state: "success", started: 940 },
        { name: "delivery-publish", state: "running", started: 960 },
      ]),
      makeMainPipeline(90, "running", [
        { name: "verify", state: "running", started: 970 },
        { name: "images", state: "pending", started: 0 },
      ]),
      makeMainPipeline(91, "pending", [
        { name: "verify", state: "pending", started: 0 },
      ]),
    ];

    const harness = createSupersedeHarness({ pipelines });
    const result = await harness.run(92);

    expect(result.keptPipelines).toEqual([
      { number: 88, reason: "publishing" },
      { number: 89, reason: "publishing" },
    ]);
    expect(result.canceledPipelines).toEqual([90, 91]);
    expect(harness.canceledCalls).toEqual([90, 91]);
  });

  test("refuses to cancel on out-of-order behind or diverged webhook delivery (AI-92)", async () => {
    const pipelines = [
      makeMainPipeline(70, "running"),
      makeMainPipeline(71, "pending"),
      makeMainPipeline(72, "pending"),
    ];
    const harness = createSupersedeHarness({
      pipelines,
      compareStatus: (base) => (base === sha(71) ? "behind" : "diverged"),
    });

    const result = await harness.run(73);
    expect(result.canceledPipelines).toEqual([]);
    expect(result.keptPipelines).toEqual([
      { number: 70, reason: "oldest-running" },
      { number: 71, reason: "not-ahead" },
      { number: 72, reason: "not-ahead" },
    ]);
    expect(harness.canceledCalls).toEqual([]);
  });

  test("aborts cancellation if re-read sees images started right before POST /cancel", async () => {
    const pipelines = [
      makeMainPipeline(60, "running"),
      makeMainPipeline(61, "running", [
        { name: "verify", state: "running", started: 500 },
        { name: "images", state: "pending", started: 0 },
      ]),
    ];
    const harness = createSupersedeHarness({
      pipelines,
      onDetailRead: (pipeline, readCount) =>
        pipeline.number === 61 && readCount >= 2
          ? {
              ...pipeline,
              workflows: [
                { name: "verify", state: "success", started: 500 },
                { name: "images", state: "running", started: 550 },
              ],
            }
          : pipeline,
    });

    const result = await harness.run(62);
    expect(result.canceledPipelines).toEqual([]);
    expect(result.keptPipelines).toEqual([
      { number: 60, reason: "oldest-running" },
      { number: 61, reason: "publishing" },
    ]);
    expect(harness.canceledCalls).toEqual([]);
  });
});

describe("supersedeMainConfig fail-safe behavior", () => {
  test("flag false and unavailable flag snapshots fail safe without canceling", async () => {
    flagGetter.mockResolvedValue({ value: true });
    expect(await supersedeMainConfig()).toMatchObject({
      value: true,
      source: "flag",
    });
    expect(await supersedeMainEnabled()).toBe(true);

    flagGetter.mockResolvedValue({ value: false });
    expect(await supersedeMainConfig()).toMatchObject({
      value: false,
      source: "flag",
    });
    expect(await supersedeMainEnabled()).toBe(false);

    // Stale/absent snapshot triggers onUnavailable -> fail safe to false.
    flagGetter.mockResolvedValue(undefined);
    expect(await supersedeMainConfig()).toMatchObject({ value: false });
    expect(await supersedeMainEnabled()).toBe(false);

    // Flag transport error triggers onSourceError -> fail safe to false.
    flagGetter.mockRejectedValue(new Error("Flags 503"));
    expect(await supersedeMainConfig()).toMatchObject({ value: false });
    expect(await supersedeMainEnabled()).toBe(false);

    // Invalid non-boolean flag value is caught by supersedeMainEnabled -> false.
    flagGetter.mockResolvedValue({ value: "not-a-boolean" });
    await expect(supersedeMainConfig()).rejects.toThrow();
    expect(await supersedeMainEnabled()).toBe(false);

    const cancelSpy = vi.fn(() => Promise.resolve());
    await cleanupSupersededMain({
      repoId: 1,
      defaultBranch: "main",
      pipeline: {
        number: 10,
        commit: sha(10),
        branch: "main",
        event: "push",
        ref: "refs/heads/main",
        refspec: "",
        forge_url: "https://github.com/shepherdjerred/monorepo/commit/0",
        author: "shepherdjerred",
        sender: "shepherdjerred",
        pr_draft: false,
        from_fork: false,
        reviewed: 0,
        reviewed_by: "",
        event_reason: null,
        changed_files: [],
        variables: {},
      },
      enabled: () => Promise.resolve(false),
      cancel: cancelSpy,
    });
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});
