import { ApplicationFailure, Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import { installScoutWorkspace } from "#activities/bot-clone.ts";
import {
  changedAllowedFiles,
  cloneMainForGeneratedRefresh,
  isInGeneratedDirectory,
  publishGeneratedRefresh,
} from "./generated-refresh.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";

const FRONTEND_ROOT = "packages/scout-for-lol/packages/frontend";
/** Repo-root-relative: used for `git add` and the `git status` allowlist. */
export const CHAMPION_META_SNAPSHOT_PATH = `${FRONTEND_ROOT}/src/data/generated/champion-meta.snapshot.json`;
/**
 * The split snapshot v2 (an index, one file per champion, one per matchup),
 * written beside the single file. The activity may change files below this
 * directory and nothing else but the single file above.
 */
export const CHAMPION_META_SNAPSHOT_V2_DIRECTORY = `${FRONTEND_ROOT}/src/data/generated/champion-meta`;
/**
 * Present in every error the snapshot's size or change-set guard raises
 * (`snapshot-v2-budget.ts` in the Scout data package). The guard is
 * deterministic, so the activity does not retry it.
 */
export const SNAPSHOT_GUARD_MARKER = "champion-meta-snapshot-guard";

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

/** The files of the split snapshot in `repoDir`, as repository-relative paths in a fixed order. */
async function snapshotV2Paths(repoDir: string): Promise<string[]> {
  const found: string[] = [];
  const glob = new Bun.Glob("**/*.json");
  for await (const relative of glob.scan({
    cwd: `${repoDir}/${CHAMPION_META_SNAPSHOT_V2_DIRECTORY}`,
  })) {
    found.push(`${CHAMPION_META_SNAPSHOT_V2_DIRECTORY}/${relative}`);
  }
  return found.toSorted();
}

/** One hash over the single file and every file of the split snapshot, in a fixed order. */
export async function championMetaContentHash(
  repoDir: string,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of [
    CHAMPION_META_SNAPSHOT_PATH,
    ...(await snapshotV2Paths(repoDir)),
  ]) {
    hasher.update(`${path}\n${await Bun.file(`${repoDir}/${path}`).text()}\n`);
  }
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
    [CHAMPION_META_SNAPSHOT_V2_DIRECTORY],
  );
}

/** The changed files outside the split snapshot, which the formatter gates apply to. */
export function singleFilePaths(changedFiles: readonly string[]): string[] {
  return changedFiles.filter(
    (path) =>
      !isInGeneratedDirectory(path, CHAMPION_META_SNAPSHOT_V2_DIRECTORY),
  );
}

/**
 * The changed files as the result reports them: the single file by path and
 * the split snapshot as one line with a count, so the result of a refresh that
 * rewrites thousands of files stays small.
 */
export function summarizeChangedFiles(
  changedFiles: readonly string[],
): string[] {
  const single = singleFilePaths(changedFiles);
  const split = changedFiles.length - single.length;
  return split === 0
    ? single
    : [
        ...single,
        `${CHAMPION_META_SNAPSHOT_V2_DIRECTORY}/ (${split.toString()} files)`,
      ];
}

/** A guard failure is the same on every attempt, so Temporal must not retry it. */
export function refuseRetryOfGuard(error: unknown): never {
  if (error instanceof Error && error.message.includes(SNAPSHOT_GUARD_MARKER)) {
    throw ApplicationFailure.create({
      message: error.message,
      type: "ChampionMetaSnapshotGuard",
      nonRetryable: true,
    });
  }
  throw error;
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
   * snapshots the Scout champion pages are built from (the single file, and
   * the split snapshot v2 beside it), and open a PR when they differ.
   * Deterministic (no agent). An API with nothing published yields the empty
   * snapshots, so unchanged empty snapshots open no PR. A split snapshot over
   * its size budget, or one that would change more files than a PR can carry,
   * fails the refresh instead of being truncated (AI-1031).
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
      try {
        await runCommand(
          [
            "bun",
            "run",
            "refresh-champion-meta",
            "--origin",
            config.metaOrigin,
            "--output",
            `${repoDir}/${CHAMPION_META_SNAPSHOT_PATH}`,
            "--snapshot-dir",
            `${repoDir}/${CHAMPION_META_SNAPSHOT_V2_DIRECTORY}`,
          ],
          { cwd: `${repoDir}/${FRONTEND_ROOT}` },
        );
      } catch (error) {
        refuseRetryOfGuard(error);
      }

      // The split snapshot is compact JSON the generator writes byte-for-byte
      // and Prettier ignores (`**/generated/**`), so only the single file goes
      // through the formatting gates.
      let files = await changedSnapshotFiles(repoDir);
      await discardFormattingOnlyChanges({
        repoDir,
        changedFiles: singleFilePaths(files),
        component: "scout-champion-meta-refresh",
      });
      files = await changedSnapshotFiles(repoDir);
      if (files.length === 0) return SKIPPED_NO_DIFF;

      await runScoutGeneratedPreflight({
        repoDir,
        changedFiles: singleFilePaths(files),
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
        `Changed files: ${files.length.toString()}, the single file and the split snapshot below \`champion-meta/\` (an index, one file per champion and one per matchup).`,
        "Regenerated `champion-meta.snapshot.json` and the split snapshot from the meta API; minimum samples are those the API enforces. The refresh fails rather than open a PR over the size budget or over 2,500 changed files (AI-1031).",
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
        files: [
          CHAMPION_META_SNAPSHOT_PATH,
          CHAMPION_META_SNAPSHOT_V2_DIRECTORY,
        ],
        changedFiles: summarizeChangedFiles(files),
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
