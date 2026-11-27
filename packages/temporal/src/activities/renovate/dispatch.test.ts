import { describe, expect, test, vi } from "vitest";
import type {
  RankedRenovateUpdate,
  RenovateRankingSnapshot,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import type * as githubAppToken from "#lib/github-app-token.ts";
import { dispatchRenovateBundle } from "./dispatch.ts";
import {
  createRenovateGitHub,
  woodpeckerHasRoom,
  type BundlePullRequest,
  type RenovateGitHub,
} from "./publication.ts";
import type { DispatchRecord, Publication } from "./store.ts";
import type { VerifiedRenovateBundle } from "./bundle.ts";

const NOW = Date.parse("2026-11-26T19:00:00Z");
const MAIN = "a".repeat(40);
const HEAD = "b".repeat(40);
const SKEWED = "c".repeat(40);
const PR: BundlePullRequest = {
  number: 99,
  url: "https://github.com/example/repo/pull/99",
  headSha: HEAD,
  state: "open",
};

const githubApi = vi.hoisted(() => ({
  list: vi.fn(),
  listFiles: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("octokit", () => ({
  Octokit: class {
    rest = { pulls: githubApi };
    async paginate(method: () => Promise<unknown>) {
      return await method();
    }
  },
}));

vi.mock("#lib/github-app-token.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof githubAppToken>()),
  createGitHubAppInstallationToken: async () => ({ token: "test-token" }),
}));

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
    return { ...PR, baseSha: MAIN };
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
    setPublications: (publications: Publication[]) => {
      state.value.publications = Object.fromEntries(
        publications.map((publication) => [publication.branch, publication]),
      );
    },
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

function plannedPublication(update: RankedRenovateUpdate): Publication {
  return {
    branch: `chore/renovate-bundle-${update.id}`,
    title: "chore(deps): update dependencies",
    body: "Verified test bundle",
    headSha: HEAD,
    baseSha: MAIN,
    plannedAt: new Date(NOW - 600_000).toISOString(),
    files: update.targets.map(({ filePath }) => filePath),
    candidates: [update],
    woodpeckerSeen: false,
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

async function submitWithLostPrResponse() {
  const scenario = fixture([candidate("alpha")]);
  const execute = executor();
  scenario.deps.openPr.mockImplementationOnce(async (input) => {
    await input.beforePush?.(HEAD);
    scenario.setRemote(HEAD);
    throw new Error("PR creation response was lost");
  });
  await expect(
    dispatchRenovateBundle({}, { ...scenario.deps, execute }),
  ).rejects.toThrow("response was lost");
  return { ...scenario, execute };
}

function mockMismatchedRecoveredPr(readbackHeadSha = HEAD): void {
  const data = {
    number: PR.number,
    node_id: "app-created-node",
    html_url: PR.url,
    head: { sha: HEAD },
    base: { sha: SKEWED },
    state: "open",
  };
  githubApi.create.mockResolvedValueOnce({ data });
  githubApi.get.mockResolvedValueOnce({
    data: { ...data, head: { sha: readbackHeadSha } },
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
    const { deps, recover, state, advance, execute } =
      await submitWithLostPrResponse();
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
});

describe("Renovate recovery conflicts", () => {
  test("reserves a conflicting branch while recovering an independent publication", async () => {
    const alpha = candidate("alpha");
    const beta = candidate("beta");
    const conflicted = plannedPublication(alpha);
    const recoverable = plannedPublication(beta);
    const { deps, github, recover, state, setPublications } = fixture([
      alpha,
      beta,
    ]);
    setPublications([conflicted, recoverable]);
    github.branchHead = async (branch) =>
      branch === "main" ? MAIN : branch === conflicted.branch ? SKEWED : HEAD;
    const execute = executor();

    await dispatchRenovateBundle({}, { ...deps, execute });

    expect(recover).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ branch: recoverable.branch }),
    );
    expect(state().dispositions[alpha.id]?.status).toBe("blocked");
    expect(state().publications[conflicted.branch]).toEqual(conflicted);
    expect(state().dispositions[beta.id]?.status).toBe("published");
    expect(execute).not.toHaveBeenCalled();
  });

  test("reconciles a retained closed publication with publishing disabled and no dispatch candidates", async () => {
    const update = candidate("alpha");
    const closed: Publication = {
      ...plannedPublication(update),
      state: "closed",
      prNumber: PR.number,
    };
    const { deps, state, setPr, setPublications } = fixture([]);
    setPublications([closed]);
    const execute = executor();
    deps.enabled.mockResolvedValue(false);
    setPr(PR);

    await dispatchRenovateBundle({}, { ...deps, execute });

    expect(state().dispositions[update.id]?.status).toBe("published");
    expect(deps.hasReceipt).toHaveBeenCalledWith(PR.number, PR.headSha);
    expect(execute).not.toHaveBeenCalled();

    setPr({ ...PR, state: "merged" });
    await dispatchRenovateBundle({}, { ...deps, execute });
    expect(state().dispositions[update.id]?.status).toBe("merged");
  });

  test("checks both refs again after journaling a recovery claim", async () => {
    const update = candidate("alpha");
    const planned = plannedPublication(update);
    const { deps, github, recover, state, setPublications } = fixture([update]);
    setPublications([planned]);
    vi.spyOn(github, "branchHead")
      .mockResolvedValueOnce(HEAD)
      .mockResolvedValueOnce(MAIN)
      .mockResolvedValueOnce(SKEWED)
      .mockResolvedValueOnce(MAIN);

    await dispatchRenovateBundle({}, { ...deps, execute: executor() });

    expect(recover).not.toHaveBeenCalled();
    expect(state().dispositions[update.id]?.status).toBe("blocked");
    expect(state().publications[planned.branch]?.headSha).toBe(HEAD);
  });

  test("reserves a mismatched PR only discovered by reconciliation", async () => {
    const update = candidate("alpha");
    const planned = plannedPublication(update);
    const { deps, recover, state, setPublications, setPr } = fixture([update]);
    setPublications([planned]);
    setPr({ ...PR, headSha: SKEWED });

    await dispatchRenovateBundle({}, { ...deps, execute: executor() });

    expect(recover).not.toHaveBeenCalled();
    expect(state().publications[planned.branch]).toEqual(planned);
    expect(state().dispositions[update.id]).toMatchObject({
      status: "blocked",
      prUrl: PR.url,
    });
  });

  test("preserves a known recovery base mismatch on later exact-head readback", async () => {
    const update = candidate("alpha");
    const planned = plannedPublication(update);
    const { deps, recover, state, setPublications, setPr, setRemote } = fixture(
      [update],
    );
    setPublications([planned]);
    setRemote(HEAD);
    recover.mockImplementationOnce(async () => {
      setPr(PR);
      return { ...PR, baseSha: SKEWED };
    });
    const execute = executor();

    await dispatchRenovateBundle({}, { ...deps, execute });
    await dispatchRenovateBundle({}, { ...deps, execute });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(state().publications[planned.branch]).toMatchObject({
      prNumber: PR.number,
    });
    expect(state().dispositions[update.id]?.status).toBe("blocked");
    expect(deps.hasReceipt).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("holds a previously pushed commit when the eligibility snapshot expires", async () => {
    const { deps, recover, advance, execute } =
      await submitWithLostPrResponse();
    advance(37 * 60 * 60 * 1000);
    await expect(
      dispatchRenovateBundle({}, { ...deps, execute }),
    ).resolves.toEqual({ outcome: "no-fresh-ranking" });
    expect(recover).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("GitHub publication checks", () => {
  test.each([3000, 3001])(
    "checks an at-cap listing against a reported count of %i",
    async (count) => {
      githubApi.list.mockResolvedValueOnce([{ number: PR.number }]);
      githubApi.listFiles.mockResolvedValueOnce(
        Array.from({ length: 3000 }, (_, index) => ({
          filename: `path-${String(index)}`,
        })),
      );
      githubApi.get.mockResolvedValueOnce({ data: { changed_files: count } });
      const github = await createRenovateGitHub();

      if (count === 3000) {
        const paths = await github.openWorkPaths();
        expect(paths.size).toBe(3000);
        expect(paths.has("path-2999")).toBe(true);
      } else {
        await expect(github.openWorkPaths()).rejects.toThrow(
          "incomplete changed-path listing",
        );
      }
    },
  );

  test("closes only the PR it just created when that PR's refs fail readback", async () => {
    mockMismatchedRecoveredPr();
    githubApi.update.mockResolvedValueOnce({ data: { state: "closed" } });
    const github = await createRenovateGitHub();

    await expect(
      github.createRecoveredPullRequest(plannedPublication(candidate("alpha"))),
    ).resolves.toMatchObject({
      state: "closed",
      closedUnverified: true,
      baseSha: SKEWED,
    });
    expect(githubApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: PR.number, state: "closed" }),
    );
  });

  test("preserves a created PR whose head moved before cleanup readback", async () => {
    mockMismatchedRecoveredPr(SKEWED);
    githubApi.update.mockClear();
    const github = await createRenovateGitHub();

    const observed = await github.createRecoveredPullRequest(
      plannedPublication(candidate("alpha")),
    );

    expect(observed.state).toBe("open");
    expect(observed.closedUnverified).toBeUndefined();
    expect(githubApi.update).not.toHaveBeenCalled();
  });

  test("returns the mismatched creation receipt if cleanup is unconfirmed", async () => {
    mockMismatchedRecoveredPr();
    githubApi.update.mockRejectedValueOnce(new Error("Closure response lost"));
    const github = await createRenovateGitHub();

    const observed = await github.createRecoveredPullRequest(
      plannedPublication(candidate("alpha")),
    );

    expect(observed).toMatchObject({
      number: PR.number,
      baseSha: SKEWED,
      state: "open",
    });
    expect(observed.closedUnverified).toBeUndefined();
  });
});
