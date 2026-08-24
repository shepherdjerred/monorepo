import { runCommand as defaultRunCommand } from "./data-dragon-shell.ts";
import { botCloneCacheDir } from "./bot-clone.ts";

const PRETTIER_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".snap",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".yaml",
  ".yml",
  ".graphql",
  ".gql",
  ".vue",
  ".astro",
]);

type RunCommand = typeof defaultRunCommand;

function fileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

export function generatedTextPaths(changedFiles: readonly string[]): string[] {
  return changedFiles
    .filter((path) => PRETTIER_EXTENSIONS.has(fileExtension(path)))
    .toSorted();
}

/**
 * Remove generated-file drift whose only difference is formatter output.
 *
 * Generators run against the current pinned toolchain, while the committed
 * artifact may have been produced by an older formatter. Formatting the
 * working file alone therefore still creates a proposal that changes no
 * generated value. Normalize both sides with the pinned formatter and restore
 * the file when the normalized bytes match. New files are never suppressed:
 * they have no committed baseline to compare.
 */
export async function discardFormattingOnlyChanges(input: {
  repoDir: string;
  changedFiles: readonly string[];
  component?: string;
  runCommand?: RunCommand;
}): Promise<string[]> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const textPaths: string[] = [];
  for (const path of generatedTextPaths(input.changedFiles)) {
    if (await Bun.file(`${input.repoDir}/${path}`).exists()) {
      textPaths.push(path);
    }
  }
  if (textPaths.length === 0) {
    return [];
  }

  const baselineDir = `${input.repoDir}/.context/formatting-baselines`;
  await runCommand(["mkdir", "-p", baselineDir], { cwd: input.repoDir });
  const reverted: string[] = [];
  for (const [index, path] of textPaths.entries()) {
    const tracked = await runCommand(["git", "ls-files", "--", path], {
      cwd: input.repoDir,
    });
    if (tracked.length === 0) {
      continue;
    }

    const baselinePath = `${baselineDir}/${String(index)}${fileExtension(path)}`;
    await Bun.write(
      baselinePath,
      await runCommand(["git", "show", `HEAD:${path}`], {
        cwd: input.repoDir,
        trimStdout: false,
      }),
    );
    const commandOptions = {
      cwd: input.repoDir,
      env: {
        ENVIRONMENT: undefined,
        BUN_INSTALL_CACHE_DIR: botCloneCacheDir(input.repoDir),
      },
    };
    await runCommand(
      [
        "bunx",
        "--no-install",
        "prettier",
        "--write",
        "--ignore-path",
        "/dev/null",
        "--",
        path,
        baselinePath,
      ],
      commandOptions,
    );

    const [current, baseline] = await Promise.all([
      Bun.file(`${input.repoDir}/${path}`).text(),
      Bun.file(baselinePath).text(),
    ]);
    if (current !== baseline) {
      continue;
    }
    await runCommand(["git", "restore", "--", path], {
      cwd: input.repoDir,
    });
    reverted.push(path);
  }
  if (reverted.length > 0) {
    console.warn(
      JSON.stringify({
        level: "info",
        msg: "Generated refresh discarded formatting-only changes",
        component: input.component ?? "temporal-generated-refresh",
        files: reverted,
      }),
    );
  }
  return reverted;
}

/**
 * Validate generated Scout output before it can become a remote proposal.
 *
 * The updater itself owns snapshot generation. This gate owns the quality
 * boundary between generated files and git publication: formatting, whitespace
 * errors, and the two focused checks that caught PR #2326's CI failure.
 */
export async function runScoutGeneratedPreflight(input: {
  repoDir: string;
  changedFiles: readonly string[];
  runCommand?: RunCommand;
}): Promise<void> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const commandOptions = {
    cwd: input.repoDir,
    env: {
      ENVIRONMENT: undefined,
      BUN_INSTALL_CACHE_DIR: botCloneCacheDir(input.repoDir),
    },
  };
  const textPaths: string[] = [];
  for (const path of generatedTextPaths(input.changedFiles)) {
    if (await Bun.file(`${input.repoDir}/${path}`).exists()) {
      textPaths.push(path);
    }
  }

  if (textPaths.length > 0) {
    await runCommand(
      [
        "bunx",
        "--no-install",
        "prettier",
        "--write",
        "--ignore-unknown",
        "--",
        ...textPaths,
      ],
      commandOptions,
    );
    await runCommand(
      [
        "bunx",
        "--no-install",
        "prettier",
        "--check",
        "--ignore-unknown",
        "--",
        ...textPaths,
      ],
      commandOptions,
    );
  }

  await runCommand(["git", "diff", "--check"], commandOptions);
  await runCommand(
    [
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "typecheck",
      "--filter=@scout-for-lol/design-system",
    ],
    commandOptions,
  );
  await runCommand(
    [
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "test",
      "--filter=@scout-for-lol/data",
    ],
    commandOptions,
  );
}
