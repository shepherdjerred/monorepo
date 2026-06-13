import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";
import {
  changedFilesInPaths,
  openSeasonRefreshPr,
} from "./scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const CDK8S_ROOT = "packages/homelab/src/cdk8s";
const HELM_TYPES_ROOT = "packages/homelab/src/helm-types";
const ESLINT_CONFIG_ROOT = "packages/eslint-config";
// The ONLY path this job is allowed to stage. HA/Prisma generated output is
// private and gitignored (packages/home-assistant/AGENTS.md) — never committed.
const GENERATED_PATH = `${CDK8S_ROOT}/generated/helm`;

export type HelmTypesRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "pr-created" | "no-diff";
};

export type HelmTypesRefreshActivities = typeof helmTypesRefreshActivities;

export const helmTypesRefreshActivities = {
  /**
   * Regenerate the committed Helm value types from the live charts and, if they
   * drifted, open a PR. Deterministic (no agent). Driven entirely by the chart
   * versions pinned in versions.ts, so a clean run with no chart changes opens
   * no PR.
   */
  async refreshHelmTypes(): Promise<HelmTypesRefreshResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/helm-types-refresh-${id}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the long subprocesses (clone, bun install, the
    // multi-chart `helm pull` regeneration) run. Pairs with the activity's
    // heartbeatTimeout in workflows/helm-types-refresh.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshHelmTypes",
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
        "--depth",
        "1",
      ]);

      // Build only what the generator needs, then regenerate ONLY helm types.
      // Deliberately NOT `scripts/setup.ts` — that also runs HA/Prisma codegen,
      // whose private output must never be committed.
      await runCommand(["bun", "install", "--frozen-lockfile"], {
        cwd: repoDir,
      });
      await runCommand(["bun", "run", "build"], {
        cwd: `${repoDir}/${ESLINT_CONFIG_ROOT}`,
      });
      await runCommand(["bun", "run", "build"], {
        cwd: `${repoDir}/${HELM_TYPES_ROOT}`,
      });
      // `generate-helm-types` fails the run if any chart can't be fetched, so a
      // transient network blip surfaces as an activity failure (and Temporal
      // retry) rather than a destructive partial tree.
      await runCommand(["bun", "run", "generate-helm-types"], {
        cwd: `${repoDir}/${CDK8S_ROOT}`,
      });
      // Normalize with the REPO's prettier. The generator's bundled prettier
      // wraps differently, so without this every run produces formatting-only
      // churn and a spurious weekly PR.
      await runCommand(["bunx", "prettier", "--write", "generated/helm/"], {
        cwd: `${repoDir}/${CDK8S_ROOT}`,
      });

      const files = await changedFilesInPaths(repoDir, [GENERATED_PATH]);
      if (files.length === 0) {
        return {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "no-diff",
        };
      }

      const branch = `chore/helm-types-refresh-${id.slice(0, 8)}`;
      const title = "chore(homelab): refresh generated Helm value types";
      const body = [
        "Automated Helm value-type refresh from Temporal.",
        "",
        "Regenerated `packages/homelab/src/cdk8s/generated/helm` from the chart",
        "versions pinned in `versions.ts`. The committed types had drifted from",
        "the upstream charts.",
        "",
        `Changed files: ${String(files.length)}`,
        "",
        ...files.slice(0, 30).map((f) => `- ${f}`),
        files.length > 30 ? `- …and ${String(files.length - 30)} more` : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

      const { commitHash, prUrl } = await openSeasonRefreshPr({
        repoDir,
        tempDir,
        branch,
        title,
        body,
        files: [GENERATED_PATH],
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
