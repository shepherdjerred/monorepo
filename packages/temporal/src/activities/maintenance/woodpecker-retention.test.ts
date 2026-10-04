import { describe, expect, test } from "vitest";
import { RetentionClient } from "./woodpecker-retention-client.ts";
import {
  applyRetentionBatch,
  planRetentionBatch,
  retentionProgressFromHeartbeat,
} from "./woodpecker-retention-core.ts";
import {
  retentionEligible,
  type RetentionPipeline,
  type RetentionRepo,
} from "#shared/woodpecker-retention.ts";

import {
  retentionTestRepo as repo,
  retentionTestPipeline as pipeline,
  retentionTestCandidate as candidate,
} from "./woodpecker-retention-test-fixtures.ts";
function fixture() {
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
      if (path.includes("pipelines?"))
        return Array.from({ length: 100 }, (_, index) => ({
          ...pipeline,
          number: index + 1,
        }));
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
    for (const status of ["pending", "running", "blocked"] as const)
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
