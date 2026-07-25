import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";
import { rootInstallWithoutHooks, installScoutWorkspace } from "./bot-clone.ts";
import {
  changedFilesInPaths,
  getUnifiedDiff,
  openSeasonRefreshPr,
} from "./scout-season-refresh-git.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const SCOUT_ROOT = "packages/scout-for-lol";
const BACKEND_ROOT = `${SCOUT_ROOT}/packages/backend`;
const MANIFEST_PATH = `${SCOUT_ROOT}/showcase/marketing-showcase.manifest.json`;
const PNG_OUT_DIR = `${SCOUT_ROOT}/packages/frontend/public/generated/scout-showcase`;
const ASSET_INDEX_PATH = `${SCOUT_ROOT}/packages/frontend/src/data/generated/scout-showcase-assets.json`;
const BUCKET = "scout-prod";
// The ONLY paths this job is allowed to stage.
const GENERATED_PATHS = [PNG_OUT_DIR, ASSET_INDEX_PATH];

export type ScoutShowcaseRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "pr-created" | "no-diff" | "timestamp-only-no-pr";
};

/**
 * True when a unified diff's only content changes are the asset index's
 * `generatedAt` timestamp line. The generator stamps a fresh ISO timestamp on
 * every run (the sole nondeterminism in its output), so a run against
 * unchanged S3 sources dirties exactly that line — treat it as no drift
 * rather than opening a weekly churn PR. Precedent:
 * shouldCreateDataDragonPr's image-only suppression.
 */
export function isGeneratedAtOnlyDiff(diff: string): boolean {
  const changedLines = diff
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") &&
        !line.startsWith("---"),
    );
  if (changedLines.length === 0) {
    return false;
  }
  return changedLines.every((line) => line.includes('"generatedAt":'));
}

export type ScoutShowcaseRefreshActivities =
  typeof scoutShowcaseRefreshActivities;

export const scoutShowcaseRefreshActivities = {
  /**
   * Regenerate the committed marketing showcase assets (PNGs + asset index)
   * from the curated manifest against the scout-prod bucket and, if they
   * drifted beyond the generatedAt timestamp, open a PR. Deterministic (no
   * agent). A NoSuchKey failure means an S3 object the manifest references is
   * gone — the scout-image-gc showcase exemption should prevent that; if it
   * fires anyway, re-curate the manifest with
   * scripts/discover-marketing-showcase.ts (see scout AGENTS.md).
   */
  async refreshScoutShowcase(): Promise<ScoutShowcaseRefreshResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/scout-showcase-refresh-${id}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the long subprocesses (clone, installs, the
    // S3 downloads + discord-screenshot renders) run. Pairs with the
    // activity's heartbeatTimeout in workflows/scout-showcase-refresh.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshScoutShowcase",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const s3Endpoint = Bun.env["S3_ENDPOINT"];
      if (s3Endpoint === undefined || s3Endpoint === "") {
        throw new Error(
          "S3_ENDPOINT is required for the scout showcase refresh (mapped to AWS_ENDPOINT_URL_S3 for the generator's SDK default chain)",
        );
      }

      const { token: githubToken } = await createGitHubAppInstallationToken();
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--depth",
        "1",
      ]);

      await rootInstallWithoutHooks(repoDir);
      // Builds the llm-models file: producer first — the scout workspace
      // install copies a broken package without it (see bot-clone.ts).
      await installScoutWorkspace(repoDir);

      await runCommand(
        [
          "bun",
          "run",
          "scripts/generate-marketing-showcase.ts",
          "--manifest",
          `${repoDir}/${MANIFEST_PATH}`,
          "--out",
          `${repoDir}/${PNG_OUT_DIR}`,
          "--asset-index",
          `${repoDir}/${ASSET_INDEX_PATH}`,
          "--bucket",
          BUCKET,
        ],
        {
          cwd: `${repoDir}/${BACKEND_ROOT}`,
          // createS3Client() uses the AWS SDK default chain + forcePathStyle;
          // the worker's SeaweedFS endpoint arrives via AWS_ENDPOINT_URL_S3
          // (SDK v3 honors it natively). Mirrors the lane-priors env wiring.
          env: { AWS_ENDPOINT_URL_S3: s3Endpoint },
        },
      );

      const files = await changedFilesInPaths(repoDir, GENERATED_PATHS);
      if (files.length === 0) {
        return {
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "no-diff",
        };
      }

      // The generator stamps generatedAt on every run; a timestamp-only diff
      // means the S3 sources and rendered composites are unchanged.
      if (files.length === 1 && files[0] === ASSET_INDEX_PATH) {
        const diff = await getUnifiedDiff(repoDir, [ASSET_INDEX_PATH]);
        if (isGeneratedAtOnlyDiff(diff)) {
          return {
            changedFiles: [],
            branchName: undefined,
            commitHash: undefined,
            prUrl: undefined,
            outcome: "timestamp-only-no-pr",
          };
        }
      }

      const branch = `chore/scout-showcase-refresh-${id.slice(0, 8)}`;
      const title = "chore(scout-for-lol): refresh marketing showcase assets";
      const body = [
        "Automated marketing-showcase refresh from Temporal",
        "(`scout-showcase-refresh-weekly`).",
        "",
        "Regenerated the committed showcase PNGs + asset index from the",
        "curated manifest against the scout-prod bucket — usually after a",
        "report-renderer change or a manifest re-curation. Review the image",
        "diffs visually before merging.",
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
        files: GENERATED_PATHS,
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
