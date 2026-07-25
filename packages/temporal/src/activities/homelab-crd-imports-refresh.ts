import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";
import { rootInstallWithoutHooks } from "./bot-clone.ts";
import {
  changedFilesInPaths,
  openSeasonRefreshPr,
} from "./scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const CDK8S_ROOT = "packages/homelab/src/cdk8s";
// The ONLY path this job is allowed to stage. CRD-import drift is
// time-coupled (operator chart bumps land via Renovate + ArgoCD sync, no
// repo PR touches the generator), which is why this is a schedule and not a
// CI gate — CI can't see the cluster change.
const GENERATED_PATH = `${CDK8S_ROOT}/generated/imports`;

export type HomelabCrdImportsRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "pr-created" | "no-diff";
};

export type HomelabCrdImportsRefreshActivities =
  typeof homelabCrdImportsRefreshActivities;

export const homelabCrdImportsRefreshActivities = {
  /**
   * Regenerate the committed cdk8s CRD imports (`generated/imports/`) from the
   * live cluster's CRDs + cdk8s-cli's pinned k8s schema and, if they drifted,
   * open a PR. Deterministic (no agent). Runs `bun run update-imports` in the
   * cdk8s package: `cdk8s import k8s` (network) and `kubectl get crds | cdk8s
   * import /dev/stdin` — kubectl resolves the in-cluster service account
   * (RBAC: the temporal-worker-crd-reader ClusterRole), and the `cdk8s` bin
   * comes from the clone's cdk8s-cli devDependency via `bun run`'s PATH.
   */
  async refreshHomelabCrdImports(): Promise<HomelabCrdImportsRefreshResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/crd-imports-refresh-${id}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the long subprocesses (clone, bun install,
    // the two cdk8s imports) run. Pairs with the activity's heartbeatTimeout
    // in workflows/homelab-crd-imports-refresh.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshHomelabCrdImports",
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

      // Hook-free root install only — update-imports needs nothing built,
      // just the cdk8s-cli bin from the workspace install.
      await rootInstallWithoutHooks(repoDir);
      await runCommand(["bun", "run", "update-imports"], {
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

      const branch = `chore/crd-imports-refresh-${id.slice(0, 8)}`;
      const title = "chore(homelab): refresh generated cdk8s CRD imports";
      const body = [
        "Automated cdk8s CRD-import refresh from Temporal",
        "(`homelab-crd-imports-daily`).",
        "",
        "Regenerated `packages/homelab/src/cdk8s/generated/imports` from the",
        "live cluster's CRDs and cdk8s-cli's pinned k8s schema. The committed",
        "imports had drifted (usually an operator chart bump that ArgoCD",
        "synced after a Renovate merge).",
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
