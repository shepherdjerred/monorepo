import { describe, expect, test, vi } from "vitest";
import type {
  RankedRenovateUpdate,
  RenovateRankingSnapshot,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { dispatchRenovateBundle } from "./dispatch.ts";
import {
  woodpeckerHasRoom,
  type BundlePullRequest,
  type RenovateGitHub,
} from "./publication.ts";
import type { DispatchRecord, Publication } from "./store.ts";
import type { VerifiedRenovateBundle } from "./bundle.ts";

const NOW = Date.parse("2026-11-26T19:00:00Z");
const MAIN = "a".repeat(40);
const HEAD = "b".repeat(40);
const PR: BundlePullRequest = {
  number: 99,
  url: "https://github.com/example/repo/pull/99",
  headSha: HEAD,
  state: "open",
};

function candidate(
  id: string,
  overrides: Partial<RankedRenovateUpdate> = {},
): RankedRenovateUpdate {
  return {
    id,
    name: id,
    ecosystem: "npm",
    urgency: "medium",
    effort: "s",
    needed: true,
    rationale: "The release fixes behavior used by the workspace.",
    evidenceUrls: [],
    blockers: [],
    bake: {
      state: "ready",
      eligibleAt: new Date(NOW).toISOString(),
      reason: "Released more than 30 days ago.",
    },
    targets: [
      {
        manager: "npm",
        datasource: "npm",
        packageName: id,
        filePath: `packages/${id}/package.json`,
        currentValue: "1.0.0",
        targetValue: "2.0.0",
        currentVersion: "1.0.0",
        targetVersion: "2.0.0",
        currentDigest: null,
        digest: null,
      },
    ],
    ...overrides,
  };
}

function fixture(candidates: RankedRenovateUpdate[]) {
  const snapshot: RenovateRankingSnapshot = {
    scannedAt: new Date(NOW - 600_000).toISOString(),
    baseSha: MAIN,
    coverage: "complete",
    warnings: [],
    candidates,
  };
  let state: DispatchRecord = { value: { dispositions: {}, publications: {} } };
  let pr: BundlePullRequest | undefined;
  let remoteSha: string | undefined;
  let now = NOW;
  let saves = 0;
  const store = {
    readRanking: async () => snapshot,
    writeRanking: vi.fn(async () => {
      await Promise.resolve();
    }),
    readDispatch: async () => structuredClone(state),
    writeDispatch: vi.fn(async (record: DispatchRecord) => {
      if (record.etag !== state.etag) throw new Error("ETag conflict");
      state = { value: structuredClone(record.value), etag: String(++saves) };
      return structuredClone(state);
    }),
  };
  const recover = vi.fn(async () => {
    pr = PR;
    return PR;
  });
  const github: RenovateGitHub = {
    token: "mock-token",
    slug: "example/repo",
    findPullRequest: async () => pr,
    branchHead: async (branch) => (branch === "main" ? MAIN : remoteSha),
    createRecoveredPullRequest: recover,
    openWorkPaths: async () => new Set(),
  };
  const published = vi.fn(
    async (input: { beforePush?: (sha: string) => Promise<void> }) => {
      await input.beforePush?.(HEAD);
      pr = PR;
      return { commitHash: HEAD, prUrl: PR.url };
    },
  );
  return {
    deps: {
      store,
      github: vi.fn(async () => github),
      enabled: vi.fn(async () => true),
      hasRoom: vi.fn(async () => true),
      hasReceipt: vi.fn(async () => false),
      now: () => now,
      openPr: published,
      verifyCommit: vi.fn(async () => {
        await Promise.resolve();
      }),
    },
    github,
    recover,
    state: () => state.value,
    setPr: (value: BundlePullRequest | undefined) => {
      pr = value;
    },
    setRemote: (value: string | undefined) => {
      remoteSha = value;
    },
    advance: (milliseconds = 600_000) => {
      now += milliseconds;
    },
  };
}

type Execute = NonNullable<
  NonNullable<Parameters<typeof dispatchRenovateBundle>[1]>["execute"]
>;
function executor(): ReturnType<typeof vi.fn<Execute>> {
  return vi.fn<Execute>(async (input, publish) => {
    const chosen = input.candidates[0];
    if (chosen === undefined) throw new Error("Expected a candidate");
    const bundle: VerifiedRenovateBundle = {
      baseSha: MAIN,
      candidates: [chosen],
      candidateIds: [chosen.id],
      changedFiles: chosen.targets.map(({ filePath }) => filePath),
      diffSha256: chosen.id,
      repoDir: "repo",
      tempDir: "tmp",
      signal: new AbortController().signal,
      demo: "Verified before/after pins",
      verificationSummary: "Checks passed",
    };
    const publication = await publish(bundle);
    return {
      publication,
      candidateIds: [chosen.id],
      attemptedCandidateIds: [chosen.id],
      dispositions: [],
    };
  });
}

describe("Renovate dispatch", () => {
  test("does not admit bundles when a paused or backlogged Woodpecker reports idle workers", () => {
    const queue = {
      paused: false,
      stats: {
        worker_count: 3,
        running_count: 2,
        pending_count: 0,
        waiting_on_deps_count: 0,
      },
    };
    expect(woodpeckerHasRoom(queue)).toBe(true);
    expect(woodpeckerHasRoom({ ...queue, paused: true })).toBe(false);
    expect(
      woodpeckerHasRoom({
        ...queue,
        stats: { ...queue.stats, pending_count: 1 },
      }),
    ).toBe(false);
    expect(
      woodpeckerHasRoom({
        ...queue,
        stats: { ...queue.stats, waiting_on_deps_count: 1 },
      }),
    ).toBe(false);
  });
  test("offers every eligible update in urgency and effort order without publishing a preview", async () => {
    const updates = [
      candidate("s"),
      candidate("urgent", { urgency: "high", effort: "m" }),
      candidate("oversized", { effort: "l" }),
      candidate("low", { urgency: "low" }),
      candidate("baking", {
        bake: { state: "waiting", eligibleAt: null, reason: "waiting" },
      }),
      candidate("unneeded", { needed: false }),
    ];
    const { deps } = fixture(updates);
    const execute = executor();
    const result = await dispatchRenovateBundle(
      { preview: true },
      { ...deps, execute },
    );
    expect(result.outcome).toBe("preview");
    expect(execute.mock.calls[0]?.[0].candidates.map(({ id }) => id)).toEqual([
      "urgent",
      "s",
      "low",
    ]);
    expect(deps.github).not.toHaveBeenCalled();
    expect(deps.store.writeDispatch).not.toHaveBeenCalled();
  });

  test("holds capacity failures, then waits for an exact CI receipt before offering independent work", async () => {
    const { deps, state } = fixture([candidate("alpha"), candidate("beta")]);
    const execute = executor();
    deps.hasRoom.mockResolvedValueOnce(false);
    await dispatchRenovateBundle({}, { ...deps, execute });
    expect(state().dispositions["alpha"]?.reason).toBe(
      "Woodpecker is at capacity.",
    );
    expect(execute).not.toHaveBeenCalled();
    await dispatchRenovateBundle({}, { ...deps, execute });
    expect(state().dispositions["alpha"]?.status).toBe("published");
    await dispatchRenovateBundle({}, { ...deps, execute });
    expect(state().dispositions["beta"]?.reason).toContain("acknowledge");
    expect(deps.hasReceipt).toHaveBeenCalledWith(PR.number, HEAD);
    expect(deps.openPr).toHaveBeenCalledTimes(1);
    deps.hasReceipt.mockResolvedValue(true);
    const observe = vi.fn<Execute>(async () => ({
      candidateIds: [],
      attemptedCandidateIds: [],
      dispositions: [],
    }));
    await dispatchRenovateBundle({}, { ...deps, execute: observe });
    expect(observe.mock.calls[0]?.[0].candidates.map(({ id }) => id)).toEqual([
      "beta",
    ]);
  });

  test("recovers a pushed branch after ambiguous failure without pushing it again", async () => {
    const { deps, recover, state, setRemote, advance } = fixture([
      candidate("alpha"),
    ]);
    const execute = executor();
    deps.openPr.mockImplementationOnce(async (input) => {
      await input.beforePush?.(HEAD);
      setRemote(HEAD);
      throw new Error("PR creation response was lost");
    });
    await expect(
      dispatchRenovateBundle({}, { ...deps, execute }),
    ).rejects.toThrow("response was lost");
    expect(
      Object.values(state().publications).map(({ headSha }) => headSha),
    ).toEqual([HEAD]);
    advance();
    await dispatchRenovateBundle({}, { ...deps, execute });
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining<Partial<Publication>>({ headSha: HEAD }),
    );
    expect(state().dispositions["alpha"]?.status).toBe("published");
    expect(deps.openPr).toHaveBeenCalledTimes(1);
  });

  test("holds a previously pushed commit when the eligibility snapshot expires", async () => {
    const { deps, recover, setRemote, advance } = fixture([candidate("alpha")]);
    const execute = executor();
    deps.openPr.mockImplementationOnce(async (input) => {
      await input.beforePush?.(HEAD);
      setRemote(HEAD);
      throw new Error("PR creation response was lost");
    });
    await expect(
      dispatchRenovateBundle({}, { ...deps, execute }),
    ).rejects.toThrow("response was lost");
    advance(37 * 60 * 60 * 1000);
    await expect(
      dispatchRenovateBundle({}, { ...deps, execute }),
    ).resolves.toEqual({ outcome: "no-fresh-ranking" });
    expect(recover).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
