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
 *  1. Copy only Git-tracked files to a temp dir, without source-control
 *     metadata or local artifacts.
 *  2. Ensure the `cog` (cogapp) CLI is on PATH — the worker image bakes in
 *     cogapp system-wide; locally we shim `uvx --from cogapp==<pinned> cog`
 *     when a bare `cog` isn't already present.
 *  3. Run `rehearse-bot-clone.ts --repo=<copy>`.
 *
 * Fail-fast: a non-zero exit from any leg throws.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function writeTrackedFilesManifest(manifestPath: string): Promise<void> {
  const proc = Bun.spawn(["git", "ls-files", "-z"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ls-files failed with exit code ${String(exitCode)}: ${stderr}`,
    );
  }
  const trackedFiles = new TextDecoder()
    .decode(stdout)
    .split("\0")
    .filter((file) => file.length > 0);
  const trackedFileStates = await Promise.all(
    trackedFiles.map(async (file) => ({
      exists: await Bun.file(path.join(REPO_ROOT, file)).exists(),
      file,
    })),
  );
  const existingFiles = trackedFileStates
    .filter(({ exists }) => exists)
    .map(({ file }) => file);
  await writeFile(
    manifestPath,
    `${existingFiles.join("\0")}${existingFiles.length > 0 ? "\0" : ""}`,
  );
}

/**
 * Copy only the source checkout's Git-tracked files to `dest`. The scratch
 * tree intentionally has no `.git`, dependency output, or untracked local
 * artifacts, matching a clean CI checkout without source-control metadata.
 */
async function copyRepoTree(
  dest: string,
  trackedFilesManifest: string,
): Promise<void> {
  if (!(await commandExists("rsync"))) {
    throw new Error(
      "rsync is required to copy the repo tree for the rehearsal — install it (brew install rsync).",
    );
  }
  await run(
    [
      "rsync",
      "-a",
      "--from0",
      `--files-from=${trackedFilesManifest}`,
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
  const bunCacheDir = path.join(workDir, "bun-cache");
  const trackedFilesManifest = path.join(workDir, "tracked-files.txt");
  await mkdir(repoCopy, { recursive: true });
  await mkdir(bunCacheDir, { recursive: true });

  try {
    await writeTrackedFilesManifest(trackedFilesManifest);
    console.error(`[check:rehearsal] copying repo tree → ${repoCopy}`);
    await copyRepoTree(repoCopy, trackedFilesManifest);

    const cogShim = await ensureCogOnPath(shimDir);
    const pathEnv =
      cogShim === undefined
        ? Bun.env["PATH"]
        : `${cogShim}:${Bun.env["PATH"] ?? ""}`;

    console.error("[check:rehearsal] running rehearse-bot-clone.ts");
    // Point every install the rehearsal performs (its scratch-clone plain
    // `bun install`, plus any nested install) at a scratch-local Bun cache. In
    // CI the pipeline sets BUN_INSTALL_CACHE_DIR to the shared PVC
    // (/buildkite/bun-cache/data), but the rehearsal's installs bypass
    // bun-install.sh and never take the collector's shared lock — writing to the
    // shared cache would let the five-minute collector delete entries
    // mid-install. This scratch cache lives under workDir and is removed with it.
    const rehearsalEnv: Record<string, string> = {
      BUN_INSTALL_CACHE_DIR: bunCacheDir,
    };
    if (pathEnv !== undefined) {
      rehearsalEnv["PATH"] = pathEnv;
    }
    await run(
      [
        "bun",
        "run",
        REHEARSAL_SCRIPT,
        `--repo=${repoCopy}`,
        `--baseline-files=${trackedFilesManifest}`,
      ],
      {
        cwd: REPO_ROOT,
        env: rehearsalEnv,
      },
    );
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
