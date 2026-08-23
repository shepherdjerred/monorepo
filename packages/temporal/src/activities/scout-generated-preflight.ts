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
]);

type RunCommand = typeof defaultRunCommand;

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

export function generatedTextPaths(changedFiles: readonly string[]): string[] {
  return changedFiles
    .filter((path) => PRETTIER_EXTENSIONS.has(extension(path)))
    .toSorted();
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
