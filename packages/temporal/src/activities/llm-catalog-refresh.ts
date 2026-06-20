import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";
import { openSeasonRefreshPr } from "./scout-season-refresh-git.ts";
import { parsePorcelainPaths } from "./readme-refresh.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const CATALOG_FILE = "packages/llm-models/src/catalog.json";

export type LlmCatalogRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "pr-created" | "no-diff";
};

export type LlmCatalogRefreshActivities = typeof llmCatalogRefreshActivities;

export const llmCatalogRefreshActivities = {
  /**
   * Run the deterministic catalog cross-check (packages/llm-models/scripts/
   * sync-from-upstreams.ts) against models.dev + LiteLLM and, if our pricing /
   * context drifted, open a PR. No LLM, no scraping. Mirrors readme-refresh.
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
      const report = await runCommand(
        ["bun", "run", "scripts/sync-from-upstreams.ts"],
        { cwd: catalogDir },
      );

      const noDiff: LlmCatalogRefreshResult = {
        changedFiles: [],
        branchName: undefined,
        commitHash: undefined,
        prUrl: undefined,
        outcome: "no-diff",
      };

      // trimStdout: false so porcelain v1's leading-space status code isn't
      // stripped (see parsePorcelainPaths in readme-refresh.ts).
      const dirty = parsePorcelainPaths(
        await runCommand(["git", "status", "--porcelain", "--", CATALOG_FILE], {
          cwd: repoDir,
          trimStdout: false,
        }),
      );
      if (dirty.length === 0) {
        return noDiff;
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
        return noDiff;
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
