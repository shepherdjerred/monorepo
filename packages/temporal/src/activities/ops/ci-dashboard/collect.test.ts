import {
  CiDashboardSampleSchema,
  type CiTimingAttempt,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { describe, expect, test, vi } from "vitest";
import { collectCiDashboard, queueSample } from "./collect.ts";
import { collectCiTimingHistory } from "./history.ts";
import {
  type PipelineClient,
  type PipelineDetail,
  type Queue,
  readPipelineDetails,
  summarizePipeline,
} from "./pipelines.ts";

const NOW = new Date("2026-11-26T20:00:00.000Z");
const CREATED = "2026-11-26T19:00:00.000Z";
const STARTED = "2026-11-26T19:05:00.000Z";
const CHECK_FINISHED = "2026-11-26T19:14:00.000Z";
const GATE_FINISHED = "2026-11-26T19:15:00.000Z";
const SIGNAL = new AbortController().signal;

function pipeline(options: Partial<PipelineDetail> = {}): PipelineDetail {
  return {
    id: 55,
    number: 10,
    status: "running",
    commit: "fabc",
    ref: "refs/pull/42/head",
    refspec: "refs/heads/topic/change:refs/heads/main",
    branch: "main",
    event: "pull_request",
    isDraft: false,
    eventReasons: [],
    author: "developer",
    attempt: 2,
    url: "https://woodpecker.example/repos/1/pipeline/10",
    forgeUrl: "https://github.example/repo/pull/42",
    message: "",
    createdAt: CREATED,
    startedAt: STARTED,
    finishedAt: undefined,
    workflows: [
      {
        id: "200",
        pid: 1,
        name: "verify",
        state: "pending",
        startedAt: undefined,
        finishedAt: undefined,
        dependsOn: [],
        steps: [],
      },
      {
        id: "201",
        pid: 2,
        name: "ci-complete",
        state: "pending",
        startedAt: undefined,
        finishedAt: undefined,
        dependsOn: ["verify"],
        steps: [],
      },
    ],
    ...options,
  };
}

function task(options: Partial<Queue["tasks"][number]>) {
  return {
    id: "200",
    repoId: 1,
    pipelineId: 55,
    pipelineNumber: 10,
    pid: 1,
    name: "verify",
    state: "ready",
    pipelineCreatedAt: CREATED,
    dependencies: [],
    dependencyStates: {},
    ...options,
  } satisfies Queue["tasks"][number];
}

function queue(): Queue {
  return {
    ready: 17,
    running: 4,
    waitingOnDependencies: 6,
    workerCount: 3,
    paused: true,
    tasks: [
      task({}),
      task({ id: "201", name: "ci-complete", pid: 2, state: "waiting" }),
      task({
        id: "990",
        repoId: 2,
        pipelineNumber: 71,
        pipelineCreatedAt: "2026-11-26T18:30:00.000Z",
      }),
      task({
        id: "991",
        repoId: 2,
        state: "running",
        pipelineCreatedAt: "2026-11-26T18:00:00.000Z",
      }),
    ],
  };
}

const prometheus = {
  query: async () => [
    { metric: { cluster_queue: "woodpecker" }, value: 0 },
    { metric: { cluster_queue: "woodpecker-gates" }, value: 12 },
  ],
};

describe("Hub CI live collector", () => {
  test("keeps instance totals while enriching only monorepo workflows", async () => {
    const active = pipeline();
    const finished = pipeline({
      number: 9,
      status: "skipped",
      finishedAt: undefined,
    });
    const client: PipelineClient = {
      queue: async () => queue(),
      pipelines: async (input) =>
        input.status === undefined ? [active, finished] : [],
      pipeline: vi.fn(async () => active),
      pipelineConfig: vi.fn(async () => []),
    };
    const sample = CiDashboardSampleSchema.parse(
      await collectCiDashboard({
        client,
        prometheus,
        repoId: 1,
        now: NOW,
        signal: SIGNAL,
        onFailure: vi.fn(),
      }),
    );
    expect(sample.queue).toEqual({
      paused: true,
      sampledAt: NOW.toISOString(),
      ready: 17,
      running: 4,
      waitingOnDependencies: 6,
      oldestQueuedPipelineCreatedAt: "2026-11-26T18:30:00.000Z",
    });
    expect(sample.admission).toEqual({
      sampledAt: NOW.toISOString(),
      compute: 0,
      gates: 12,
    });
    expect(client.pipeline).toHaveBeenCalledExactlyOnceWith(10, SIGNAL);
    expect(client.pipelineConfig).not.toHaveBeenCalled();
    expect(sample.jobs?.partial).toBe(false);
    expect(sample.jobs?.active[0]).toMatchObject({
      pr: 42,
      attempt: 2,
      branch: "topic/change",
      requiredWorkflows: ["verify"],
      workflows: [
        { id: "200", state: "ready", blocker: "Queue paused" },
        { id: "201", state: "waiting_on_deps", blocker: "Waiting on verify" },
      ],
    });
    expect(sample.jobs?.recent).toMatchObject([
      { pipeline: 9, state: "skipped" },
    ]);
  });

  test("a failed queue source does not hide the repo or admission data", async () => {
    const active = pipeline({ status: "blocked" });
    const onFailure = vi.fn();
    const sample = await collectCiDashboard({
      client: {
        queue: () => Promise.reject(new Error("forbidden")),
        pipelines: async (input) =>
          input.status === "blocked" ? [active] : [],
        pipeline: async () => active,
        pipelineConfig: async () => [],
      },
      prometheus,
      repoId: 1,
      now: NOW,
      signal: SIGNAL,
      onFailure,
    });
    expect(sample.queue).toBeNull();
    expect(sample.admission?.gates).toBe(12);
    expect(sample.jobs).toMatchObject({
      partial: true,
      active: [{ pipeline: 10, state: "blocked" }],
    });
    expect(onFailure).toHaveBeenCalledWith(
      "woodpecker_queue",
      expect.any(Error),
    );
  });

  test("an idle queue still reports zero counts without a fake oldest age", () => {
    expect(
      queueSample(
        {
          ...queue(),
          ready: 0,
          waitingOnDependencies: 0,
          running: 0,
          tasks: [],
        },
        NOW.toISOString(),
      ),
    ).toMatchObject({
      ready: 0,
      oldestQueuedPipelineCreatedAt: null,
    });
  });

  test("ranks recent completions across full pages ordered by pipeline number", async () => {
    const oldCompletions = Array.from({ length: 50 }, (_, index) =>
      pipeline({ number: 100 - index, status: "success", finishedAt: CREATED }),
    );
    const latestCompletion = pipeline({
      number: 40,
      status: "success",
      finishedAt: GATE_FINISHED,
    });
    const sample = await collectCiDashboard({
      client: {
        queue: async () => ({ ...queue(), tasks: [] }),
        pipelines: async ({ page, status }) =>
          status === undefined
            ? page === 1
              ? oldCompletions
              : [latestCompletion]
            : [],
        pipeline: async () => latestCompletion,
        pipelineConfig: async () => [],
      },
      prometheus,
      repoId: 1,
      now: NOW,
      signal: SIGNAL,
      onFailure: vi.fn(),
    });
    expect(sample.jobs?.recent).toHaveLength(20);
    expect(sample.jobs?.recent[0]?.pipeline).toBe(40);
  });

  test("detail lookups use at most four concurrent requests", async () => {
    let active = 0;
    let max = 0;
    const entries = Array.from({ length: 12 }, (_, index) => index + 1);
    const result = await readPipelineDetails(
      entries,
      async (number) => {
        active += 1;
        max = Math.max(max, active);
        await Promise.resolve();
        active -= 1;
        return summarizePipeline(pipeline({ number }));
      },
      vi.fn(),
      SIGNAL,
    );
    expect(max).toBe(4);
    expect(result.runs).toHaveLength(entries.length);
    expect(result.partial).toBe(false);
  });

  test("prioritizes the running and oldest ready runs and preserves known rows at the detail limit", async () => {
    const runs = Array.from({ length: 42 }, (_, index) =>
      pipeline({ number: index + 1, id: index + 100, status: "pending" }),
    );
    const detail = vi.fn(async (number: number) => {
      const run = runs.find((candidate) => candidate.number === number);
      if (run === undefined) throw new Error("Missing pipeline fixture");
      return run;
    });
    const sample = await collectCiDashboard({
      client: {
        queue: async () => ({
          ...queue(),
          tasks: runs.map((run) =>
            task({
              pipelineId: run.id,
              pipelineNumber: run.number,
              state: run.number === 42 ? "running" : "ready",
            }),
          ),
        }),
        pipelines: async (input) => (input.status === "blocked" ? [] : runs),
        pipeline: detail,
        pipelineConfig: async () => [],
      },
      prometheus,
      repoId: 1,
      now: NOW,
      signal: SIGNAL,
      onFailure: vi.fn(),
    });
    expect(detail).toHaveBeenCalledTimes(40);
    expect(detail).toHaveBeenNthCalledWith(1, 42, SIGNAL);
    expect(detail).toHaveBeenNthCalledWith(2, 1, SIGNAL);
    expect(sample.jobs?.partial).toBe(true);
    expect(sample.jobs?.active).toHaveLength(42);
    expect(
      sample.jobs?.active.find((run) => run.pipeline === 41),
    ).toMatchObject({
      requiredWorkflows: null,
      workflows: [{ name: "verify", state: "ready" }],
    });
  });
});

function completePr(options: Partial<PipelineDetail> = {}): PipelineDetail {
  const workflows = pipeline().workflows;
  return pipeline({
    status: "failure",
    finishedAt: "2026-11-26T19:19:00.000Z",
    workflows: workflows.map((workflow) => ({
      ...workflow,
      state: "success",
      startedAt: workflow.name === "verify" ? STARTED : CHECK_FINISHED,
      finishedAt: workflow.name === "verify" ? CHECK_FINISHED : GATE_FINISHED,
      dependsOn: [],
    })),
    ...options,
  });
}

const GATE_CONFIG = {
  name: "ci-complete",
  data: "workspace: {}\ndepends_on: [verify]\nsteps: []\n",
};

test("timing history retains eligible attempts and reads the successful PR gate even with advisory failure", async () => {
  const complete = completePr();
  const retained: CiTimingAttempt = {
    pipeline: 12,
    attempt: 0,
    finishedAt: GATE_FINISHED,
    event: "push",
    requiredWorkflows: null,
    turnaroundSeconds: null,
    gateTailSeconds: null,
    workflows: [],
  };
  const client: PipelineClient = {
    queue: async () => queue(),
    pipelines: async (input) => (input.status === "failure" ? [complete] : []),
    pipeline: vi.fn(async () => complete),
    pipelineConfig: vi.fn(async () => [GATE_CONFIG]),
  };
  const result = await collectCiTimingHistory({
    client,
    previous: {
      sampledAt: CREATED,
      attempts: [
        retained,
        { ...retained, pipeline: 3, finishedAt: "2026-11-10T19:15:00.000Z" },
      ],
    },
    now: NOW,
    signal: SIGNAL,
    onFailure: vi.fn(),
  });
  expect(client.pipeline).toHaveBeenCalledExactlyOnceWith(10, SIGNAL);
  expect(client.pipelineConfig).toHaveBeenCalledExactlyOnceWith(10, SIGNAL);
  expect(result.attempts).toEqual([
    {
      pipeline: 10,
      attempt: 2,
      event: "pull_request",
      finishedAt: "2026-11-26T19:19:00.000Z",
      requiredWorkflows: ["verify"],
      turnaroundSeconds: 900,
      gateTailSeconds: 60,
      workflows: [
        { name: "verify", durationSeconds: 540 },
        { name: "ci-complete", durationSeconds: 60 },
      ],
    },
    retained,
  ]);
});

test("the next timing refresh advances past rejected failures and retries an unread attempt", async () => {
  const good = completePr({ number: 6 });
  const failed = Array.from({ length: 4 }, (_, index) =>
    completePr({
      number: index + 7,
      workflows: good.workflows.map((workflow) => ({
        ...workflow,
        state: "failure",
      })),
    }),
  );
  const details = new Map([good, ...failed].map((run) => [run.number, run]));
  const read = vi.fn(async (number: number) => {
    const run = details.get(number);
    if (run === undefined) throw new Error("Missing pipeline fixture");
    return run;
  });
  read.mockRejectedValueOnce(new Error("Detail temporarily unavailable"));
  const input = {
    client: {
      queue: async () => queue(),
      pipelines: async ({ status }) =>
        status === "failure" ? [...failed, good] : [],
      pipeline: read,
      pipelineConfig: async () => [GATE_CONFIG],
    } satisfies PipelineClient,
    now: NOW,
    signal: SIGNAL,
    onFailure: vi.fn(),
  };
  const first = await collectCiTimingHistory({ ...input, previous: null });
  expect(first.attempts).toEqual([]);
  expect(first.skippedAttempts?.map((run) => run.pipeline)).toEqual([9, 8, 7]);
  const second = await collectCiTimingHistory({ ...input, previous: first });
  expect(read.mock.calls.map(([number]) => number)).toEqual([
    10, 9, 8, 7, 10, 6,
  ]);
  expect(second.attempts.map((run) => run.pipeline)).toEqual([6]);
  expect(second.skippedAttempts?.map((run) => run.pipeline)).toEqual([
    10, 9, 8, 7,
  ]);
});

test("workflow durations survive failed graph enrichment and are enriched on the next refresh", async () => {
  const run = completePr();
  const config = vi.fn(async () => [GATE_CONFIG]);
  config.mockRejectedValueOnce(new Error("Config temporarily unavailable"));
  const input = {
    client: {
      queue: async () => queue(),
      pipelines: async ({ status }) => (status === "failure" ? [run] : []),
      pipeline: async () => run,
      pipelineConfig: config,
    } satisfies PipelineClient,
    now: NOW,
    signal: SIGNAL,
    onFailure: vi.fn(),
  };
  const first = await collectCiTimingHistory({ ...input, previous: null });
  expect(first.attempts[0]).toMatchObject({
    graphReadFailures: 1,
    requiredWorkflows: null,
    workflows: [{ name: "verify" }, { name: "ci-complete" }],
  });
  const refreshed = await collectCiTimingHistory({ ...input, previous: first });
  expect(refreshed.attempts[0]).toMatchObject({
    requiredWorkflows: ["verify"],
    gateTailSeconds: 60,
  });
  expect(refreshed.attempts[0]).not.toHaveProperty("graphReadFailures");
  expect(config).toHaveBeenCalledTimes(2);
});

test("newer branch runs cannot displace the retained PR estimate cohort", async () => {
  const branchRuns: CiTimingAttempt[] = Array.from(
    { length: 90 },
    (_, index) => ({
      pipeline: index + 100,
      attempt: 0,
      event: "push",
      finishedAt: GATE_FINISHED,
      requiredWorkflows: null,
      turnaroundSeconds: null,
      gateTailSeconds: null,
      workflows: [{ name: "verify", durationSeconds: 9 }],
    }),
  );
  const prRuns = branchRuns.slice(0, 10).map((entry) => ({
    ...entry,
    pipeline: entry.pipeline - 80,
    event: "pull_request",
    finishedAt: CHECK_FINISHED,
    requiredWorkflows: ["verify"],
    turnaroundSeconds: 500,
    gateTailSeconds: 30,
  }));
  const result = await collectCiTimingHistory({
    client: {
      queue: async () => queue(),
      pipelines: async () => [],
      pipeline: async () => pipeline(),
      pipelineConfig: async () => [],
    },
    previous: {
      sampledAt: NOW.toISOString(),
      attempts: [...branchRuns, ...prRuns],
    },
    now: NOW,
    signal: SIGNAL,
    onFailure: vi.fn(),
  });
  expect(result.attempts).toHaveLength(50);
  expect(
    result.attempts.filter((run) => run.event === "pull_request"),
  ).toHaveLength(10);
});
