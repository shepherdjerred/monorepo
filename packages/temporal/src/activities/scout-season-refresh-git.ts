import { disarmGitHooks } from "./bot-clone.ts";

export type GitRunOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
  redactOutput?: boolean;
};

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
      `Command failed (${command[0] ?? "?"}): exit ${String(exitCode)} ${output}`,
    );
  }
  return stdout.trim();
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

// Porcelain v1 lines are `XY<space>PATH` — a 2-char status field plus one
// space, so the path always starts at index 3. Do NOT trim first: a
// worktree-modified file is ` M path` (leading space), and trimming would
// shift the slice one character into the path.
export function parsePorcelainPaths(status: string): string[] {
  return status
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3));
}

export async function changedFilesInPaths(
  repoDir: string,
  paths: readonly string[],
): Promise<string[]> {
  const status = await runCommand(
    ["git", "status", "--porcelain", "--", ...paths],
    { cwd: repoDir },
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
    },
  );
  return prUrl;
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
    { cwd: input.repoDir, env: gitEnv, redactOutput: true },
  );
  if (remoteBranch.length > 0) {
    await runCommand(
      [
        "git",
        "fetch",
        "origin",
        `refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
      ],
      { cwd: input.repoDir, env: gitEnv, redactOutput: true },
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
  await runCommand(
    ["git", "push", "--force-with-lease", "origin", input.branch],
    {
      cwd: input.repoDir,
      env: gitEnv,
      redactOutput: true,
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
    },
  );
  return { commitHash, prUrl };
}
