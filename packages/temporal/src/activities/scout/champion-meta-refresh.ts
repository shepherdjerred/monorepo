import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import { installScoutWorkspace } from "#activities/bot-clone.ts";
import {
  changedAllowedFiles,
  cloneMainForGeneratedRefresh,
  publishGeneratedRefresh,
} from "./generated-refresh.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";

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
  return await changedAllowedFiles(
    repoDir,
    [CHAMPION_META_SNAPSHOT_PATH],
    "Champion-meta refresh",
  );
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
      const gitEnv = await cloneMainForGeneratedRefresh({
        tempDir,
        repoDir,
        githubToken,
      });
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
      const published = await publishGeneratedRefresh({
        repoDir,
        githubToken,
        gitEnv,
        branch: championMetaBranchName(contentHash),
        title: championMetaPrTitle(),
        body,
        files: [CHAMPION_META_SNAPSHOT_PATH],
        changedFiles: files,
        onAutoMergeFailure: (prUrl) => (error: unknown) => {
          jsonLog("warning", "Champion-meta PR auto-merge setup failed", {
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
      return { ...published, contentHash };
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
