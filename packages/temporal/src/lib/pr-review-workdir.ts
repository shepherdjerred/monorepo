/**
 * Ephemeral workspace management for the pr-review-bot bootstrap activity.
 *
 * The retrieval (Phase 5) and AST block-diff (Phase 6) layers both need
 * the PR head source on disk. This module owns:
 *
 *   1. Creating a temp directory at /tmp/pr-review-workdir/<workflowId>/.
 *   2. Cloning the PR head into that directory using `git clone --depth 1
 *      --branch <headRef>` with `GIT_ASKPASS` auth (per the CLAUDE.md ban
 *      on `x-access-token` URL embedding).
 *   3. Tearing the directory down on workflow completion.
 *
 * Dependencies are injected so tests can drive the flow without spawning
 * real git or touching the real filesystem. Production wires the runtime
 * helpers from `defaultWorkdirDeps`.
 *
 * Failure mode: every step throws on error. We deliberately do NOT
 * silently fall back to an empty workdir — that would mask a deployment
 * misconfiguration (missing `git`, missing `GH_TOKEN`, network outage)
 * as a successful-but-empty review.
 */

import { z } from "zod/v4";

const WORKDIR_ROOT = "/tmp/pr-review-workdir";

/**
 * Shape of the env we need for the git clone. Just `GH_TOKEN`; we don't
 * leak the entire process env into the askpass script.
 */
export const WorkdirEnvSchema = z.object({
  GH_TOKEN: z.string().min(1, "GH_TOKEN must be non-empty"),
});
export type WorkdirEnv = z.infer<typeof WorkdirEnvSchema>;

export type CloneParams = {
  owner: string;
  repo: string;
  /** Ref to clone — typically the PR head ref or commit SHA. */
  ref: string;
  /** Destination directory; created if missing. */
  dest: string;
  env: WorkdirEnv;
};

/**
 * Injected dependencies. Production wires `defaultWorkdirDeps`; tests
 * supply stubs that never spawn `git`.
 */
export type WorkdirDeps = {
  /**
   * Create a directory (recursive). Throws on permission errors; idempotent
   * if the directory already exists.
   */
  mkdir: (path: string) => Promise<void>;
  /** Remove a directory and everything under it. Throws on error. */
  rmrf: (path: string) => Promise<void>;
  /**
   * Read a file from the workdir as UTF-8. Returns `null` for ENOENT
   * (deleted-from-head files, ignored paths) so callers can skip them
   * silently. Any other error throws.
   */
  readFileUtf8: (path: string) => Promise<string | null>;
  /**
   * Clone a ref into `dest`. Must throw on non-zero exit. Implementation
   * is responsible for passing the askpass / token securely.
   */
  clone: (params: CloneParams) => Promise<void>;
};

/**
 * Default runtime dependencies. Spawns real `git`, real `mkdir`, real
 * `rm -rf`. Reads via Bun.file().text() with ENOENT → null.
 */
export const defaultWorkdirDeps: WorkdirDeps = {
  mkdir: async (path: string) => {
    const proc = Bun.spawn(["mkdir", "-p", path], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `mkdir -p ${path} failed (exit ${String(exitCode)}): ${stderr}`,
      );
    }
  },
  rmrf: async (path: string) => {
    if (path.length < 4 || !path.startsWith("/tmp/")) {
      throw new Error(`rmrf refusing to operate outside /tmp/: ${path}`);
    }
    const proc = Bun.spawn(["rm", "-rf", path], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `rm -rf ${path} failed (exit ${String(exitCode)}): ${stderr}`,
      );
    }
  },
  readFileUtf8: async (path: string) => {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return null;
    }
    return await file.text();
  },
  clone: async (params: CloneParams) => {
    await cloneViaGitAskpass(params);
  },
};

/**
 * Write a one-shot git-askpass helper that echoes the `GH_TOKEN`. Same
 * pattern used by `data-dragon.ts`: GitHub's HTTPS clone expects
 * `x-access-token` as the username and the token as the password.
 *
 * The script is written into the destination directory itself (so it's
 * cleaned up alongside the clone) but with mode 0700 so other processes
 * on the host can't read it.
 */
async function writeGitAskpass(scriptPath: string): Promise<void> {
  await Bun.write(
    scriptPath,
    [
      "#!/bin/sh",
      // The git client invokes askpass with a localized prompt that contains
      // either "Username" or "Password". We branch on which.
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) echo "$GH_TOKEN" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  const chmod = Bun.spawn(["chmod", "0700", scriptPath], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await chmod.exited;
  if (exitCode !== 0) {
    throw new Error(
      `chmod 0700 ${scriptPath} failed (exit ${String(exitCode)})`,
    );
  }
}

async function cloneViaGitAskpass(params: CloneParams): Promise<void> {
  const askpassPath = `${params.dest}.askpass.sh`;
  await writeGitAskpass(askpassPath);
  const url = `https://github.com/${params.owner}/${params.repo}.git`;
  // We clone the default branch shallowly, then fetch + checkout the
  // specific ref. This works for both PR head commits and named branches.
  // Doing `git clone --branch <commitSha>` does NOT work for commit SHAs.
  const proc = Bun.spawn(
    [
      "git",
      "clone",
      "--depth",
      "1",
      "--no-tags",
      "--filter=blob:none",
      url,
      params.dest,
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        GH_TOKEN: params.env.GH_TOKEN,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `git clone ${url} → ${params.dest} failed (exit ${String(exitCode)}): ${stderr}`,
    );
  }

  // Fetch + checkout the specific commit. This works regardless of
  // whether `ref` is a SHA or a branch name.
  const fetch = Bun.spawn(
    ["git", "fetch", "--depth", "1", "origin", params.ref],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      cwd: params.dest,
      env: {
        ...Bun.env,
        GH_TOKEN: params.env.GH_TOKEN,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  const fetchExit = await fetch.exited;
  if (fetchExit !== 0) {
    const stderr = await new Response(fetch.stderr).text();
    throw new Error(
      `git fetch origin ${params.ref} in ${params.dest} failed (exit ${String(fetchExit)}): ${stderr}`,
    );
  }

  const checkout = Bun.spawn(["git", "checkout", "FETCH_HEAD"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: params.dest,
  });
  const checkoutExit = await checkout.exited;
  if (checkoutExit !== 0) {
    const stderr = await new Response(checkout.stderr).text();
    throw new Error(
      `git checkout FETCH_HEAD in ${params.dest} failed (exit ${String(checkoutExit)}): ${stderr}`,
    );
  }
}

/**
 * Compute the per-workflow workdir path. Exported so the activity can log
 * the value and the cleanup helper can find it later.
 */
export function workdirPathFor(workflowId: string): string {
  // Temporal workflow ids can contain `/` and other characters that aren't
  // safe in a path component. Replace them with `_`.
  const safe = workflowId.replaceAll(/[^\w.-]/g, "_");
  return `${WORKDIR_ROOT}/${safe}`;
}

/**
 * Provision a fresh workdir and clone the PR head into it. Returns the
 * absolute path of the clone. Throws on any setup error.
 */
export async function provisionWorkdir(input: {
  workflowId: string;
  owner: string;
  repo: string;
  ref: string;
  env: WorkdirEnv;
  deps?: WorkdirDeps;
}): Promise<string> {
  const deps = input.deps ?? defaultWorkdirDeps;
  const dest = workdirPathFor(input.workflowId);
  await deps.mkdir(WORKDIR_ROOT);
  // If a stale workdir exists for this workflow id (a prior attempt that
  // didn't clean up), nuke it first. Cheaper than diagnosing a half-clone.
  await deps.rmrf(dest);
  await deps.clone({
    owner: input.owner,
    repo: input.repo,
    ref: input.ref,
    dest,
    env: input.env,
  });
  return dest;
}

/**
 * Tear down a previously-provisioned workdir. Idempotent — call this at
 * workflow completion regardless of success / failure.
 */
export async function cleanupWorkdir(
  workdir: string,
  deps: WorkdirDeps = defaultWorkdirDeps,
): Promise<void> {
  await deps.rmrf(workdir);
}
