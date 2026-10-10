import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  findOpenGeneratedPrUrl,
  getPrRevisionState,
} from "#activities/data-dragon/data-dragon-pr.ts";
import {
  isDataDragonPrAuthor,
  type OpenPrCandidate,
} from "#shared/data-dragon-util.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import { rootInstallWithoutHooks } from "#activities/bot-clone.ts";
import { discardFormattingOnlyChanges } from "#activities/scout/scout-generated-preflight.ts";
import {
  changedFilesInPaths,
  openSeasonRefreshPr,
} from "#activities/scout/scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const CDK8S_ROOT = "packages/homelab/src/cdk8s";
// The ONLY path this job is allowed to stage. CRD-import drift is
// time-coupled (operator chart bumps land via Renovate + ArgoCD sync, no
// repo PR touches the generator), which is why this is a schedule and not a
// CI gate — CI can't see the cluster change.
const GENERATED_PATH = `${CDK8S_ROOT}/generated/imports`;
const TITLE = "chore(homelab): refresh generated cdk8s CRD imports";

export function isCrdImportsRefreshPr(
  pr: OpenPrCandidate,
  appSlug: string,
): boolean {
  return (
    pr.title === TITLE &&
    pr.baseRefName === MAIN_BRANCH &&
    !pr.isCrossRepository &&
    isDataDragonPrAuthor(pr.author, appSlug) &&
    /^chore\/crd-imports-refresh(?:-[0-9a-f]{8})?$/.test(pr.headRefName)
  );
}

export async function findCrdImportsRefreshBranch(
  token: string,
): Promise<string> {
  // Reuse the newest authenticated legacy proposal during migration, then use
  // one stable branch. UUIDs isolate clone attempts, never proposal identity.
  const existing = await findOpenGeneratedPrUrl({
    repoSlug: REPO_SLUG,
    token,
    filterArgs: ["--limit", "100"],
    matches: isCrdImportsRefreshPr,
  });
  if (existing === undefined) {
    const branch = "chore/crd-imports-refresh";
    const occupied = await findOpenGeneratedPrUrl({
      repoSlug: REPO_SLUG,
      token,
      filterArgs: ["--head", branch],
      matches: () => true,
    });
    if (occupied !== undefined) {
      throw new Error(
        `Refusing to reuse ${branch}: open proposal ${occupied} failed the CRD proposal identity check; preserve its content and metadata for operator review`,
      );
    }
    return branch;
  }
  const revision = await getPrRevisionState({
    repoSlug: REPO_SLUG,
    prUrl: existing,
    token,
  });
  return revision.headRefName;
}

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
      const branch = await findCrdImportsRefreshBranch(githubToken);
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

      let files = await changedFilesInPaths(repoDir, [GENERATED_PATH]);
      await discardFormattingOnlyChanges({
        repoDir,
        changedFiles: files,
        component: "homelab-crd-imports-refresh",
      });
      files = await changedFilesInPaths(repoDir, [GENERATED_PATH]);
      if (files.length === 0) {
        return {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "no-diff",
        };
      }

      const title = TITLE;
      const body = [
        "## Why",
        "Keep cdk8s bindings aligned with CRDs deployed in the homelab.",
        "",
        "## What",
        "Regenerated `packages/homelab/src/cdk8s/generated/imports` from the",
        "live cluster's CRDs and cdk8s-cli's pinned k8s schema. The committed",
        "imports had drifted (usually an operator chart bump that ArgoCD",
        "synced after a Renovate merge).",
        "",
        `Changed files: ${String(files.length)}`,
        "",
        ...files.slice(0, 30).map((f) => `- ${f}`),
        files.length > 30 ? `- …and ${String(files.length - 30)} more` : "",
        "",
        "## Verification",
        "Ran the pinned import generator against the live cluster and discarded formatting-only changes. Full verification and automated review must pass before merge. No cluster resources are changed by this PR.",
      ].join("\n");

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
