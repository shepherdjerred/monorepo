/**
 * `ensureBabysitWorkdir` — idempotent persistent checkout of the PR branch.
 *
 * Unlike the report-only review workdir (cloned fresh per run), the babysitter
 * keeps ONE workdir per PR across iterations: cold (absent) → blobless clone +
 * checkout; warm (present) → fetch + `reset --hard origin/<headRef>`. origin is
 * authoritative (we always push at the end of an iteration, and a human may
 * push too), so a hard reset is the correct way to start each iteration from a
 * clean, known tree.
 *
 * Auth: when a GitHub App token is supplied we write a `GIT_ASKPASS` helper
 * (per the AGENTS.md ban on `x-access-token` in URLs). Without a token, git
 * falls back to ambient credentials (the local PoC uses the user's
 * `gh auth setup-git` credential helper).
 */
import { run } from "./exec.ts";

const WORKDIR_ROOT = "/tmp/pr-babysit-workdir";

const BOT_NAME = Bun.env["GIT_AUTHOR_NAME"] ?? "temporal-worker[bot]";
const BOT_EMAIL =
  Bun.env["GIT_AUTHOR_EMAIL"] ?? "temporal-worker@homelab.local";

export function babysitWorkdirPath(workflowId: string): string {
  const safe = workflowId.replaceAll(/[^\w.-]/g, "_");
  return `${WORKDIR_ROOT}/${safe}`;
}

async function writeGitAskpass(dir: string): Promise<string> {
  const path = `${dir}/git-askpass.sh`;
  await Bun.write(
    path,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) echo "$GH_TOKEN" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await run(["chmod", "0700", path]);
  return path;
}

export type EnsureBabysitWorkdirInput = {
  owner: string;
  repo: string;
  headRef: string;
  baseRef: string;
  /** Stable per-PR id; the workdir path is derived from it. */
  workflowId: string;
  /** GitHub App installation token; omit to use ambient git credentials. */
  token?: string;
};

export type EnsureBabysitWorkdirResult = {
  workdir: string;
  headSha: string;
};

/** Transient git network failures worth retrying (server-side timeouts etc.). */
function isTransientGitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b408\b|RPC failed|could not fetch|early EOF|Connection reset|timed out|TLS|unexpected disconnect|fetch-pack/i.test(
    msg,
  );
}

async function runWithGitRetry(
  command: readonly string[],
  options: { cwd?: string; env?: Record<string, string> },
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await run(command, options);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientGitError(error)) {
        throw error;
      }
      await Bun.sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function ensureBabysitWorkdir(
  input: EnsureBabysitWorkdirInput,
): Promise<EnsureBabysitWorkdirResult> {
  const workdir = babysitWorkdirPath(input.workflowId);
  const cloneUrl = `https://github.com/${input.owner}/${input.repo}.git`;

  // Create the workdir root BEFORE writing the askpass helper into it (the
  // askpass write targets WORKDIR_ROOT, so the directory must exist first).
  await run(["mkdir", "-p", WORKDIR_ROOT]);

  const gitEnv: Record<string, string> =
    input.token === undefined
      ? {}
      : {
          GH_TOKEN: input.token,
          GIT_ASKPASS: await writeGitAskpass(WORKDIR_ROOT),
          GIT_TERMINAL_PROMPT: "0",
        };
  const opts = { cwd: workdir, env: gitEnv };

  const hasGit = await Bun.file(`${workdir}/.git/HEAD`).exists();
  if (!hasGit) {
    // `--no-checkout` keeps the heavy on-demand blob fetch OFF the clone and on
    // the targeted `checkout` below, so a transient server timeout can be
    // retried without re-downloading the whole repository. rm-then-clone each
    // attempt so a partial clone never wedges the retry.
    let cloned = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !cloned; attempt += 1) {
      await run(["rm", "-rf", workdir]);
      try {
        await run(
          [
            "git",
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            cloneUrl,
            workdir,
          ],
          { env: gitEnv },
        );
        cloned = true;
      } catch (error: unknown) {
        lastError = error;
        if (attempt === 2 || !isTransientGitError(error)) {
          throw error;
        }
        await Bun.sleep(3000 * (attempt + 1));
      }
    }
    if (!cloned) {
      throw lastError;
    }
  }

  await runWithGitRetry(
    ["git", "fetch", "origin", input.headRef, input.baseRef],
    opts,
  );
  await runWithGitRetry(
    ["git", "checkout", "-B", input.headRef, `origin/${input.headRef}`],
    opts,
  );
  await run(["git", "reset", "--hard", `origin/${input.headRef}`], opts);
  await run(["git", "config", "user.name", BOT_NAME], opts);
  await run(["git", "config", "user.email", BOT_EMAIL], opts);

  const headSha = await run(["git", "rev-parse", "HEAD"], opts);
  return { workdir, headSha };
}
