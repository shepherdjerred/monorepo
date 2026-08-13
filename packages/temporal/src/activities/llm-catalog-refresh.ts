import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { buildCatalogWithheldAlert } from "#shared/llm-catalog-alert.ts";
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
  overlayOnly: z.array(z.string()),
  notChecked: z.array(z.string()),
});

export type LlmCatalogRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  /** Edits the plausibility guards withheld — each needs a human to adjudicate. */
  withheld: string[];
  outcome: "pr-created" | "no-diff" | "withheld-only";
};

async function postWithheldAlert(withheld: string[]): Promise<void> {
  const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
  if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
    throw new Error(
      "ALERTMANAGER_URL is required to report withheld LLM catalog edits",
    );
  }
  await createAlertmanagerPoster(alertmanagerUrl)([
    buildCatalogWithheldAlert(withheld, new Date()),
  ]);
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

      const noDiff = async (): Promise<LlmCatalogRefreshResult> => {
        const base = {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          withheld: summary.withheld,
        };
        if (summary.withheld.length === 0) {
          return { ...base, outcome: "no-diff" };
        }
        // Withheld-only: the guards found real drift and refused to apply it,
        // so there is no diff to PR and this run would otherwise be
        // indistinguishable from a clean no-op. Page a human instead.
        await postWithheldAlert(summary.withheld);
        return { ...base, outcome: "withheld-only" };
      };

      // trimStdout: false so porcelain v1's leading-space status code isn't
      // stripped (see parsePorcelainPaths in #shared/porcelain.ts).
      const dirty = parsePorcelainPaths(
        await runCommand(["git", "status", "--porcelain", "--", CATALOG_FILE], {
          cwd: repoDir,
          trimStdout: false,
        }),
      );
      if (dirty.length === 0) {
        return await noDiff();
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
        return await noDiff();
      }

      const branch = `chore/llm-catalog-refresh-${id.slice(0, 8)}`;
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

      return {
        changedFiles: files,
        branchName: branch,
        commitHash,
        prUrl,
        withheld: summary.withheld,
        outcome: "pr-created",
      };
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
