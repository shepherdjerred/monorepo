import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import {
  computeStaleBaseOverlap,
  evaluateStaleBase,
  formatStaleBaseLine,
  type DiffFile,
} from "#lib/ci/stale-base/evaluate.ts";
import {
  appendPrLandReceipt,
  PrLandReceiptSchema,
  prLandReceiptPath,
} from "#lib/ci/stale-base/receipts.ts";
import {
  buildWorkspaceGraph,
  loadWorkspaceGraph,
  type WorkspaceGraph,
} from "#lib/ci/stale-base/workspaces.ts";

const HEAD_SHA = "1".repeat(40);
const BASE_SHA = "2".repeat(40);
const MAIN_SHA = "3".repeat(40);

function modified(filename: string): DiffFile {
  return { filename, status: "modified" };
}

function added(filename: string): DiffFile {
  return { filename, status: "added" };
}

type ReplayCase = {
  readonly id: string;
  readonly kind: "skew" | "disjoint";
  readonly prLabel: string;
  readonly mainLabel: string;
  readonly prFiles: readonly DiffFile[];
  readonly mainFiles: readonly DiffFile[];
  readonly expectedReasonSubstring?: string | undefined;
};

/**
 * Authentic 20-case replay suite derived from the Nov 10–23 14-day main-branch
 * forensics audit (`AI-542`): all 10 true stale-base semantic skew incidents
 * plus 10 concurrent disjoint PR pairs from the same window.
 */
export const HISTORICAL_REPLAY_CASES: readonly ReplayCase[] = [
  {
    id: "skew-01-#16363",
    kind: "skew",
    prLabel: "PR #4455 (tracker bulk-update)",
    mainLabel: "PR #4427 (tracker list children)",
    prFiles: [
      modified("packages/tracker/src/infrastructure/issues.ts"),
      added("packages/tracker/src/infrastructure/issue-update.ts"),
    ],
    mainFiles: [
      modified("packages/tracker/package.json"),
      added("packages/tracker/e2e/lists.spec.ts"),
    ],
    expectedReasonSubstring: "@shepherdjerred/tracker",
  },
  {
    id: "skew-02-#16630",
    kind: "skew",
    prLabel: "PR #4529 (scout Explore budget)",
    mainLabel: "PR #4532 (scout Explore query)",
    prFiles: [
      modified(
        "packages/scout-for-lol/packages/backend/src/explore/runs/run-turn.ts",
      ),
    ],
    mainFiles: [
      added(
        "packages/scout-for-lol/packages/backend/src/explore/runs/run-turn.test.ts",
      ),
    ],
    expectedReasonSubstring: "@scout-for-lol/backend",
  },
  {
    id: "skew-03-#16858",
    kind: "skew",
    prLabel: "PR #4572 (cdk8s netpol staging)",
    mainLabel: "PR #4570 (cdk8s policy reciprocity)",
    prFiles: [
      added("packages/homelab/src/cdk8s/src/enforcement-staging.ts"),
      modified("packages/homelab/src/cdk8s/src/fleet-policy/fleet.ts"),
    ],
    mainFiles: [
      added(
        "packages/homelab/src/cdk8s/src/fleet-policy/policy-reciprocity.test.ts",
      ),
    ],
    expectedReasonSubstring: "@homelab/cdk8s",
  },
  {
    id: "skew-04-#16926",
    kind: "skew",
    prLabel: "PR #4563 (scout testing dir 26/25)",
    mainLabel: "PR #4582/#4586 (scout testing dir)",
    prFiles: [
      added(
        "packages/scout-for-lol/packages/backend/src/testing/ops-console-fixture.ts",
      ),
    ],
    mainFiles: [
      added(
        "packages/scout-for-lol/packages/backend/src/testing/desktop-telemetry-fixture.ts",
      ),
    ],
    expectedReasonSubstring:
      "packages/scout-for-lol/packages/backend/src/testing",
  },
  {
    id: "skew-05-#17743",
    kind: "skew",
    prLabel: "PR #4799 (coach eval scenarios)",
    mainLabel: "PR #4719 (coach post-game review)",
    prFiles: [
      added(
        "packages/scout-for-lol/packages/backend/src/explore/scenarios/coach-turn.ts",
      ),
    ],
    mainFiles: [
      modified(
        "packages/scout-for-lol/packages/backend/src/coach/app-turns.ts",
      ),
    ],
    expectedReasonSubstring: "@scout-for-lol/backend",
  },
  {
    id: "skew-06-#17905",
    kind: "skew",
    prLabel: "PR #4809 (ci toolchain.sh)",
    mainLabel: "PR #4803 (ci apt-https.test.sh)",
    prFiles: [modified("ci/scripts/toolchain.sh")],
    mainFiles: [added("ci/scripts/apt-https.test.sh")],
    expectedReasonSubstring: "ci/scripts/apt-https.test.sh",
  },
  {
    id: "skew-07-#18064",
    kind: "skew",
    prLabel: "PR #4823 (add flags workspace)",
    mainLabel: "PR #4818 (Bump Bun 1.4.5 lockfile)",
    prFiles: [
      added("packages/flags/package.json"),
      modified("package.json"),
      modified("bun.lock"),
    ],
    mainFiles: [modified(".mise.toml"), modified("bun.lock")],
    expectedReasonSubstring: "bun.lock",
  },
  {
    id: "skew-08-#18714",
    kind: "skew",
    prLabel: "PR #5026 (temporal status-server)",
    mainLabel: "PR #5019 (eslint-plugin-unicorn 78)",
    prFiles: [modified("packages/temporal/src/status-server.ts")],
    mainFiles: [
      modified("bun.lock"),
      modified(
        "packages/alert-dashboard/src/client/ops/pages/cluster-page.tsx",
      ),
    ],
    expectedReasonSubstring: "bun.lock",
  },
  {
    id: "skew-09-#18767",
    kind: "skew",
    prLabel: "PR #5001 (media fixtures 26/25)",
    mainLabel: "PR #5000 (media fixtures)",
    prFiles: [
      added(
        "packages/media/src/testing/fixture-api/fixtures/subtitle-replacement.ts",
      ),
    ],
    mainFiles: [
      added("packages/media/src/testing/fixture-api/fixtures/plex-history.ts"),
    ],
    expectedReasonSubstring: "packages/media/src/testing/fixture-api/fixtures",
  },
  {
    id: "skew-10-#18870",
    kind: "skew",
    prLabel: "PR #4775 (renovate mirrored pins)",
    mainLabel: "PR #4850 + #5017 (mc-harness pins + catalog)",
    prFiles: [
      added("scripts/checks/deps/renovate-config.ts"),
      modified("packages/version-catalog/src/catalog.json"),
    ],
    mainFiles: [
      modified("packages/mc-harness/src/pins.ts"),
      modified(
        "packages/delivery/registrations/v2/argocd/prod/configuration.json",
      ),
    ],
    expectedReasonSubstring: "@shepherdjerred/root-scripts",
  },
  {
    id: "disjoint-01-#17232",
    kind: "disjoint",
    prLabel: "PR #4663 (toolkit tend)",
    mainLabel: "PR #4660 (scout backend)",
    prFiles: [modified("packages/toolkit/src/commands/tend.ts")],
    mainFiles: [
      modified("packages/scout-for-lol/packages/backend/src/index.ts"),
    ],
  },
  {
    id: "disjoint-02-#18845",
    kind: "disjoint",
    prLabel: "PR #5002 (media file recovery)",
    mainLabel: "PR #5004 (tracker client)",
    prFiles: [modified("packages/media/src/client/recovery.tsx")],
    mainFiles: [modified("packages/tracker/src/client/issue-list.tsx")],
  },
  {
    id: "disjoint-03-#18915",
    kind: "disjoint",
    prLabel: "PR #5033 (alert-dashboard UI)",
    mainLabel: "PR #5031 (streambot room sync)",
    prFiles: [modified("packages/alert-dashboard/src/client/app.tsx")],
    mainFiles: [modified("packages/streambot/src/room.ts")],
  },
  {
    id: "disjoint-04",
    kind: "disjoint",
    prLabel: "toolkit PR commands",
    mainLabel: "glitter-boys-launcher Rust crate",
    prFiles: [modified("packages/toolkit/src/commands/pr/land.ts")],
    mainFiles: [modified("packages/glitter-boys-launcher/src/main.rs")],
  },
  {
    id: "disjoint-05",
    kind: "disjoint",
    prLabel: "tasknotes-server sync",
    mainLabel: "birmel discord agent",
    prFiles: [modified("packages/tasknotes-server/src/server.ts")],
    mainFiles: [modified("packages/birmel/src/index.ts")],
  },
  {
    id: "disjoint-06",
    kind: "disjoint",
    prLabel: "justin-principal-engineer reconcile",
    mainLabel: "golink domain resolver",
    prFiles: [modified("packages/justin-principal-engineer/src/reconcile.ts")],
    mainFiles: [modified("packages/golink/src/domain/resolver.ts")],
  },
  {
    id: "disjoint-07",
    kind: "disjoint",
    prLabel: "release-tools semver helper",
    mainLabel: "@homelab/cdk8s chart (via root-scripts bridge guard)",
    prFiles: [modified("packages/release-tools/src/index.ts")],
    mainFiles: [
      modified("packages/homelab/src/cdk8s/src/cdk8s-charts/redlib.ts"),
    ],
  },
  {
    id: "disjoint-08",
    kind: "disjoint",
    prLabel: "scout desktop client",
    mainLabel: "docs wiki how-to",
    prFiles: [modified("packages/scout-for-lol/packages/desktop/src/main.ts")],
    mainFiles: [
      modified("packages/docs/wiki/src/content/docs/how-to/index.md"),
    ],
  },
  {
    id: "disjoint-09",
    kind: "disjoint",
    prLabel: "dotfiles shell config",
    mainLabel: "errors console UI",
    prFiles: [modified("packages/dotfiles/dot_config/fish/config.fish")],
    mainFiles: [modified("packages/errors/src/index.ts")],
  },
  {
    id: "disjoint-10",
    kind: "disjoint",
    prLabel: "woodpecker-config-extension lane",
    mainLabel: "toolkit history search",
    prFiles: [
      modified("packages/woodpecker-config-extension/src/pipeline/emit.ts"),
    ],
    mainFiles: [modified("packages/toolkit/src/lib/history/search.ts")],
  },
];

let sharedGraph: WorkspaceGraph | undefined;
async function repoGraph(): Promise<WorkspaceGraph> {
  sharedGraph ??= await loadWorkspaceGraph();
  return sharedGraph;
}

const tempDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("computeStaleBaseOverlap", () => {
  test("replays all 10 historical 14-day skew incidents (100% recall) and 10 disjoint pairs (0% false positives)", async () => {
    const graph = await repoGraph();
    const skewCases = HISTORICAL_REPLAY_CASES.filter(
      (item) => item.kind === "skew",
    );
    const disjointCases = HISTORICAL_REPLAY_CASES.filter(
      (item) => item.kind === "disjoint",
    );
    expect(skewCases).toHaveLength(10);
    expect(disjointCases).toHaveLength(10);

    for (const item of skewCases) {
      const report = computeStaleBaseOverlap({
        headSha: HEAD_SHA,
        mergeBaseSha: BASE_SHA,
        mainHeadSha: MAIN_SHA,
        behindBy: 4,
        compareStatus: "diverged",
        prFiles: item.prFiles,
        mainFiles: item.mainFiles,
        graph,
      });
      expect(report.stale, item.id).toBe(true);
      expect(report.verdict, item.id).toBe("stale_overlap");
      if (item.expectedReasonSubstring !== undefined) {
        expect(report.reasons.join("\n"), item.id).toContain(
          item.expectedReasonSubstring,
        );
      }
    }

    for (const item of disjointCases) {
      const report = computeStaleBaseOverlap({
        headSha: HEAD_SHA,
        mergeBaseSha: BASE_SHA,
        mainHeadSha: MAIN_SHA,
        behindBy: 4,
        compareStatus: "diverged",
        prFiles: item.prFiles,
        mainFiles: item.mainFiles,
        graph,
      });
      expect(report.stale, item.id).toBe(false);
      expect(report.verdict, item.id).toBe("disjoint_clean");
      expect(report.reasons, item.id).toEqual([]);
    }
  });
});

describe("computeStaleBaseOverlap edge cases", () => {
  test("avoids @homelab/cdk8s hub collision through @shepherdjerred/root-scripts while catching genuine transitive deps", async () => {
    // Synthetic graph mirroring the @homelab/cdk8s -> @shepherdjerred/root-scripts
    // hub: both `packages/toolkit` and `packages/scout-for-lol/packages/domain`
    // feed `@shepherdjerred/root-scripts`, which feeds `@homelab/cdk8s`.
    const syntheticHubGraph = buildWorkspaceGraph("/repo", [
      {
        name: "@shepherdjerred/toolkit",
        dir: "packages/toolkit",
        workspaceDependencies: [],
      },
      {
        name: "@scout-for-lol/domain",
        dir: "packages/scout-for-lol/packages/domain",
        workspaceDependencies: [],
      },
      {
        name: "@shepherdjerred/root-scripts",
        dir: "scripts",
        workspaceDependencies: [
          "@shepherdjerred/toolkit",
          "@scout-for-lol/domain",
        ],
      },
      {
        name: "@homelab/cdk8s",
        dir: "packages/homelab/src/cdk8s",
        workspaceDependencies: ["@shepherdjerred/root-scripts"],
      },
    ]);

    const nonColliding = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 2,
      compareStatus: "diverged",
      prFiles: [modified("packages/toolkit/src/commands/pr/land.ts")],
      mainFiles: [
        modified("packages/scout-for-lol/packages/domain/src/rank.ts"),
      ],
      graph: syntheticHubGraph,
    });
    expect(nonColliding.stale).toBe(false);
    expect(nonColliding.verdict).toBe("disjoint_clean");

    // Even when main directly edits @homelab/cdk8s, a leaf feeding root-scripts
    // does NOT collide unless scripts/** or ROOT_SCRIPTS_EXTERNAL_INPUTS changed.
    const rootScriptsBridgeBlocked = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 2,
      compareStatus: "diverged",
      prFiles: [modified("packages/scout-for-lol/packages/domain/src/rank.ts")],
      mainFiles: [modified("packages/homelab/src/cdk8s/src/app.ts")],
      graph: syntheticHubGraph,
    });
    expect(rootScriptsBridgeBlocked.stale).toBe(false);
    expect(rootScriptsBridgeBlocked.verdict).toBe("disjoint_clean");

    // In the real monorepo graph, toolkit -> @scout-for-lol/data -> @scout-for-lol/domain
    // IS a declared 2-hop dependency, so asymmetric closure catches it!
    const realGraph = await repoGraph();
    const realTransitive = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 2,
      compareStatus: "diverged",
      prFiles: [modified("packages/toolkit/src/commands/pr/land.ts")],
      mainFiles: [
        modified("packages/scout-for-lol/packages/domain/src/index.ts"),
      ],
      graph: realGraph,
    });
    expect(realTransitive.stale).toBe(true);
    expect(realTransitive.verdict).toBe("stale_overlap");
    expect(realTransitive.reasons.join("\n")).toContain(
      "@shepherdjerred/toolkit",
    );
  });

  test("catches undeclared cross-workspace edges (ts-mc-docs -> storm-theme and toolkit -> temporal)", async () => {
    const graph = await repoGraph();
    const docsTheme = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 1,
      prFiles: [modified("packages/ts-mc-docs/src/content/docs/guide.mdx")],
      mainFiles: [modified("packages/storm-theme/src/index.ts")],
      graph,
    });
    expect(docsTheme.stale).toBe(true);
    expect(docsTheme.reasons.join("\n")).toContain(
      "@shepherdjerred/storm-theme",
    );

    const toolkitTemporal = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 1,
      prFiles: [modified("packages/temporal/src/worker.ts")],
      mainFiles: [modified("packages/toolkit/src/index.ts")],
      graph,
    });
    expect(toolkitTemporal.stale).toBe(true);
    expect(toolkitTemporal.reasons.join("\n")).toContain(
      "@shepherdjerred/temporal",
    );
  });

  test("catches shared synthesis group touches and same-directory renames/additions", async () => {
    const graph = await repoGraph();
    const synthesis = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 3,
      prFiles: [modified("packages/feature-flags/src/deployments.ts")],
      mainFiles: [
        modified("packages/delivery/registrations/v2/scout/prod/recipe.json"),
      ],
      graph,
    });
    expect(synthesis.stale).toBe(true);
    expect(synthesis.reasons.join("\n")).toContain("synthesis inputs");

    const sameDirRename = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 1,
      prFiles: [added("packages/tracker/src/client/new-a.ts")],
      mainFiles: [
        {
          filename: "packages/tracker/src/client/new-b.ts",
          previous_filename: "packages/tracker/src/legacy/old-b.ts",
          status: "renamed",
        },
      ],
      graph,
    });
    expect(sameDirRename.stale).toBe(true);
    expect(sameDirRename.reasons.join("\n")).toContain(
      "packages/tracker/src/client",
    );
  });

  test("fails closed when PR files, main compare files, or total_commits hit GitHub truncation limits", async () => {
    const graph = await repoGraph();
    const manyFiles = Array.from({ length: 300 }, (_, index) =>
      modified(`packages/media/src/file-${String(index)}.ts`),
    );
    const prTruncated = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 1,
      prFiles: manyFiles,
      mainFiles: [modified("packages/tracker/src/index.ts")],
      graph,
    });
    expect(prTruncated.stale).toBe(true);
    expect(prTruncated.reasons[0]).toContain("300 files");

    const commitsTruncated = computeStaleBaseOverlap({
      headSha: HEAD_SHA,
      mergeBaseSha: BASE_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 251,
      totalCommits: 251,
      prFiles: [modified("packages/media/src/index.ts")],
      mainFiles: [modified("packages/tracker/src/index.ts")],
      graph,
    });
    expect(commitsTruncated.stale).toBe(true);
    expect(commitsTruncated.reasons[0]).toContain("251 commits");
  });
});

describe("evaluateStaleBase over GitHub REST", () => {
  test("returns up_to_date without fetching PR files when ahead_by === 0 (even when behind_by > 0)", async () => {
    const fetchMock = vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (url.pathname.includes("/compare/")) {
        return Response.json({
          status: "behind",
          ahead_by: 0,
          behind_by: 2,
          total_commits: 2,
          base_commit: { sha: HEAD_SHA },
          merge_base_commit: { sha: MAIN_SHA },
          commits: [],
          files: [],
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await evaluateStaleBase({
      github: new GitHubClient("test-token"),
      prNumber: 42,
      headSha: HEAD_SHA,
    });
    expect(report).toEqual({
      stale: false,
      headSha: HEAD_SHA,
      mergeBaseSha: MAIN_SHA,
      mainHeadSha: MAIN_SHA,
      behindBy: 0,
      verdict: "up_to_date",
      reasons: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(formatStaleBaseLine(report)).toContain("Up to date with main");
  });

  test("allows status === 'diverged' when PR and main changes are disjoint across paginated PR files", async () => {
    const graph = await repoGraph();
    const page1 = Array.from({ length: 100 }, (_, index) =>
      modified(`packages/media/src/part-${String(index)}.ts`),
    );
    const page2 = [modified("packages/media/src/final.ts")];
    const fetchMock = vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (url.pathname.includes("/compare/")) {
        return Response.json({
          status: "diverged",
          ahead_by: 3,
          behind_by: 2,
          total_commits: 3,
          base_commit: { sha: HEAD_SHA },
          merge_base_commit: { sha: BASE_SHA },
          commits: [{ sha: MAIN_SHA }],
          files: [modified("packages/tracker/src/index.ts")],
        });
      }
      if (url.pathname.endsWith("/pulls/42/files")) {
        const page = url.searchParams.get("page");
        return Response.json(page === "1" ? page1 : page2);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await evaluateStaleBase({
      github: new GitHubClient("test-token"),
      prNumber: 42,
      headSha: HEAD_SHA,
      graph,
    });
    expect(report.stale).toBe(false);
    expect(report.verdict).toBe("disjoint_clean");
    expect(report.behindBy).toBe(3);
    expect(report.mainHeadSha).toBe(MAIN_SHA);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(formatStaleBaseLine(report)).toContain(
      "disjoint from main advances",
    );
  });
});

describe("appendPrLandReceipt", () => {
  test("writes sanitized NDJSON to isolated TOOLKIT_STATE_DIR and never throws on read-only directories", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-receipts-"));
    tempDirs.push(stateDir);
    const secret = "super-secret-token-value";

    await appendPrLandReceipt({
      pr: 512,
      report: {
        stale: true,
        headSha: HEAD_SHA,
        mergeBaseSha: BASE_SHA,
        mainHeadSha: MAIN_SHA,
        behindBy: 2,
        verdict: "stale_overlap",
        reasons: [`overlap involving ${secret}`],
      },
      bypassed: false,
      secrets: [secret],
      environment: { TOOLKIT_STATE_DIR: stateDir },
      now: () => new Date("2026-11-26T18:00:00.000Z"),
    });

    const receiptFile = prLandReceiptPath({ TOOLKIT_STATE_DIR: stateDir });
    const raw = await Bun.file(receiptFile).text();
    expect(raw).not.toContain(secret);
    const parsed = PrLandReceiptSchema.parse(JSON.parse(raw.trim()));
    expect(parsed).toMatchObject({
      timestamp: "2026-11-26T18:00:00.000Z",
      pr: 512,
      behindBy: 2,
      verdict: "stale_overlap",
      bypassed: false,
    });

    const readOnlyParent = await mkdtemp(path.join(os.tmpdir(), "toolkit-ro-"));
    tempDirs.push(readOnlyParent);
    await chmod(readOnlyParent, 0o500);
    try {
      await expect(
        appendPrLandReceipt({
          pr: 513,
          report: {
            stale: false,
            headSha: HEAD_SHA,
            mergeBaseSha: BASE_SHA,
            mainHeadSha: BASE_SHA,
            behindBy: 0,
            verdict: "up_to_date",
            reasons: [],
          },
          bypassed: false,
          stateDir: path.join(readOnlyParent, "nested"),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await chmod(readOnlyParent, 0o700);
    }
  });
});
