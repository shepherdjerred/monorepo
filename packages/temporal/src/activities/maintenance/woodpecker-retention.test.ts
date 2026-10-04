import { describe, expect, test } from "vitest";
import {
  RetentionClient,
  detailIsTerminal,
} from "./woodpecker-retention-client.ts";
import {
  applyRetentionBatch,
  planRetentionBatch,
  retentionProgressFromHeartbeat,
} from "./woodpecker-retention-core.ts";
import {
  retentionEligible,
  RetentionPipelineSchema,
  RetentionCheckpointSchema,
  type RetentionPipeline,
  type RetentionRepo,
} from "#shared/woodpecker-retention.ts";

import {
  retentionTestRepo as repo,
  retentionTestPipeline as pipeline,
  retentionTestCandidate as candidate,
} from "./woodpecker-retention-test-fixtures.ts";
function fixture(totalPipelines?: number) {
  let currentRepo = { ...repo };
  let repoReads = 0;
  let repoChangeAtFinal: Partial<RetentionRepo> | undefined;
  let current = { ...pipeline };
  let logs = [{ data: Buffer.from("test output").toString("base64") }];
  let steps: { id: number; state: string }[] = [{ id: 9, state: "failure" }];
  let heads = new Set<string>();
  let deleteWorks = true;
  let referencesRead = 0;
  let protectAfter: number | undefined;
  const deleted: string[] = [];
  const pages: string[] = [];
  const client = new RetentionClient(
    async (path, method) => {
      if (method === "DELETE") {
        deleted.push(path);
        if (deleteWorks) logs = [];
        return null;
      }
      if (path === `/api/repos/${String(repo.id)}`) {
        repoReads++;
        if (repoReads === 2)
          currentRepo = { ...currentRepo, ...repoChangeAtFinal };
        return currentRepo;
      }
      if (path.includes("/logs/")) return logs;
      if (path.includes("pipelines?")) {
        pages.push(path);
        const page = Number(
          new URLSearchParams(path.split("?")[1]).get("page"),
        );
        return Array.from({ length: 50 }, (_, index) => ({
          ...pipeline,
          number:
            totalPipelines === undefined
              ? (page - 1) * 50 + index + 1
              : totalPipelines - (page - 1) * 50 - index,
        }));
      }
      return {
        ...current,
        number: Number(path.split("/").at(-1)),
        workflows: [{ state: "failure", children: steps }],
      };
    },
    () => {
      referencesRead++;
      if (protectAfter !== undefined && referencesRead >= protectAfter)
        heads.add(pipeline.commit);
      return Promise.resolve({
        heads,
        numbers: new Set(),
        protectAllMain: false,
      });
    },
  );
  return {
    client,
    deleted,
    pages,
    changeRepo: (value: Partial<RetentionRepo>, final: boolean) => {
      if (final) repoChangeAtFinal = value;
      else currentRepo = { ...currentRepo, ...value };
    },
    repoReads: () => repoReads,
    change: (value: Partial<RetentionPipeline>) => {
      current = { ...current, ...value };
    },
    protect: () => {
      heads = new Set([pipeline.commit]);
    },
    activeStep: () => {
      steps = [{ id: 9, state: "running" }];
    },
    retainLogs: () => {
      deleteWorks = false;
    },
    referenceReads: () => referencesRead,
    protectAtFinal: () => {
      protectAfter = 2;
    },
  };
}
const hooks = () => ({
  signal: new AbortController().signal,
  onProgress: () => {
    /* These unit tests inspect returned receipts directly. */
  },
});
const input = { candidates: [candidate], cutoff: 100, dryRun: false };
async function applyOutcome(...args: Parameters<typeof applyRetentionBatch>) {
  const receipts = await applyRetentionBatch(...args);
  return receipts[0]?.outcome;
}
function unusedReferences(): Promise<never> {
  throw new Error("This API test does not read references");
}

describe("Woodpecker retention repository identity", () => {
  test.each([
    { id: 2 },
    { full_name: "shepherdjerred/renamed" },
    { default_branch: "release" },
  ])(
    "repository identity change %j prevents DELETE at both boundaries",
    async (change) => {
      for (const final of [false, true]) {
        const f = fixture();
        f.changeRepo(change, final);
        expect(
          await applyOutcome(input, f.client, hooks(), () =>
            Promise.resolve(true),
          ),
        ).toBe("changed");
        expect(f.deleted).toEqual([]);
        expect(f.repoReads()).toBe(final ? 2 : 1);
        expect(f.referenceReads()).toBe(final ? 2 : 0);
      }
    },
  );
});

describe("Woodpecker retention safety", () => {
  test("protects all nonterminal pipelines, latest references and unfinished/recent runs", () => {
    for (const status of ["pending", "running", "blocked", "created"] as const)
      expect(
        retentionEligible(repo, { ...pipeline, status }, 100, {
          heads: new Set(),
          protectAllMain: false,
        }),
      ).toBe(false);
    expect(
      retentionEligible(repo, { ...pipeline, finished: 0 }, 100, {
        heads: new Set(),
        protectAllMain: false,
      }),
    ).toBe(false);
    expect(
      retentionEligible(repo, { ...pipeline, finished: 100 }, 100, {
        heads: new Set(),
        protectAllMain: false,
      }),
    ).toBe(false);
    expect(
      retentionEligible(repo, pipeline, 100, {
        heads: new Set([pipeline.commit]),
        protectAllMain: false,
      }),
    ).toBe(false);
    expect(
      retentionEligible(repo, pipeline, 100, {
        heads: new Set(),
        protectAllMain: false,
        numbers: new Set([1]),
      }),
    ).toBe(false);
    expect(
      retentionEligible(repo, { ...pipeline, branch: "main" }, 100, {
        heads: new Set(),
        protectAllMain: true,
      }),
    ).toBe(false);
  });
  test("dry-run returns exact candidates without DELETE", async () => {
    const f = fixture();
    expect(
      await applyRetentionBatch(
        { ...input, dryRun: true },
        f.client,
        hooks(),
        () => Promise.resolve(true),
      ),
    ).toEqual([{ candidate, outcome: "dry-run" }]);
    expect(f.deleted).toEqual([]);
  });
  test("disabled policy never deletes and changed identity never deletes", async () => {
    const f = fixture();
    expect(
      await applyOutcome(input, f.client, hooks(), () =>
        Promise.resolve(false),
      ),
    ).toBe("disabled");
    f.change({ commit: "b".repeat(40) });
    expect(
      await applyOutcome(input, f.client, hooks(), () => Promise.resolve(true)),
    ).toBe("changed");
    expect(f.deleted).toEqual([]);
  });
  test("current PR reference and active step protect even a terminal pipeline", async () => {
    const f = fixture();
    f.protect();
    expect(
      await applyOutcome(input, f.client, hooks(), () => Promise.resolve(true)),
    ).toBe("protected");
    const active = fixture();
    active.activeStep();
    expect(
      await applyOutcome(input, active.client, hooks(), () =>
        Promise.resolve(true),
      ),
    ).toBe("protected");
    expect(active.deleted).toEqual([]);
  });
  test("rechecks kill switch immediately before DELETE and checks every log afterward", async () => {
    const f = fixture();
    let checks = 0;
    expect(
      await applyOutcome(input, f.client, hooks(), () =>
        Promise.resolve(++checks === 1),
      ),
    ).toBe("disabled");
    expect(f.deleted).toEqual([]);
    const success = fixture();
    expect(
      await applyOutcome(input, success.client, hooks(), () =>
        Promise.resolve(true),
      ),
    ).toBe("deleted");
    expect(success.deleted).toEqual(["/api/repos/1/logs/1"]);
    expect(success.referenceReads()).toBe(2);
    expect(await success.client.detail(repo, 1)).toMatchObject(pipeline);
    const failed = fixture();
    failed.retainLogs();
    await expect(
      applyRetentionBatch(input, failed.client, hooks(), () =>
        Promise.resolve(true),
      ),
    ).rejects.toThrow("did not clear every step");
  });
  test("resumes exact completed receipts and rejects a different manifest", async () => {
    const f = fixture();
    const previous = [{ candidate, outcome: "deleted" }];
    expect(
      await applyRetentionBatch({ ...input, previous }, f.client, hooks(), () =>
        Promise.resolve(true),
      ),
    ).toEqual(previous);
    expect(f.deleted).toEqual([]);
    await expect(
      applyRetentionBatch(
        { ...input, candidates: [{ ...candidate, logEntries: 2 }], previous },
        f.client,
        hooks(),
        () => Promise.resolve(true),
      ),
    ).rejects.toThrow("exact candidates");
  });
  test("cancellation stops writes", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      applyRetentionBatch(
        input,
        f.client,
        { ...hooks(), signal: controller.signal },
        () => Promise.resolve(true),
      ),
    ).rejects.toThrow();
    expect(f.deleted).toEqual([]);
  });
  test("a partial final page preserves the next unprocessed item", async () => {
    const f = fixture();
    const first = await planRetentionBatch(
      {
        repos: [repo],
        cursor: { repoIndex: 0, page: 1 },
        cutoff: 100,
        remaining: 1,
      },
      f.client,
      hooks(),
    );
    expect(first).toMatchObject({
      scanned: 1,
      cursor: { repoIndex: 0, page: 1, offset: 1 },
    });
    expect(first.candidates[0]?.pipeline.number).toBe(1);
    const second = await planRetentionBatch(
      {
        repos: [repo],
        cursor: first.cursor ?? { repoIndex: 0, page: 1 },
        cutoff: 100,
        remaining: 1,
      },
      f.client,
      hooks(),
    );
    expect(second).toMatchObject({
      scanned: 1,
      cursor: { repoIndex: 0, page: 1, offset: 2 },
    });
    expect(second.candidates[0]?.pipeline.number).toBe(2);
  });
  test("a head becoming protected during final reference validation prevents DELETE", async () => {
    const f = fixture();
    f.protectAtFinal();
    expect(
      await applyOutcome(input, f.client, hooks(), () => Promise.resolve(true)),
    ).toBe("changed");
    expect(f.deleted).toEqual([]);
  });
});

describe("Woodpecker retention log-only API", () => {
  test("pinned created/canceled states parse, created children protect and unknown states reject", () => {
    const protection = { heads: new Set<string>(), protectAllMain: false };
    const canceled = RetentionPipelineSchema.parse({
      ...pipeline,
      status: "canceled",
    });
    expect(retentionEligible(repo, canceled, 100, protection)).toBe(true);
    expect(detailIsTerminal({ ...canceled, workflows: [] })).toBe(true);
    const created = RetentionPipelineSchema.parse({
      ...pipeline,
      status: "created",
    });
    expect(detailIsTerminal({ ...created, workflows: [] })).toBe(false);
    expect(
      detailIsTerminal({
        ...pipeline,
        workflows: [{ state: "created", children: [] }],
      }),
    ).toBe(false);
    expect(
      detailIsTerminal({
        ...pipeline,
        workflows: [
          { state: "failure", children: [{ id: 9, state: "created" }] },
        ],
      }),
    ).toBe(false);
    expect(() =>
      RetentionPipelineSchema.parse({ ...pipeline, status: "unknown" }),
    ).toThrow();
  });
  test("heartbeat resume uses the SDK single-payload wire contract", () => {
    expect(retentionProgressFromHeartbeat(undefined)).toEqual({
      stage: "retention",
      receipts: [],
    });
    const progress = {
      stage: "retention",
      receipts: [{ candidate, outcome: "deleted" }],
    };
    expect(retentionProgressFromHeartbeat(progress)).toEqual(progress);
    expect(() => retentionProgressFromHeartbeat([progress])).toThrow();
  });
  test("documented omitted workflows/children are empty, malformed present values fail", async () => {
    const noWorkflows = new RetentionClient(
      () => Promise.resolve(pipeline),
      unusedReferences,
    );
    expect(await noWorkflows.logEntries(repo, 1)).toBe(0);
    const noChildren = new RetentionClient(
      () => Promise.resolve({ ...pipeline, workflows: [{ state: "failure" }] }),
      unusedReferences,
    );
    expect(await noChildren.logEntries(repo, 1)).toBe(0);
    const corrupt = new RetentionClient(
      () => Promise.resolve({ ...pipeline, workflows: null }),
      unusedReferences,
    );
    await expect(corrupt.logEntries(repo, 1)).rejects.toThrow();
  });
  test("base64/null wire is strict and pipeline age filter is RFC3339", async () => {
    const paths: string[] = [];
    const client = new RetentionClient((path) => {
      paths.push(path);
      if (path.includes("pipelines?")) return Promise.resolve([]);
      if (path.includes("logs"))
        return Promise.resolve([{ data: null }, { data: "YQ==" }]);
      return Promise.resolve({
        ...pipeline,
        workflows: [
          { state: "failure", children: [{ id: 45, state: "failure" }] },
        ],
      });
    }, unusedReferences);
    expect(await client.logEntries(repo, 1)).toBe(1);
    await client.page(repo, 1, 100);
    expect(paths.at(-1)).toContain("before=1970-01-01T00%3A01%3A40.000Z");
    expect(paths).toContain("/api/repos/1/logs/1/45");
  });
  test("corrupt base64 is a contract failure before deletion", async () => {
    const client = new RetentionClient(
      (path) =>
        Promise.resolve(
          path.includes("logs")
            ? [{ data: "Zh==" }]
            : {
                ...pipeline,
                workflows: [
                  { state: "failure", children: [{ id: 1, state: "failure" }] },
                ],
              },
        ),
      unusedReferences,
    );
    await expect(client.logEntries(repo, 1)).rejects.toThrow();
  });
});

describe("Woodpecker retention numeric continuation", () => {
  test("oversized repository and pipeline pages are contract failures", async () => {
    const client = new RetentionClient(
      (path) =>
        Promise.resolve(
          Array.from({ length: 51 }, () =>
            path.includes("pipelines?") ? pipeline : repo,
          ),
        ),
      unusedReferences,
    );
    await expect(client.repos()).rejects.toThrow();
    await expect(client.page(repo, 1, 100)).rejects.toThrow();
  });
  test("partial-page continuation consumes 40..49 then only the remaining next-page budget", async () => {
    const f = fixture();
    const result = await planRetentionBatch(
      {
        repos: [repo],
        cursor: { repoIndex: 0, page: 1, offset: 40 },
        cutoff: 100,
        remaining: 15,
      },
      f.client,
      hooks(),
    );
    expect(result.scanned).toBe(15);
    expect(result.candidates.map((item) => item.pipeline.number)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 41),
    );
    expect(result.cursor).toEqual({ repoIndex: 0, page: 2, offset: 5 });
    const next = await planRetentionBatch(
      {
        repos: [repo],
        cursor: result.cursor ?? { repoIndex: 0, page: 2, offset: 5 },
        cutoff: 100,
        remaining: 1,
      },
      f.client,
      hooks(),
    );
    expect(next.scanned).toBe(1);
    expect(next.candidates[0]?.pipeline.number).toBe(56);
    expect(next.cursor).toEqual({ repoIndex: 0, page: 2, offset: 6 });
  });
  test("repository inventory continues after the pinned full 50-record page", async () => {
    const paths: string[] = [];
    const repos = Array.from({ length: 51 }, (_, index) => ({
      ...repo,
      id: index + 1,
      full_name: `shepherdjerred/repo-${String(index + 1)}`,
    }));
    const client = new RetentionClient((path) => {
      paths.push(path);
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return Promise.resolve(repos.slice((page - 1) * 50, page * 50));
    }, unusedReferences);
    expect(await client.repos()).toEqual(repos);
    expect(paths).toEqual([
      "/api/repos?page=1&perPage=50",
      "/api/repos?page=2&perPage=50",
    ]);
  });
  test("resume offsets must remain inside the pinned 50-record page", () => {
    const checkpoint = {
      repos: [repo],
      cutoff: 100,
      cursor: { repoIndex: 0, page: 201, offset: 49 },
    };
    expect(RetentionCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
    expect(() =>
      RetentionCheckpointSchema.parse({
        ...checkpoint,
        cursor: { ...checkpoint.cursor, offset: 50 },
      }),
    ).toThrow();
  });
  test("continues beyond 10,000 same-second pipelines with a fixed cutoff and batch limits", async () => {
    const f = fixture(20_000);
    const first = await planRetentionBatch(
      {
        repos: [repo],
        cursor: { repoIndex: 0, page: 200 },
        cutoff: 100,
        remaining: 1000,
      },
      f.client,
      hooks(),
    );
    expect(first.scanned).toBe(100);
    expect(first.candidates).toHaveLength(100);
    expect(first.candidates[50]?.pipeline.number).toBe(10_000);
    expect(first.candidates.at(-1)?.pipeline.number).toBe(9951);
    expect(first.cursor).toEqual({ repoIndex: 0, page: 202 });
    const next = await planRetentionBatch(
      {
        repos: [repo],
        cursor: first.cursor ?? { repoIndex: 0, page: 202 },
        cutoff: 100,
        remaining: 1,
      },
      f.client,
      hooks(),
    );
    expect(next.scanned).toBe(1);
    expect(next.candidates[0]?.pipeline.number).toBe(9950);
    expect(next.candidates[0]?.pipeline.created).toBe(
      first.candidates.at(-1)?.pipeline.created,
    );
    expect(next.cursor).toEqual({ repoIndex: 0, page: 202, offset: 1 });
    expect(
      f.pages.map((path) =>
        new URLSearchParams(path.split("?")[1]).get("before"),
      ),
    ).toEqual(Array.from({ length: 3 }, () => "1970-01-01T00:01:40.000Z"));
    expect(
      f.pages.every(
        (path) =>
          new URLSearchParams(path.split("?")[1]).get("perPage") === "50",
      ),
    ).toBe(true);
  });
  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY])(
    "rejects unsafe page %s before request",
    async (page) => {
      const f = fixture();
      await expect(f.client.page(repo, page, 100)).rejects.toThrow(
        "safe positive offset",
      );
      expect(f.pages).toEqual([]);
    },
  );
});
