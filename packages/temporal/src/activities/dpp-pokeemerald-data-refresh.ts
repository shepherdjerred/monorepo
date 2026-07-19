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
const DPP_ROOT = "packages/discord-plays-pokemon";
// The ONLY paths this job is allowed to stage: the committed species/map data
// tables derived from the pokeemerald-wasm source pin (OTTOHG_SHA in
// scripts/build-wasm.sh, Renovate-advanced). Steady state is no-diff; the
// job's purpose is the follow-up regen PR the morning after a Renovate pin
// bump merges — hosted (Mend) Renovate cannot run the generators inside its
// own PR.
const GENERATED_PATHS = [
  `${DPP_ROOT}/packages/backend/src/game/events/generated/species.ts`,
  `${DPP_ROOT}/packages/backend/src/game/spatial/generated/map-names.ts`,
];

export type PokeemeraldDataRefreshResult = {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "pr-created" | "no-diff";
};

export type PokeemeraldDataRefreshActivities =
  typeof pokeemeraldDataRefreshActivities;

export const pokeemeraldDataRefreshActivities = {
  /**
   * Regenerate the committed pokeemerald species/map data tables from the
   * wasm source pin and, if they drifted, open a PR. Deterministic (no
   * agent): the generators fetch four files from
   * raw.githubusercontent.com/ottohg/pokeemerald-wasm at the pinned SHA and
   * format with the repo's pinned prettier, so regeneration is byte-stable
   * against a clean tree.
   */
  async refreshPokeemeraldData(): Promise<PokeemeraldDataRefreshResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/dpp-data-refresh-${id}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the subprocesses (clone, bun install, the
    // generator fetches) run. Pairs with the activity's heartbeatTimeout in
    // workflows/dpp-pokeemerald-data-refresh.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "refreshPokeemeraldData",
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

      // Hook-free root install — the generators only need the workspace's
      // pinned prettier on PATH via bunx.
      await rootInstallWithoutHooks(repoDir);
      await runCommand(["bun", "scripts/generate-species-data.ts"], {
        cwd: `${repoDir}/${DPP_ROOT}`,
      });
      await runCommand(["bun", "scripts/generate-map-names.ts"], {
        cwd: `${repoDir}/${DPP_ROOT}`,
      });

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

      const branch = `chore/dpp-pokeemerald-data-refresh-${id.slice(0, 8)}`;
      const title =
        "chore(discord-plays-pokemon): refresh generated pokeemerald data";
      const body = [
        "Automated pokeemerald data-table refresh from Temporal",
        "(`dpp-pokeemerald-data-daily`).",
        "",
        "Regenerated the committed species/map tables from the current",
        "`OTTOHG_SHA` pin in `scripts/build-wasm.sh` — usually the follow-up",
        "to a merged Renovate pin bump (hosted Renovate cannot run the",
        "generators itself).",
        "",
        `Changed files: ${String(files.length)}`,
        "",
        ...files.map((f) => `- ${f}`),
      ].join("\n");

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
