import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  fetchGeneratedRemoteBranch,
  pushOwnedGeneratedCommit,
  writeGitAskpass,
} from "./scout-season-refresh-git.ts";
import {
  createGeneratedPr,
  ensureGeneratedPrAutoMerge,
  findOpenGeneratedPrUrl,
  type OpenPrListItem,
} from "#activities/data-dragon/data-dragon-pr.ts";
import {
  parseGitStatusLine,
  type GitStatusEntry,
} from "#activities/data-dragon/data-dragon-diff.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import {
  disarmGitHooks,
  installScoutWorkspace,
} from "#activities/bot-clone.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const FRONTEND_ROOT = "packages/scout-for-lol/packages/frontend";

/** Repo-root-relative: used for `git add` and the `git status` allowlist. */
export const CHAMPION_META_SNAPSHOT_PATH = `${FRONTEND_ROOT}/src/data/generated/champion-meta.snapshot.json`;

export const ChampionMetaWorkflowInputSchema = z.strictObject({
  /** Origin of the deployed meta API the snapshot is fetched from. */
  metaOrigin: z.url(),
});

export type ChampionMetaWorkflowInput = z.infer<
  typeof ChampionMetaWorkflowInputSchema
>;

export type ChampionMetaRefreshResult = {
  changedFiles: string[];
  contentHash: string | undefined;
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "success" | "skipped";
  reason: "pr-created" | "no-diff" | "pr-already-open";
  autoMergeConfigured?: boolean;
};

export function championMetaPrTitle(): string {
  return "chore(scout-for-lol): refresh champion meta snapshot";
}

export function championMetaBranchName(contentHash: string): string {
  return `chore/scout-champion-meta-${contentHash}`;
}

export async function championMetaContentHash(
  repoDir: string,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    await Bun.file(`${repoDir}/${CHAMPION_META_SNAPSHOT_PATH}`).text(),
  );
  return hasher.digest("hex").slice(0, 12);
}

/** Paths in `git status` output that are not the snapshot itself. */
export function championMetaDisallowedPaths(
  changes: readonly GitStatusEntry[],
): string[] {
  const disallowed = new Set<string>();
  for (const change of changes) {
    for (const path of [change.path, change.previousPath]) {
      if (path !== undefined && path !== CHAMPION_META_SNAPSHOT_PATH) {
        disallowed.add(path);
      }
    }
  }
  return [...disallowed].toSorted();
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "scout-champion-meta-refresh",
      ...fields,
    }),
  );
}

async function changedSnapshotFiles(repoDir: string): Promise<string[]> {
  const status = await runCommand(["git", "status", "--porcelain"], {
    cwd: repoDir,
    trimStdout: false,
  });
  const changes = status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
  const disallowed = championMetaDisallowedPaths(changes);
  if (disallowed.length > 0) {
    throw new Error(
      `Champion-meta refresh changed disallowed paths: ${disallowed.join(", ")}`,
    );
  }
  return changes.map((change) => change.path).toSorted();
}

function isChampionMetaPr(
  pr: OpenPrListItem,
  appSlug: string,
  branch: string,
): boolean {
  return (
    pr.title === championMetaPrTitle() &&
    pr.baseRefName === MAIN_BRANCH &&
    pr.headRefName === branch &&
    !pr.isCrossRepository &&
    pr.author.is_bot &&
    pr.author.login.replace(/^app\//, "").replace(/\[bot\]$/, "") === appSlug
  );
}

async function findOpenChampionMetaPrUrl(
  branch: string,
  token: string,
): Promise<string | undefined> {
  return await findOpenGeneratedPrUrl({
    repoSlug: REPO_SLUG,
    filterArgs: ["--head", branch],
    token,
    matches: (pr, appSlug) => isChampionMetaPr(pr, appSlug, branch),
  });
}

const SKIPPED_NO_DIFF: ChampionMetaRefreshResult = {
  changedFiles: [],
  contentHash: undefined,
  branchName: undefined,
  commitHash: undefined,
  prUrl: undefined,
  outcome: "skipped",
  reason: "no-diff",
};

export type ChampionMetaActivities = typeof championMetaActivities;

export const championMetaActivities = {
  /**
   * Fetch the champion meta from the deployed API into the committed
   * snapshot the Scout champion pages are built from, and open a PR when it
   * differs. Deterministic (no agent). An API with nothing published yields
   * the empty snapshot, so an unchanged empty snapshot opens no PR.
   */
  async refreshChampionMeta(
    input: ChampionMetaWorkflowInput,
  ): Promise<ChampionMetaRefreshResult> {
    const config = ChampionMetaWorkflowInputSchema.parse(input);
    const start = Date.now();
    const tempDir = `/tmp/scout-champion-meta-${crypto.randomUUID()}`;
    const repoDir = `${tempDir}/monorepo`;
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshChampionMeta",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const { token: githubToken } = await createGitHubAppInstallationToken();
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      const askpass = await writeGitAskpass(tempDir);
      const gitEnv = {
        GH_TOKEN: githubToken,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: "0",
      };
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--depth",
        "1",
      ]);
      await installScoutWorkspace(repoDir);

      // Absolute output path: `bun run --filter` would resolve a relative one
      // against the filtered package, not the repo root.
      await runCommand(
        [
          "bun",
          "run",
          "refresh-champion-meta",
          "--origin",
          config.metaOrigin,
          "--output",
          `${repoDir}/${CHAMPION_META_SNAPSHOT_PATH}`,
        ],
        { cwd: `${repoDir}/${FRONTEND_ROOT}` },
      );

      let files = await changedSnapshotFiles(repoDir);
      await discardFormattingOnlyChanges({
        repoDir,
        changedFiles: files,
        component: "scout-champion-meta-refresh",
      });
      files = await changedSnapshotFiles(repoDir);
      if (files.length === 0) return SKIPPED_NO_DIFF;

      await runScoutGeneratedPreflight({
        repoDir,
        changedFiles: files,
        runCommand,
      });
      files = await changedSnapshotFiles(repoDir);
      if (files.length === 0) return SKIPPED_NO_DIFF;

      const contentHash = await championMetaContentHash(repoDir);
      const branch = championMetaBranchName(contentHash);
      const title = championMetaPrTitle();
      const onAutoMergeFailure = (prUrl: string) => (error: unknown) => {
        jsonLog("warning", "Champion-meta PR auto-merge setup failed", {
          prUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      };

      const existingPrUrl = await findOpenChampionMetaPrUrl(
        branch,
        githubToken,
      );
      if (existingPrUrl !== undefined) {
        const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
          repoSlug: REPO_SLUG,
          prUrl: existingPrUrl,
          token: githubToken,
          onFailure: onAutoMergeFailure(existingPrUrl),
        });
        return {
          changedFiles: files,
          contentHash,
          branchName: branch,
          commitHash: undefined,
          prUrl: existingPrUrl,
          outcome: "skipped",
          reason: "pr-already-open",
          autoMergeConfigured,
        };
      }

      await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
        cwd: repoDir,
      });
      await runCommand(["git", "config", "user.name", "CI Bot"], {
        cwd: repoDir,
      });
      const expectedRemoteSha = await fetchGeneratedRemoteBranch({
        repoDir,
        branch,
        gitEnv,
      });
      await runCommand(["git", "checkout", "-B", branch], { cwd: repoDir });
      await runCommand(["git", "add", "--", CHAMPION_META_SNAPSHOT_PATH], {
        cwd: repoDir,
      });
      await disarmGitHooks(repoDir);
      await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
      const commitHash = await pushOwnedGeneratedCommit({
        repoDir,
        branch,
        gitEnv,
        expectedRemoteSha,
      });
      const body = [
        "## Why",
        "Keep the Scout champion pages aligned with the champion meta the Scout API currently serves.",
        "",
        "## What",
        "",
        `Content hash: ${contentHash}`,
        `Source: ${config.metaOrigin}/api/meta/v1`,
        "Regenerated `champion-meta.snapshot.json` from the meta API; minimum samples are those the API enforces.",
        "",
        "## Verification",
        "Ran the snapshot generator and generated-file preflight. Full CI and automated review must pass before merge. Live page acceptance has not run.",
      ].join("\n");
      const { url: prUrl, recovered } = await createGeneratedPr(
        {
          repoSlug: REPO_SLUG,
          repoDir,
          branch,
          base: MAIN_BRANCH,
          title,
          body,
          token: githubToken,
        },
        {
          findOnHead: async () =>
            await findOpenChampionMetaPrUrl(branch, githubToken),
        },
      );
      const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
        repoSlug: REPO_SLUG,
        prUrl,
        token: githubToken,
        onFailure: onAutoMergeFailure(prUrl),
      });
      return {
        changedFiles: files,
        contentHash,
        branchName: branch,
        commitHash,
        prUrl,
        outcome: recovered ? "skipped" : "success",
        reason: recovered ? "pr-already-open" : "pr-created",
        autoMergeConfigured,
      };
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
