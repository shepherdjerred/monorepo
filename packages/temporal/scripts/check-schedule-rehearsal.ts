#!/usr/bin/env bun
/**
 * Local driver for the schedule rehearsal (old CI: temporal-schedule-rehearsal).
 *
 * The rehearsal (`scripts/rehearse-bot-clone.ts`) drives the SAME
 * `bot-clone.ts` helpers the scheduled PR-creating activities run in
 * production, plus canaries for the cog targets and the hook-free commit path.
 * It is destructive (git init/add/commit, `bun install`, prettier --write,
 * data-dragon snapshot refresh), so it must never run against the live
 * checkout.
 *
 * Old CI ran it inside the temporal-worker image against a copy of the repo
 * tree mounted WITHOUT `.git` (so the script git-inits a scratch repo). This
 * driver reproduces that shape locally:
 *
 *  1. Copy the repo tree to a temp dir, excluding `.git`, `node_modules`,
 *     `dist`, and `.eslintcache` — matching the old Dagger exclude list.
 *  2. Ensure the `cog` (cogapp) CLI is on PATH — the worker image bakes in
 *     cogapp system-wide; locally we shim `uvx --from cogapp==<pinned> cog`
 *     when a bare `cog` isn't already present.
 *  3. Run `rehearse-bot-clone.ts --repo=<copy>`.
 *
 * Fail-fast: a non-zero exit from any leg throws.
 */
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Keep in lockstep with the worker image's baked cogapp (old CI: COGAPP_VERSION).
const COGAPP_VERSION = "3.6.0";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const REHEARSAL_SCRIPT = path.resolve(import.meta.dir, "rehearse-bot-clone.ts");

async function run(
  cmd: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...Bun.env, ...options.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `command failed with exit code ${String(exitCode)}: ${cmd.join(" ")}`,
    );
  }
}

async function commandExists(name: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-c", `command -v ${name}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

/**
 * Copy the repo tree to `dest`, excluding the same paths the old Dagger step
 * excluded. Uses rsync when available (fast, honours excludes cleanly); the
 * exclude list is the load-bearing bit — `.git` MUST be absent so the
 * rehearsal git-inits a scratch repo instead of touching the real checkout.
 */
async function copyRepoTree(dest: string): Promise<void> {
  if (!(await commandExists("rsync"))) {
    throw new Error(
      "rsync is required to copy the repo tree for the rehearsal — install it (brew install rsync).",
    );
  }
  await run(
    [
      "rsync",
      "-a",
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=dist",
      "--exclude=.eslintcache",
      "--exclude=.turbo",
      `${REPO_ROOT}/`,
      `${dest}/`,
    ],
    { cwd: REPO_ROOT },
  );
}

/**
 * Return a PATH prefix that makes a bare `cog` resolve. If cogapp is already
 * installed as `cog`, no shim is needed. Otherwise write a tiny shim that execs
 * `uvx --from cogapp==<pinned> cog "$@"` and return its directory to prepend.
 */
async function ensureCogOnPath(shimDir: string): Promise<string | undefined> {
  if (await commandExists("cog")) return undefined;
  if (!(await commandExists("uvx"))) {
    throw new Error(
      "neither `cog` nor `uvx` is available — install cogapp " +
        `(uvx --from cogapp==${COGAPP_VERSION} cog) or a system cog.`,
    );
  }
  await mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "cog");
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec uvx --from cogapp==${COGAPP_VERSION} cog "$@"\n`,
  );
  await chmod(shimPath, 0o755);
  return shimDir;
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "schedule-rehearsal-"));
  const repoCopy = path.join(workDir, "monorepo");
  const shimDir = path.join(workDir, "shim");
  await mkdir(repoCopy, { recursive: true });

  try {
    console.error(`[check:rehearsal] copying repo tree → ${repoCopy}`);
    await copyRepoTree(repoCopy);

    const cogShim = await ensureCogOnPath(shimDir);
    const pathEnv =
      cogShim === undefined
        ? Bun.env["PATH"]
        : `${cogShim}:${Bun.env["PATH"] ?? ""}`;

    console.error("[check:rehearsal] running rehearse-bot-clone.ts");
    await run(["bun", "run", REHEARSAL_SCRIPT, `--repo=${repoCopy}`], {
      cwd: REPO_ROOT,
      env: pathEnv === undefined ? {} : { PATH: pathEnv },
    });
    console.error("[check:rehearsal] rehearsal passed");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// IIFE rather than top-level await: temporal's tsconfig uses a Node16/CommonJS
// module target that rejects TLA (same pattern as ensure-ha-schema.ts / smoke.ts).
void (async () => {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check:rehearsal: ${message}`);
    process.exit(1);
  }
})();
