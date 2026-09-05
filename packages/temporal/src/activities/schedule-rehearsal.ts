import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { runCommand } from "./data-dragon-shell.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const MAIN_BRANCH = "main";
/**
 * The rehearsal driver lives beside the worker's own source. `/app` is the
 * image WORKDIR (packages/temporal/Dockerfile), and the runtime stage copies
 * the whole `packages/temporal` tree, so the script is always present next to
 * the very helpers it exercises.
 */
const REHEARSAL_SCRIPT = "/app/packages/temporal/scripts/rehearse-bot-clone.ts";

export type ScheduleRehearsalResult = {
  repoSha: string;
  durationMs: number;
};

export type ScheduleRehearsalActivities = typeof scheduleRehearsalActivities;

export const scheduleRehearsalActivities = {
  /**
   * Dress-rehearse the bot-clone machinery that every PR-creating scheduled
   * workflow depends on, against current `main`.
   *
   * This used to be the `check:rehearsal` turbo task in the root `bun run
   * verify` graph, so it ran on every pull request — a rehearsal for a weekly
   * Saturday job, gating every commit, at ~338s a run and uncacheable. It is
   * now scheduled at the cadence of the thing it protects.
   *
   * Running it here is also strictly more faithful than running it in CI: the
   * helpers under test (bot-clone.ts) execute in the real worker image, with
   * the real network path and the real resource limits that
   * `scout-data-dragon-weekly-refresh` will meet the next morning. CI only ever
   * approximated that.
   *
   * The rehearsal is destructive (git init/add/commit, `bun install`, prettier
   * --write, a Data Dragon snapshot refresh), so it only ever runs against a
   * throwaway clone under /tmp, never a live checkout.
   */
  async rehearseScheduleBotClone(): Promise<ScheduleRehearsalResult> {
    const start = Date.now();
    const tempDir = `/tmp/schedule-rehearsal-${crypto.randomUUID()}`;
    const repoDir = `${tempDir}/monorepo`;
    const baselineFiles = `${tempDir}/tracked-files.txt`;
    const bunCacheDir = `${tempDir}/bun-cache`;

    // Heartbeat while the long subprocesses (clone, root install, prettier,
    // Data Dragon refresh) run. Pairs with heartbeatTimeout in
    // workflows/schedule-rehearsal.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "rehearseScheduleBotClone",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      await runCommand(["mkdir", "-p", bunCacheDir], { cwd: "/tmp" });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--depth",
        "1",
      ]);
      const repoSha = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      if (repoSha === "") {
        throw new Error("git rev-parse HEAD returned no commit for the clone");
      }

      // The rehearsal models a clean CI checkout, which has no source-control
      // metadata: rehearse-bot-clone.ts only exercises its `git init` commit
      // canary when `.git` is absent. Capture the tracked-file manifest it
      // stages from BEFORE removing the clone's own `.git`.
      const tracked = await runCommand(["git", "ls-files", "-z"], {
        cwd: repoDir,
        trimStdout: false,
      });
      await Bun.write(baselineFiles, tracked);
      await runCommand(["rm", "-rf", `${repoDir}/.git`], { cwd: tempDir });

      await runCommand(
        [
          "bun",
          "run",
          REHEARSAL_SCRIPT,
          `--repo=${repoDir}`,
          `--baseline-files=${baselineFiles}`,
        ],
        {
          cwd: repoDir,
          // Every install the rehearsal performs points at a scratch-local Bun
          // cache that is removed with the work directory, so a rehearsal can
          // never disturb the worker's shared cache.
          env: { BUN_INSTALL_CACHE_DIR: bunCacheDir },
        },
      );

      return { repoSha, durationMs: Date.now() - start };
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
