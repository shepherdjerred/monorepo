import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { spawnCapture } from "#lib/spawn-capture.ts";

export type TempDirTracker = {
  readonly makeTempDir: (prefix: string) => Promise<string>;
  readonly trackDir: (dir: string) => string;
  readonly installGitSpiceShim: (
    baseEnv?: Readonly<Record<string, string | undefined>>,
  ) => Promise<Record<string, string | undefined>>;
};

export function registerTempDirs(): TempDirTracker {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const trackDir = (dir: string): string => {
    dirs.push(dir);
    return dir;
  };

  const makeTempDir = async (prefix: string): Promise<string> =>
    trackDir(await mkdtemp(path.join(os.tmpdir(), prefix)));

  const installGitSpiceShim = async (
    baseEnv: Readonly<Record<string, string | undefined>> = Bun.env,
  ): Promise<Record<string, string | undefined>> => {
    const binDir = await makeTempDir("toolkit-gs-shim-bin-");
    const shimSource = path.join(import.meta.dirname, "git-spice-shim.ts");
    const wrapperPath = path.join(binDir, "git-spice");
    await Bun.write(
      wrapperPath,
      `#!/bin/sh\nexec "${process.execPath}" "${shimSource}" "$@"\n`,
    );
    await chmod(wrapperPath, 0o755);
    const existingPath = baseEnv["PATH"] ?? "";
    return {
      ...baseEnv,
      PATH:
        existingPath.length > 0
          ? `${binDir}${path.delimiter}${existingPath}`
          : binDir,
    };
  };

  return { makeTempDir, trackDir, installGitSpiceShim };
}

export async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const { stdout, stderr, exitCode } = await spawnCapture(["git", ...args], {
    cwd,
  });
  if (exitCode !== 0) {
    const detail = stderr.length > 0 ? stderr : stdout;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return stdout.trim();
}

export function runGitSync(args: readonly string[], cwd: string): string {
  const res = Bun.spawnSync(["git", ...args], {
    cwd,
    env: Bun.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(res.exitCode)}): ${res.stderr.toString()}`,
    );
  }
  return res.stdout.toString().trim();
}

export async function seedSpiceDataRef(
  repoDir: string,
  repoConfig: Record<string, unknown>,
  branches: Record<string, Record<string, unknown>>,
  options: {
    readonly makeTempDir: (prefix: string) => Promise<string>;
    readonly continuations?: readonly Record<string, unknown>[] | undefined;
  },
): Promise<void> {
  const { makeTempDir, continuations } = options;
  const staging = await makeTempDir("toolkit-spice-stage-");
  await runGit(staging, ["init"]);
  await runGit(staging, ["config", "commit.gpgsign", "false"]);
  await runGit(staging, ["config", "user.email", "test@example.com"]);
  await runGit(staging, ["config", "user.name", "Toolkit Test"]);
  await Bun.write(path.join(staging, "repo"), JSON.stringify(repoConfig));
  for (const [name, payload] of Object.entries(branches)) {
    const filePath = path.join(staging, "branches", ...name.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify(payload));
  }
  if (continuations !== undefined) {
    await Bun.write(
      path.join(staging, "rebase-continue"),
      JSON.stringify({ continuations }),
    );
  }
  await runGit(staging, ["add", "."]);
  await runGit(staging, ["commit", "-m", "spice data"]);
  const commitSha = await runGit(staging, ["rev-parse", "HEAD"]);
  await runGit(repoDir, ["fetch", staging, commitSha]);
  await runGit(repoDir, ["update-ref", "refs/spice/data", commitSha]);
}
