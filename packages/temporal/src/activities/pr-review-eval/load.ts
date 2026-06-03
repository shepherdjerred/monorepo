/**
 * Load the held-out fixture corpus from a configured private repository at a
 * pinned merge SHA.
 *
 * The pin lives in `#shared/pr-review/eval-fixture.ts` (`EVAL_FIXTURES_PIN`)
 * and is bumped via PR when the corpus is updated — bumping the pin is
 * what triggers the corpus version to change for the nightly cron.
 *
 * Activity contract: shallow-clone the fixtures repo at the pin, walk
 * `fixtures/<id>/`, Zod-parse each `fixture.json`, return `Fixture[]`
 * plus the resolved commit SHA (we persist the resolved SHA in
 * `eval_runs.fixture_commit_sha`).
 *
 * Auth: the fixtures repo is private. The temporal-worker pod mounts
 * `PR_REVIEW_FIXTURES_REPO_URL` and GitHub App credentials via 1Password
 * Connect. Clone authenticates via `GIT_ASKPASS` with a short-lived
 * installation token — never embeds the token in the URL.
 */
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import { FixtureSchema, type Fixture } from "#shared/pr-review/eval-fixture.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";

const FIXTURES_REPO_URL_ENV = "PR_REVIEW_FIXTURES_REPO_URL";
const COMPONENT = "pr-review-eval";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "loadFixtureCorpus",
      ...fields,
    }),
  );
}

/**
 * Write a tiny `git-askpass.sh` to `dir` that returns the GitHub token
 * when git asks for a password. Mirrors the helper in
 * `src/activities/data-dragon.ts` — same shape so the rest of the
 * monorepo's git-with-1Password-token pattern stays consistent.
 */
async function writeGitAskpass(dir: string): Promise<string> {
  const askpassPath = path.join(dir, "git-askpass.sh");
  await writeFile(
    askpassPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) echo "$GH_TOKEN" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(askpassPath, 0o755);
  return askpassPath;
}

export type LoadFixtureCorpusInput = {
  /**
   * Merge commit SHA (or ref) in the fixture corpus repository to load. The
   * nightly cron passes `EVAL_FIXTURES_PIN`.
   */
  pin: string;
};

export type FixtureGitEnv = {
  GH_TOKEN: string;
  GIT_ASKPASS: string;
  GIT_TERMINAL_PROMPT: "0";
};

export type FixtureGitCommand = {
  args: string[];
  cwd?: string;
  env: FixtureGitEnv;
};

export type FixtureGitRunner = (command: FixtureGitCommand) => Promise<string>;
export type FixtureCheckoutPhase = "clone" | "fetch-pin";
export type FixtureCheckoutHeartbeat = (event: {
  phase: FixtureCheckoutPhase;
}) => void;

function redactGitOutput(output: string, env: FixtureGitEnv): string {
  return output.split(env.GH_TOKEN).join("[redacted]");
}

export async function runFixtureGitCommand(
  command: FixtureGitCommand,
): Promise<string> {
  const spawnOptions = {
    stdin: "ignore" as const,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    env: {
      ...Bun.env,
      ...command.env,
    },
  };
  const proc = Bun.spawn(command.args, {
    ...spawnOptions,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.args.join(" ")} failed (exit ${String(exitCode)}): ${redactGitOutput(stderr, command.env)}`,
    );
  }
  return stdout;
}

export async function checkoutFixtureRepo(input: {
  fixturesRepoUrl: string;
  repoDir: string;
  pin: string;
  gitEnv: FixtureGitEnv;
  runGit?: FixtureGitRunner;
  heartbeat?: FixtureCheckoutHeartbeat;
}): Promise<string> {
  const runGit = input.runGit ?? runFixtureGitCommand;
  input.heartbeat?.({ phase: "clone" });
  await runGit({
    args: [
      "git",
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      input.fixturesRepoUrl,
      input.repoDir,
    ],
    env: input.gitEnv,
  });

  const initialRevparse = await runGit({
    args: ["git", "rev-parse", "HEAD"],
    cwd: input.repoDir,
    env: input.gitEnv,
  });
  const initialSha = initialRevparse.trim();

  if (input.pin === "" || input.pin === "main" || input.pin === initialSha) {
    return initialSha;
  }

  input.heartbeat?.({ phase: "fetch-pin" });
  await runGit({
    args: ["git", "fetch", "--depth", "1", "origin", input.pin],
    cwd: input.repoDir,
    env: input.gitEnv,
  });
  await runGit({
    args: ["git", "checkout", "FETCH_HEAD"],
    cwd: input.repoDir,
    env: input.gitEnv,
  });

  const pinnedRevparse = await runGit({
    args: ["git", "rev-parse", "HEAD"],
    cwd: input.repoDir,
    env: input.gitEnv,
  });
  return pinnedRevparse.trim();
}

export type LoadFixtureCorpusResult = {
  /** Resolved commit SHA (`git rev-parse HEAD` after checkout). */
  fixtureCommitSha: string;
  fixtures: Fixture[];
  /**
   * Scratch directory the clone landed in. Caller is responsible for
   * cleanup (calling `cleanup()`); we return the path so downstream
   * activities can read `pr.diff` files by `<scratchDir>/fixtures/<id>/pr.diff`
   * without re-cloning.
   */
  scratchDir: string;
};

async function loadFixtureCorpusImpl(
  input: LoadFixtureCorpusInput,
): Promise<LoadFixtureCorpusResult> {
  return await withSpan(
    "prReviewEval.loadFixtureCorpus",
    { "fixtures.pin": input.pin },
    async () => {
      const ghToken = await createGitHubAppInstallationToken();
      const fixturesRepoUrl = Bun.env[FIXTURES_REPO_URL_ENV]?.trim();
      if (fixturesRepoUrl === undefined || fixturesRepoUrl === "") {
        throw new Error(
          `${FIXTURES_REPO_URL_ENV} missing — required to clone the private fixtures repo`,
        );
      }

      const scratch = await mkdtemp(
        path.join(tmpdir(), "pr-review-eval-fixtures-"),
      );
      const askpass = await writeGitAskpass(scratch);
      const gitEnv: FixtureGitEnv = {
        GH_TOKEN: ghToken.token,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: "0",
      };

      jsonLog("info", "Cloning fixtures repo", { scratch, pin: input.pin });
      const repoDir = path.join(scratch, "repo");
      const activityContext = Context.current();
      const fixtureCommitSha = await checkoutFixtureRepo({
        fixturesRepoUrl,
        repoDir,
        pin: input.pin,
        gitEnv,
        heartbeat: (event) => {
          activityContext.heartbeat(event);
        },
      });
      jsonLog("info", "Fixtures repo checked out", { fixtureCommitSha });

      Context.current().heartbeat({ phase: "parse" });
      const fixturesDir = path.join(repoDir, "fixtures");
      const entries = await readdir(fixturesDir, { withFileTypes: true });
      const fixtures: Fixture[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const jsonPath = path.join(fixturesDir, entry.name, "fixture.json");
        let raw: string;
        try {
          raw = await readFile(jsonPath, "utf8");
        } catch {
          // Missing fixture.json — skeleton fixtures still under
          // construction. Skip silently; the catalog lists what's
          // expected, the workflow grades against what's present.
          continue;
        }
        const parsed = FixtureSchema.parse(JSON.parse(raw));
        fixtures.push(parsed);
      }
      jsonLog("info", "Loaded fixtures", {
        fixtureCommitSha,
        count: fixtures.length,
      });
      return { fixtureCommitSha, fixtures, scratchDir: repoDir };
    },
  );
}

/**
 * Cleanup activity — separate so the workflow can call it in a
 * try/finally pattern around the replay/grade work. Removing the
 * scratch dir frees disk on the worker; running in a separate activity
 * lets us retry / fail-soft.
 */
export type CleanupFixtureCorpusInput = {
  scratchDir: string;
};

async function cleanupFixtureCorpusImpl(
  input: CleanupFixtureCorpusInput,
): Promise<void> {
  await withSpan(
    "prReviewEval.cleanupFixtureCorpus",
    { "fixtures.scratchDir": input.scratchDir },
    async () => {
      jsonLog("info", "Cleaning up fixtures scratch dir", {
        scratchDir: input.scratchDir,
      });
      // The scratch dir is the parent of the cloned `repo/`. Remove
      // the parent so the askpass.sh and any temp files also go.
      const parent = path.dirname(input.scratchDir);
      await rm(parent, { recursive: true, force: true });
    },
  );
}

export type EvalLoadActivities = typeof evalLoadActivities;

export const evalLoadActivities = {
  async prReviewEvalLoadCorpus(
    input: LoadFixtureCorpusInput,
  ): Promise<LoadFixtureCorpusResult> {
    return loadFixtureCorpusImpl(input);
  },
  async prReviewEvalCleanupCorpus(
    input: CleanupFixtureCorpusInput,
  ): Promise<void> {
    return cleanupFixtureCorpusImpl(input);
  },
};
