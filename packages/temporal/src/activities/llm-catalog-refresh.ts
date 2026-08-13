import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  buildCatalogAlerts,
  type CatalogSyncOutcome,
} from "#shared/llm-catalog-alert.ts";
import { parsePorcelainPaths } from "#shared/porcelain.ts";
import { runCommand } from "./data-dragon-shell.ts";
import { openSeasonRefreshPr } from "./scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const CATALOG_FILE = "packages/llm-models/src/catalog.json";

/** Mirrors `SyncReport` in packages/llm-models/scripts/sync-from-upstreams.ts. */
const SyncReportSchema = z.object({
  applied: z.array(z.string()),
  withheld: z.array(z.string()),
  withheldByModel: z.record(z.string(), z.array(z.string())),
  measured: z.array(z.string()),
  overlayOnly: z.array(z.string()),
  notChecked: z.array(z.string()),
});

/**
 * Retry-stable branch name for the refresh PR.
 *
 * `openSeasonRefreshPr` avoids duplicate PRs by reusing an open PR whose head
 * is this branch, so the branch is the idempotency key for the whole
 * PR-creating half of this activity — it must never be derived from anything
 * that varies per attempt. A per-attempt UUID silently defeats that reuse: any
 * failure after the PR is created (the Alertmanager publish, a worker death
 * before Temporal records completion) retries the activity under a fresh
 * branch and opens a second catalog PR.
 *
 * The workflow run id is constant across every attempt and distinct for each
 * scheduled run, which is exactly the lifetime one proposal PR should have.
 */
export function catalogRefreshBranch(workflowRunId: string): string {
  return `chore/llm-catalog-refresh-${workflowRunId.slice(0, 8)}`;
}

export type LlmCatalogRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  /** Edits the plausibility guards withheld — each needs a human to adjudicate. */
  withheld: string[];
  outcome: "pr-created" | "no-diff" | "withheld-only";
};

/**
 * Publish this run's withheld state — firing while edits await adjudication,
 * resolving as soon as a run finds none. Which of the two it is depends on the
 * report alone, never on whether the catalog changed: conditioning the resolve
 * on the diff would leave an already-remediated alert firing for its full
 * eight-day lifetime.
 *
 * Every `return` publishes exactly once, and only once its own `prUrl` is
 * settled. Publishing earlier from a single site would be more obviously
 * unskippable, but it can only name a PR it has not yet opened, and a failure
 * in the steps between would strand an eight-day alert pointing at nothing.
 * A run that dies before any exit publishes nothing and fails the activity,
 * which `temporal-failure-watch` turns into its own occurrence.
 */
async function publishWithheldAlerts(
  outcome: CatalogSyncOutcome,
): Promise<void> {
  // One occurrence per model the run actually measured. A model missing from
  // both upstreams gets none, so its previous occurrence stands rather than
  // being closed on absent evidence — and, unlike a run-wide gate, it cannot
  // hold every other model's resolution hostage while it sits there.
  const alerts = buildCatalogAlerts(outcome, new Date());
  if (alerts.length === 0) {
    return;
  }
  const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
  if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
    throw new Error(
      "ALERTMANAGER_URL is required to report withheld LLM catalog edits",
    );
  }
  await createAlertmanagerPoster(alertmanagerUrl)(alerts);
}

export type LlmCatalogRefreshActivities = typeof llmCatalogRefreshActivities;

export const llmCatalogRefreshActivities = {
  /**
   * Run the deterministic catalog cross-check (packages/llm-models/scripts/
   * sync-from-upstreams.ts) against models.dev + LiteLLM and, if our pricing /
   * context drifted, open a PR. No LLM, no scraping.
   */
  async refreshLlmCatalog(): Promise<LlmCatalogRefreshResult> {
    const start = Date.now();
    // Scratch directory only. Deliberately per-attempt so a retry cannot trip
    // over a previous attempt's half-cleaned clone — never reuse it for the
    // branch name, which must be stable across attempts (catalogRefreshBranch).
    const id = crypto.randomUUID();
    const tempDir = `/tmp/llm-catalog-refresh-${id}`;
    const repoDir = `${tempDir}/monorepo`;
    const catalogDir = `${repoDir}/packages/llm-models`;

    // Heartbeat every 10s while the long subprocesses (clone, install, sync) run;
    // pairs with the activity's heartbeatTimeout in workflows/llm-catalog-refresh.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshLlmCatalog",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const { token: githubToken } = await createGitHubAppInstallationToken();
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--filter=blob:none",
      ]);

      // Install the catalog package's deps (zod) so the sync script can import
      // the package, then run it (fetches models.dev + LiteLLM and rewrites
      // catalog.json on drift). Capture its report for the PR body.
      await runCommand(["bun", "install", "--frozen-lockfile"], {
        cwd: catalogDir,
      });
      const reportJsonPath = `${tempDir}/sync-report.json`;
      const report = await runCommand(
        [
          "bun",
          "run",
          "scripts/sync-from-upstreams.ts",
          "--report-json",
          reportJsonPath,
        ],
        { cwd: catalogDir },
      );
      const summary = SyncReportSchema.parse(
        await Bun.file(reportJsonPath).json(),
      );
      // Every exit goes through here. A withheld edit never reaches the
      // catalog, so a run whose edits were all refused is otherwise
      // indistinguishable from a clean no-op.
      const finish = async (
        result: LlmCatalogRefreshResult,
      ): Promise<LlmCatalogRefreshResult> => {
        await publishWithheldAlerts({
          applied: summary.applied,
          measured: summary.measured,
          withheldByModel: summary.withheldByModel,
          prUrl: result.prUrl,
        });
        return result;
      };

      const noDiff = (): LlmCatalogRefreshResult => ({
        changedFiles: [],
        branchName: undefined,
        commitHash: undefined,
        prUrl: undefined,
        withheld: summary.withheld,
        outcome: summary.withheld.length === 0 ? "no-diff" : "withheld-only",
      });

      // trimStdout: false so porcelain v1's leading-space status code isn't
      // stripped (see parsePorcelainPaths in #shared/porcelain.ts).
      const dirty = parsePorcelainPaths(
        await runCommand(["git", "status", "--porcelain", "--", CATALOG_FILE], {
          cwd: repoDir,
          trimStdout: false,
        }),
      );
      if (dirty.length === 0) {
        return await finish(noDiff());
      }

      // Format the rewritten JSON with the repo's pinned prettier so the PR
      // passes the prettier gate (the sync writes plain JSON.stringify output).
      await runCommand(["bun", "install", "--frozen-lockfile"], {
        cwd: repoDir,
      });
      await runCommand(["bunx", "prettier", "--write", CATALOG_FILE], {
        cwd: repoDir,
      });

      const files = parsePorcelainPaths(
        await runCommand(["git", "status", "--porcelain", "--", CATALOG_FILE], {
          cwd: repoDir,
          trimStdout: false,
        }),
      );
      if (files.length === 0) {
        return await finish(noDiff());
      }

      // Optional in the SDK only because an activity can be invoked outside a
      // workflow; this one always runs from `runLlmCatalogRefresh`. Falling
      // back to a generated id here would quietly restore the duplicate-PR bug
      // the run id exists to prevent, so treat absence as the contract
      // violation it is.
      const { workflowExecution } = Context.current().info;
      if (workflowExecution === undefined) {
        throw new Error(
          "refreshLlmCatalog must be scheduled by a workflow: the run id is the refresh PR's idempotency key",
        );
      }
      const branch = catalogRefreshBranch(workflowExecution.runId);
      const title =
        "chore(llm-models): refresh model catalog pricing from upstreams";
      const body = [
        "Automated LLM model-catalog cross-check from Temporal",
        "(`llm-catalog-refresh-weekly` schedule).",
        "",
        "`packages/llm-models/scripts/sync-from-upstreams.ts` compared our catalog",
        "against models.dev + LiteLLM and applied input/output/context drift.",
        "Review the numbers below against the official provider pricing pages.",
        "",
        "```",
        report.trim(),
        "```",
      ].join("\n");

      const { commitHash, prUrl } = await openSeasonRefreshPr({
        repoDir,
        tempDir,
        branch,
        title,
        body,
        files,
        ghToken: githubToken,
        repoSlug: REPO_SLUG,
        mainBranch: MAIN_BRANCH,
      });

      return await finish({
        changedFiles: files,
        branchName: branch,
        commitHash,
        prUrl,
        withheld: summary.withheld,
        outcome: "pr-created",
      });
    } finally {
      clearInterval(heartbeat);
      try {
        await runCommand(["rm", "-rf", tempDir], { cwd: "/tmp" });
      } catch {
        // best-effort cleanup
      }
    }
  },
};
