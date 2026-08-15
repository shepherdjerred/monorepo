import { parsePorcelainPaths } from "#shared/porcelain.ts";
import { disarmGitHooks } from "./bot-clone.ts";

type GitRunBaseOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
  // Trailing-whitespace trimming is on by default because nearly every caller
  // wants a bare value (a sha, a branch name, a URL). `git status --porcelain`
  // is the exception: its first line can legitimately begin with a space, so
  // porcelain readers MUST opt out. Mirrors data-dragon-shell.ts's runCommand.
  trimStdout?: boolean;
};

export type GitRunOptions = GitRunBaseOptions &
  (
    | { redactOutput: true; operation: string }
    | { redactOutput?: false; operation?: never }
  );

export async function runCommand(
  command: string[],
  options: GitRunOptions,
): Promise<string> {
  const clearedEnvKeys = new Set(
    Object.entries(options.env ?? {})
      .filter(([, value]) => value === undefined)
      .map(([key]) => key),
  );
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !clearedEnvKeys.has(key)) {
      childEnv[key] = value;
    }
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output =
      options.redactOutput === true
        ? "<redacted>"
        : `${stdout}\n${stderr}`.trim();
    throw new Error(
      `Command failed (${options.redactOutput === true ? options.operation : (command[0] ?? "?")}): exit ${String(exitCode)} ${output}`,
    );
  }
  return options.trimStdout === false ? stdout : stdout.trim();
}

export type GitCommandRunner = typeof runCommand;

export async function writeGitAskpass(tempDir: string): Promise<string> {
  const path = `${tempDir}/git-askpass.sh`;
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
  await runCommand(["chmod", "+x", path], { cwd: tempDir });
  return path;
}

export async function changedFilesInPaths(
  repoDir: string,
  paths: readonly string[],
): Promise<string[]> {
  const status = await runCommand(
    ["git", "status", "--porcelain", "--", ...paths],
    // trimStdout: false so porcelain v1's leading-space status code survives —
    // without it the FIRST path comes back missing its first character, which
    // silently broke every `files[0] === CONSTANT` / `files.includes(CONSTANT)`
    // check downstream. See shared/porcelain.ts.
    { cwd: repoDir, trimStdout: false },
  );
  return parsePorcelainPaths(status);
}

export async function getUnifiedDiff(
  repoDir: string,
  paths: readonly string[],
): Promise<string> {
  return await runCommand(
    ["git", "-c", "core.pager=cat", "diff", "--no-color", "--", ...paths],
    { cwd: repoDir },
  );
}

/**
 * True when a unified diff's only content changes are a generator's
 * `generatedAt` timestamp line. Several committed artifacts in this repo are
 * deterministic apart from that stamp, so a run against unchanged sources
 * dirties exactly that line — treat it as no drift rather than opening a churn
 * PR every week. Shared by the marketing-showcase refresh and the Data Dragon
 * lane-prior artifacts. Precedent: shouldCreateDataDragonPr's image-only
 * suppression.
 *
 * An empty diff returns false: "nothing changed" is not a timestamp-only
 * change, and callers distinguish the two.
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

/**
 * Restore any of `paths` whose working-tree diff is nothing but a `generatedAt`
 * stamp, leaving genuinely-changed files alone. Each path is diffed on its own:
 * a combined diff would let one file's real change mask another's pure churn.
 */
export async function revertGeneratedAtOnlyChanges(
  repoDir: string,
  paths: readonly string[],
): Promise<string[]> {
  const reverted: string[] = [];
  for (const path of paths) {
    const diff = await getUnifiedDiff(repoDir, [path]);
    if (!isGeneratedAtOnlyDiff(diff)) {
      continue;
    }
    await runCommand(["git", "checkout", "--", path], { cwd: repoDir });
    reverted.push(path);
  }
  return reverted;
}

export type OpenPrInput = {
  repoDir: string;
  tempDir: string;
  branch: string;
  title: string;
  body: string;
  files: readonly string[];
  ghToken: string;
  repoSlug: string;
  mainBranch: string;
};

export type OpenPrResult = {
  commitHash: string;
  prUrl: string;
};

export type SeasonRefreshPrLocator = Pick<
  OpenPrInput,
  "repoDir" | "branch" | "ghToken" | "repoSlug"
>;

export async function findOpenSeasonRefreshPr(
  input: SeasonRefreshPrLocator,
  commandRunner: GitCommandRunner = runCommand,
): Promise<string | undefined> {
  const output = await commandRunner(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      input.repoSlug,
      "--head",
      input.branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      '.[0].url // ""',
    ],
    {
      cwd: input.repoDir,
      env: { GH_TOKEN: input.ghToken },
      redactOutput: true,
      operation: "pr-list",
    },
  );
  const prUrl = output.trim();
  return prUrl.length > 0 ? prUrl : undefined;
}

export async function refreshSeasonRefreshPrMetadata(
  input: Pick<
    OpenPrInput,
    "repoDir" | "ghToken" | "repoSlug" | "title" | "body"
  >,
  prUrl: string,
  commandRunner: GitCommandRunner = runCommand,
): Promise<void> {
  await commandRunner(
    [
      "gh",
      "pr",
      "edit",
      prUrl,
      "--repo",
      input.repoSlug,
      "--title",
      input.title,
      "--body",
      input.body,
    ],
    {
      cwd: input.repoDir,
      env: { GH_TOKEN: input.ghToken },
      redactOutput: true,
      operation: "pr-edit",
    },
  );
}

export async function closeSeasonRefreshPr(
  input: SeasonRefreshPrLocator & { reason: string },
  commandRunner: GitCommandRunner = runCommand,
): Promise<string | undefined> {
  const prUrl = await findOpenSeasonRefreshPr(input, commandRunner);
  if (prUrl === undefined) {
    return undefined;
  }
  await commandRunner(
    [
      "gh",
      "pr",
      "close",
      prUrl,
      "--repo",
      input.repoSlug,
      "--comment",
      input.reason,
      "--delete-branch",
    ],
    {
      cwd: input.repoDir,
      env: { GH_TOKEN: input.ghToken },
      redactOutput: true,
      operation: "pr-close",
    },
  );
  return prUrl;
}

/**
 * Refuse to force-push over a proposal branch someone else has committed to.
 *
 * The push below is `--force-with-lease`, which only proves the ref has not
 * moved since our fetch. It cannot protect the CONTENT, because the commit is
 * built by `git checkout -B` from a fresh main clone — the fetched
 * `origin/<branch>` is never used as a base. So an operator who commits an
 * adjudication onto an open proposal PR has that work silently destroyed by the
 * next run that lands on the same branch.
 *
 * The test is the remote tip's author AND committer, compared against the pair
 * our own commit just used rather than hardcoded addresses, so `GIT_AUTHOR_EMAIL`
 * overriding the repo config cannot make the bot fail to recognise itself.
 *
 * Both halves are load-bearing. `git commit --amend` keeps the original author
 * and records the amender as committer, so an operator who edits the generated
 * commit in place — rather than adding one on top — leaves an author that still
 * says "bot". Checking the author alone would wave that straight through, which
 * is the most likely way someone would actually tweak a proposal.
 *
 * Two alternatives do not work here, both for reasons worth recording:
 *   - Comparing the tree we are about to push against the remote tree flags
 *     every legitimate regeneration. A branch derived from workflow args
 *     (`scout-season-refresh`) keeps its name while its content changes, so
 *     "the tree differs" is the normal case, not the dangerous one.
 *   - Counting commits the branch has over main needs history the bot does not
 *     fetch: `scout-season-refresh` clones `--depth 1`.
 * Only the tip commit is guaranteed present, and its author answers the actual
 * question — did anyone other than us write what is on this branch.
 */
export async function assertRemoteBranchIsOurs(
  input: Pick<OpenPrInput, "repoDir" | "branch">,
): Promise<void> {
  // "<author> / <committer>" — an amend changes only the second.
  const identityOf = async (rev: string): Promise<string> =>
    runCommand(["git", "log", "-1", "--format=%ae / %ce", rev], {
      cwd: input.repoDir,
    });
  const ours = await identityOf("HEAD");
  const theirs = await identityOf(`refs/remotes/origin/${input.branch}`);
  if (theirs !== ours) {
    throw new Error(
      `refusing to force-push ${input.branch}: its tip is authored/committed by ${theirs}, not by this bot (${ours}). ` +
        "Someone has edited this proposal branch; force-pushing would destroy that work. " +
        "Merge or close the open PR, or delete the branch, and the next run will republish.",
    );
  }
}

export async function openSeasonRefreshPr(
  input: OpenPrInput,
): Promise<OpenPrResult> {
  const askpass = await writeGitAskpass(input.tempDir);
  const gitEnv = {
    GH_TOKEN: input.ghToken,
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
  };

  await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
    cwd: input.repoDir,
  });
  await runCommand(["git", "config", "user.name", "CI Bot"], {
    cwd: input.repoDir,
  });
  // A retry (or a later scheduled run reusing an open proposal branch) starts
  // from a shallow main-only clone. Fetch the existing branch first so
  // --force-with-lease has an actual remote-tracking value to protect against
  // overwriting a concurrent update.
  const remoteBranch = await runCommand(
    ["git", "ls-remote", "--heads", "origin", input.branch],
    {
      cwd: input.repoDir,
      env: gitEnv,
      redactOutput: true,
      operation: "branch-discovery",
    },
  );
  if (remoteBranch.length > 0) {
    await runCommand(
      [
        "git",
        "fetch",
        "origin",
        `refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
      ],
      {
        cwd: input.repoDir,
        env: gitEnv,
        redactOutput: true,
        operation: "branch-fetch",
      },
    );
  }
  await runCommand(["git", "checkout", "-B", input.branch], {
    cwd: input.repoDir,
  });
  await runCommand(["git", "add", "--", ...input.files], {
    cwd: input.repoDir,
  });
  // Disarm hooks right before the commit, not just via rootInstallWithoutHooks
  // earlier — an agentic Claude/Codex step upstream of this call may have
  // armed them on its own initiative (e.g. running a plain `bun install`).
  await disarmGitHooks(input.repoDir);
  await runCommand(["git", "commit", "-m", input.title], {
    cwd: input.repoDir,
  });
  const commitHash = await runCommand(["git", "rev-parse", "HEAD"], {
    cwd: input.repoDir,
  });
  if (remoteBranch.length > 0) {
    await assertRemoteBranchIsOurs(input);
  }
  await runCommand(
    ["git", "push", "--force-with-lease", "origin", input.branch],
    {
      cwd: input.repoDir,
      env: gitEnv,
      redactOutput: true,
      operation: "branch-push",
    },
  );
  // Idempotency across activity retries: if a PR for this head branch already
  // exists (a prior attempt created it, then timed out or the worker died
  // before Temporal recorded completion), reuse it instead of creating a
  // duplicate. The force-with-lease push above already updated its branch.
  const existingPrUrl = await findOpenSeasonRefreshPr(input);
  if (existingPrUrl !== undefined) {
    // The shared branch can carry new edits, warnings, patch-note evidence, or
    // auto-merge guidance on a later scheduled run. Keep the review context in
    // lockstep with the pushed diff instead of returning yesterday's metadata.
    await refreshSeasonRefreshPrMetadata(input, existingPrUrl);
    return { commitHash, prUrl: existingPrUrl };
  }
  const prUrl = await runCommand(
    [
      "gh",
      "pr",
      "create",
      "--repo",
      input.repoSlug,
      "--base",
      input.mainBranch,
      "--head",
      input.branch,
      "--title",
      input.title,
      "--body",
      input.body,
    ],
    {
      cwd: input.repoDir,
      env: { GH_TOKEN: input.ghToken },
      redactOutput: true,
      operation: "pr-create",
    },
  );
  return { commitHash, prUrl };
}
