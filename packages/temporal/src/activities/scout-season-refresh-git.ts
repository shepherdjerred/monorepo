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
    { cwd: repoDir },
  );
  return status
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
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
  await runCommand(["git", "checkout", "-B", input.branch], {
    cwd: input.repoDir,
  });
  await runCommand(["git", "add", "--", ...input.files], {
    cwd: input.repoDir,
  });
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
