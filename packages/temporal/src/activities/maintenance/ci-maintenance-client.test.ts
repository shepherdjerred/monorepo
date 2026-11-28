import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cancelStuckMaintenance,
  queuedMaintenanceEvidence,
  WoodpeckerQueueSchema,
} from "./ci-maintenance-age-out.ts";
import {
  findMaintenanceReceipt,
  maintenanceAdmissionBusy,
  MaintenancePipelineSchema,
  newestVerifiedMaintenanceSource,
  recentMaintenancePipelines,
} from "./ci-maintenance-client.ts";
import type { MaintenanceRequest } from "#shared/ci-maintenance.ts";

const canary = MaintenancePipelineSchema.parse({
  number: 20,
  commit: "a".repeat(40),
  status: "running",
  event: "manual",
  branch: "ci-canary/ssd-ram",
  ref: "refs/heads/ci-canary/ssd-ram",
  message: "MANUAL PIPELINE @ ci-canary/ssd-ram",
});

beforeEach(() => {
  vi.stubEnv("WOODPECKER_URL", "https://woodpecker.sjer.red");
  vi.stubEnv("WOODPECKER_REPO_ID", "1");
  vi.stubEnv("WOODPECKER_TOKEN", "unit-test-token");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function nativeUrl(input: Parameters<typeof fetch>[0]): URL {
  if (!(input instanceof URL)) throw new TypeError("Expected native API URL");
  return input;
}

test.each(["created", "pending", "running", "blocked"])(
  "active %s canaries remain visible regardless of completed history size",
  async (status) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const query = nativeUrl(input).searchParams;
      return Promise.resolve(
        Response.json(
          query.get("status") === status ? [{ ...canary, status }] : [],
        ),
      );
    });
    expect(await maintenanceAdmissionBusy()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [input, init] of fetch.mock.calls) {
      const url = nativeUrl(input);
      expect(url.pathname).toBe("/api/repos/1/pipelines");
      expect(url.searchParams.get("event")).toBe("manual");
      expect(url.searchParams.get("branch")).toBeNull();
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.get("perPage")).toBe("50");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  },
);

test("empty active-status results release admission without traversing completed history", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json([])));
  expect(await maintenanceAdmissionBusy()).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(
    new Set(
      fetch.mock.calls.map(([input]) =>
        nativeUrl(input).searchParams.get("status"),
      ),
    ),
  ).toEqual(new Set(["blocked", "created", "pending", "running"]));
});

test("a saturated active page defers instead of missing a canary beyond its bound", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        nativeUrl(input).searchParams.get("status") === "running"
          ? Array.from({ length: 50 }, (_, index) => ({
              ...canary,
              number: index + 100,
              branch: "main",
              ref: "refs/heads/main",
              message: "ordinary manual run",
            }))
          : [],
      ),
    ),
  );
  expect(await maintenanceAdmissionBusy()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("a broken native status filter fails instead of granting admission", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json([{ ...canary, status: "success" }])),
  );
  await expect(maintenanceAdmissionBusy()).rejects.toThrow(
    "active-status filter was not applied",
  );
});

test("native read errors fail instead of granting admission", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );
  await expect(maintenanceAdmissionBusy()).rejects.toThrow("HTTP 503");
});

test("receipt history retains its bounded main-only query", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = nativeUrl(input);
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("event")).toBe("manual");
    expect(url.searchParams.get("status")).toBeNull();
    const page = Number(url.searchParams.get("page"));
    return Promise.resolve(
      Response.json(
        Array.from({ length: 50 }, (_, index) => ({
          ...canary,
          number: page * 100 + index,
          branch: "main",
          ref: "refs/heads/main",
          status: "success",
        })),
      ),
    );
  });
  expect(await recentMaintenancePipelines("manual")).toHaveLength(200);
  expect(fetch).toHaveBeenCalledTimes(4);
});

const verifiedSource = "b".repeat(40);
const mainPush = {
  ...canary,
  event: "push",
  branch: "main",
  ref: "refs/heads/main",
  status: "success",
  message: "feat: change",
};
const releaseWorkflows = ["verify", "images", "helm-push", "delivery-publish"];

function servePipelines(
  list: readonly object[],
  details: Record<number, object>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = nativeUrl(input);
    const number = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
    return Promise.resolve(
      Response.json(number === undefined ? list : details[Number(number)]),
    );
  });
}

test("maintenance targets the newest successful main push when it is a complete release build", async () => {
  const newest = { ...mainPush, number: 31, commit: verifiedSource };
  const fetch = servePipelines(
    [
      { ...mainPush, number: 32, commit: "c".repeat(40), status: "running" },
      newest,
      { ...mainPush, number: 29 },
    ],
    {
      31: {
        ...newest,
        workflows: releaseWorkflows.map((name) => ({
          name,
          state: "success",
        })),
      },
    },
  );
  expect(await newestVerifiedMaintenanceSource()).toBe(verifiedSource);
  const listing = nativeUrl(fetch.mock.calls[0]?.[0] ?? "");
  expect(listing.searchParams.get("event")).toBe("push");
  expect(listing.searchParams.get("branch")).toBe("main");
});

test("an incomplete newest build is not replaced by an older one", async () => {
  const newest = { ...mainPush, number: 31, commit: verifiedSource };
  servePipelines([newest, { ...mainPush, number: 29 }], {
    31: {
      ...newest,
      workflows: [{ name: "verify", state: "success" }],
    },
  });
  expect(await newestVerifiedMaintenanceSource()).toBeUndefined();
});

test("a receipt at the branch tip reports the verified source the extension ran", async () => {
  const request: MaintenanceRequest = {
    kind: "workspace-golden",
    source: verifiedSource,
    fingerprint: "golden-v1",
    frozen: false,
    requestId: "request-1",
    pipeline: 40,
  };
  const receipt = {
    ...canary,
    number: 40,
    branch: "main",
    ref: "refs/heads/main",
    status: "running",
    message: "ci-maintenance/request-1",
  };
  servePipelines([], {
    40: {
      ...receipt,
      workflows: [{ name: "maintenance-workspace-golden", state: "running" }],
    },
  });
  expect(await findMaintenanceReceipt(request, [])).toMatchObject({
    number: 40,
    source: verifiedSource,
  });
  vi.restoreAllMocks();
  servePipelines([], {
    40: {
      ...receipt,
      status: "success",
      workflows: [{ name: "maintenance-superseded", state: "success" }],
    },
  });
  expect(await findMaintenanceReceipt(request, [])).toEqual({
    number: 40,
    source: canary.commit,
    status: "success",
  });
});

test("distinguishes pre-command errors and cancellations from started command failures", async () => {
  const baseRequest: MaintenanceRequest = {
    kind: "ci-images",
    source: verifiedSource,
    fingerprint: "image-v1",
    frozen: false,
    requestId: "request-started-work",
    pipeline: null,
  };
  const basePipeline = {
    ...canary,
    branch: "main",
    ref: "refs/heads/main",
    message: "ci-maintenance/request-started-work",
  };

  // #16743: /ciconfig failure with empty workflows
  servePipelines([], {
    16_743: {
      ...basePipeline,
      number: 16_743,
      status: "error",
      workflows: [],
    },
  });
  expect(
    await findMaintenanceReceipt({ ...baseRequest, pipeline: 16_743 }, []),
  ).toEqual({
    number: 16_743,
    source: verifiedSource,
    status: "error",
    startedWork: false,
  });
  vi.restoreAllMocks();

  // #17812: canceled before any commands step started
  servePipelines([], {
    17_812: {
      ...basePipeline,
      number: 17_812,
      status: "canceled",
      workflows: [
        {
          name: "maintenance-ci-images",
          state: "canceled",
          children: [
            {
              id: 1,
              name: "clone",
              type: "clone",
              state: "canceled",
              started: 1_732_000_000,
            },
            {
              id: 2,
              name: "maintenance-ci-images",
              type: "commands",
              state: "skipped",
              started: 0,
            },
          ],
        },
      ],
    },
  });
  expect(
    await findMaintenanceReceipt({ ...baseRequest, pipeline: 17_812 }, []),
  ).toEqual({
    number: 17_812,
    source: verifiedSource,
    status: "canceled",
    startedWork: false,
  });
  vi.restoreAllMocks();

  // #14708: failed after a commands step started
  servePipelines([], {
    14_708: {
      ...basePipeline,
      number: 14_708,
      status: "failure",
      workflows: [
        {
          name: "maintenance-release-notes",
          state: "failure",
          children: [
            {
              id: 1,
              name: "clone",
              type: "clone",
              state: "success",
              started: 1_732_000_000,
            },
            {
              id: 2,
              name: "maintenance-release-notes",
              type: "commands",
              state: "failure",
              started: 1_732_000_015,
            },
          ],
        },
      ],
    },
  });
  expect(
    await findMaintenanceReceipt(
      { ...baseRequest, kind: "release-notes", pipeline: 14_708 },
      [],
    ),
  ).toEqual({
    number: 14_708,
    source: verifiedSource,
    status: "failure",
    startedWork: true,
  });
});

type QueueTaskFixture = {
  pipeline_number: number;
  repo_id: number;
  labels: Record<string, string> | null;
  created: number;
  concurrency_group?: string;
};
const task = (
  pipeline: number,
  created: number,
  pool = "pr",
  extra: Partial<QueueTaskFixture> = {},
): QueueTaskFixture => ({
  pipeline_number: pipeline,
  repo_id: 1,
  labels: { "ci-pool": pool, "kueue.x-k8s.io/priority-class": "ci-ready" },
  created,
  ...extra,
});
// The golden refresh queued at 1795754121 behind a long pr-pool backlog, as on 2026-11-27.
const golden = task(19_837, 1_795_754_121, "pr", {
  labels: { "ci-pool": "pr", "kueue.x-k8s.io/priority-class": "ci-draft" },
  concurrency_group: "1//ci-maintenance",
});
const backlogQueue = () =>
  WoodpeckerQueueSchema.parse({
    paused: false,
    pending: [task(19_795, 1_795_749_340), golden, task(19_900, 1_795_759_000)],
    waiting_on_deps: null,
    running: [task(19_762, 1_795_739_964), task(19_784, 1_795_748_765)],
  });

/** The backlog with a newer pr-pool task running ahead of the golden refresh. */
function bypassed() {
  const queue = backlogQueue();
  queue.running.push(task(19_901, 1_795_759_100));
  return queue;
}

describe("queued maintenance evidence", () => {
  test("a request behind a long FIFO backlog is slow, not stuck", () => {
    expect(queuedMaintenanceEvidence(backlogQueue(), 19_837, 1)).toEqual({
      stuck: false,
      reason: "1 older pr-pool task(s) are ahead of it in the queue",
    });
  });

  test("newer work in its pool running ahead of it is stuck", () => {
    const queue = backlogQueue();
    queue.running.push(task(19_901, 1_795_759_100));
    expect(queuedMaintenanceEvidence(queue, 19_837, 1)).toEqual({
      stuck: true,
      reason:
        "1 newer pr-pool task(s) started ahead of it, so no agent takes it",
    });
  });

  test("newer work in another pool is not evidence", () => {
    const queue = backlogQueue();
    queue.running.push(task(19_896, 1_795_758_872, "main"));
    expect(queuedMaintenanceEvidence(queue, 19_837, 1).stuck).toBe(false);
  });

  test("heading an idle pool is stuck; an idle pool with older work waiting is an outage, not this request", () => {
    expect(
      queuedMaintenanceEvidence(
        WoodpeckerQueueSchema.parse({
          paused: false,
          pending: [golden],
          waiting_on_deps: null,
          running: null,
        }),
        19_837,
        1,
      ),
    ).toEqual({
      stuck: true,
      reason: "it heads an idle pr pool, so no connected agent matches it",
    });
    expect(
      queuedMaintenanceEvidence(
        WoodpeckerQueueSchema.parse({
          paused: false,
          pending: [task(19_795, 1_795_749_340), golden],
          waiting_on_deps: null,
          running: [],
        }),
        19_837,
        1,
      ).stuck,
    ).toBe(false);
  });

  test("a busy concurrency group, a paused queue, dependencies, or an agent taking it is not stuck", () => {
    const busyGroup = backlogQueue();
    busyGroup.running.push(
      task(19_950, 1_795_759_500, "pr", {
        concurrency_group: "1//ci-maintenance",
      }),
    );
    expect(queuedMaintenanceEvidence(busyGroup, 19_837, 1)).toEqual({
      stuck: false,
      reason: "its concurrency group 1//ci-maintenance is busy",
    });
    expect(
      queuedMaintenanceEvidence({ ...backlogQueue(), paused: true }, 19_837, 1)
        .stuck,
    ).toBe(false);
    const waiting = backlogQueue();
    waiting.pending = waiting.pending.filter(
      (entry) => entry.pipeline_number !== 19_837,
    );
    waiting.waiting_on_deps.push(golden);
    expect(queuedMaintenanceEvidence(waiting, 19_837, 1).stuck).toBe(false);
    const taken = backlogQueue();
    taken.running.push(golden);
    expect(queuedMaintenanceEvidence(taken, 19_837, 1).stuck).toBe(false);
  });

  test("a queued pipeline with no task in the queue cannot run", () => {
    const orphaned = backlogQueue();
    orphaned.pending = orphaned.pending.filter(
      (entry) => entry.pipeline_number !== 19_837,
    );
    expect(queuedMaintenanceEvidence(orphaned, 19_837, 1)).toEqual({
      stuck: true,
      reason: "Woodpecker's queue holds no task for it",
    });
  });
});

/** Serves the pipeline reads in order, the queue, and the cancel response. */
function serveAgeOut(input: {
  pipelines: readonly object[];
  queue: object;
  cancel: number | Error;
}) {
  const calls: string[] = [];
  let reads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((request, init) => {
    const url = nativeUrl(request);
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/queue/info")
      return Promise.resolve(Response.json(input.queue));
    if (url.pathname.endsWith("/cancel"))
      return input.cancel instanceof Error
        ? Promise.reject(input.cancel)
        : Promise.resolve(new Response(null, { status: input.cancel }));
    const pipeline =
      input.pipelines[Math.min(reads, input.pipelines.length - 1)];
    reads++;
    return Promise.resolve(Response.json(pipeline));
  });
  return calls;
}

describe("stuck-only age-out cancel", () => {
  const request: MaintenanceRequest = {
    kind: "workspace-golden",
    source: verifiedSource,
    fingerprint: "golden-v1",
    frozen: false,
    requestId: "request-queued",
    pipeline: 19_837,
  };
  const queued = {
    ...canary,
    number: 19_837,
    status: "pending",
    branch: "main",
    ref: "refs/heads/main",
    message: "ci-maintenance/request-queued",
    workflows: [
      {
        name: "maintenance-workspace-golden",
        state: "pending",
        children: [
          { id: 1, name: "clone", type: "clone", state: "pending" },
          {
            id: 2,
            name: "maintenance-workspace-golden",
            type: "commands",
            state: "pending",
          },
        ],
      },
    ],
  };

  test("long backlog: reads the queue and does not cancel", async () => {
    const calls = serveAgeOut({
      pipelines: [queued],
      queue: backlogQueue(),
      cancel: 204,
    });
    await expect(cancelStuckMaintenance(request)).resolves.toEqual({
      outcome: "waiting",
      detail: "1 older pr-pool task(s) are ahead of it in the queue",
    });
    expect(calls).toEqual([
      "GET /api/repos/1/pipelines/19837",
      "GET /api/queue/info",
    ]);
  });

  test("bypassed: re-reads the pipeline and cancels it", async () => {
    const calls = serveAgeOut({
      pipelines: [queued, queued],
      queue: bypassed(),
      cancel: 204,
    });
    await expect(cancelStuckMaintenance(request)).resolves.toEqual({
      outcome: "canceled",
      detail:
        "1 newer pr-pool task(s) started ahead of it, so no agent takes it",
    });
    expect(calls).toEqual([
      "GET /api/repos/1/pipelines/19837",
      "GET /api/queue/info",
      "GET /api/repos/1/pipelines/19837",
      "POST /api/repos/1/pipelines/19837/cancel",
    ]);
  });

  test("a step that started before the cancel stops it, because cancel kills running work", async () => {
    const cloning = {
      ...queued,
      workflows: [
        {
          ...queued.workflows[0],
          children: [
            {
              id: 1,
              name: "clone",
              type: "clone",
              state: "running",
              started: 1_795_760_000,
            },
          ],
        },
      ],
    };
    const calls = serveAgeOut({
      pipelines: [queued, cloning],
      queue: bypassed(),
      cancel: 204,
    });
    await expect(cancelStuckMaintenance(request)).resolves.toEqual({
      outcome: "not-queued",
      detail: "it is pending",
    });
    expect(calls).not.toContain("POST /api/repos/1/pipelines/19837/cancel");
  });

  test.each([400, 403, 409, 500])(
    "a refused cancel (HTTP %i) is classified by read-back, never assumed",
    async (status) => {
      serveAgeOut({
        pipelines: [queued, queued, queued],
        queue: bypassed(),
        cancel: status,
      });
      await expect(cancelStuckMaintenance(request)).resolves.toEqual({
        outcome: "uncertain",
        detail: `cancel returned HTTP ${status.toString()}; still queued`,
      });
    },
  );

  test("read-back after a refused cancel tells canceled from started", async () => {
    serveAgeOut({
      pipelines: [queued, queued, { ...queued, status: "killed" }],
      queue: bypassed(),
      cancel: 409,
    });
    await expect(cancelStuckMaintenance(request)).resolves.toMatchObject({
      outcome: "canceled",
    });
    vi.restoreAllMocks();
    serveAgeOut({
      pipelines: [queued, queued, { ...queued, status: "running" }],
      queue: bypassed(),
      cancel: new Error("socket hang up"),
    });
    await expect(cancelStuckMaintenance(request)).resolves.toEqual({
      outcome: "not-queued",
      detail: "it is running",
    });
  });

  test("a pipeline that left the queue, or belongs to another request, is never canceled", async () => {
    const calls = serveAgeOut({
      pipelines: [{ ...queued, status: "running" }],
      queue: bypassed(),
      cancel: 204,
    });
    await expect(cancelStuckMaintenance(request)).resolves.toEqual({
      outcome: "not-queued",
      detail: "it is running",
    });
    expect(calls).toEqual(["GET /api/repos/1/pipelines/19837"]);
    vi.restoreAllMocks();
    serveAgeOut({
      pipelines: [{ ...queued, message: "ci-maintenance/another-request" }],
      queue: bypassed(),
      cancel: 204,
    });
    await expect(cancelStuckMaintenance(request)).rejects.toThrow(
      "identity mismatch",
    );
  });
});
