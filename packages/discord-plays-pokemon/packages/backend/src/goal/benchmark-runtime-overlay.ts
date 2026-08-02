import path from "node:path";
import { cp, lstat, mkdir } from "node:fs/promises";

export const REQUIRED_CODEX_INSTRUCTION_PATHS = ["AGENTS.md"] as const;
export const OPTIONAL_CODEX_INSTRUCTION_PATHS = [".agents"] as const;

const REQUIRED_RUNTIME_PATHS = [
  ...REQUIRED_CODEX_INSTRUCTION_PATHS,
  "packages/backend/package.json",
  "packages/backend/src/game/battle/generated",
  "packages/backend/src/goal",
  "packages/backend/node_modules/zod",
] as const;

const OPTIONAL_RUNTIME_PATHS = OPTIONAL_CODEX_INSTRUCTION_PATHS;
const POKEMONCTL_RELATIVE_PATH = "packages/backend/src/goal/pokemonctl.ts";

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function copyRuntimePath(
  implementationRoot: string,
  runtimeDirectory: string,
  relativePath: string,
  required: boolean,
): Promise<void> {
  const source = path.join(implementationRoot, relativePath);
  if (!(await pathExists(source))) {
    if (required) {
      throw new Error(`implementation runtime file not found: ${source}`);
    }
    return;
  }
  await cp(source, path.join(runtimeDirectory, relativePath), {
    dereference: true,
    errorOnExist: true,
    force: false,
    recursive: true,
  });
}

async function reserveRuntimeDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `refusing to reuse existing benchmark runtime overlay directory: ${directory}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function benchmarkRuntimeOverlayDirectory(
  implementationRoot: string,
  runDirectory: string,
): string {
  const runtimeDirectory = path.join(runDirectory, "runtime");
  if (pathIsInside(implementationRoot, runtimeDirectory)) {
    throw new Error(
      `benchmark runtime overlay must be outside the target implementation: ${runtimeDirectory}`,
    );
  }
  return runtimeDirectory;
}

export async function prepareBenchmarkRuntimeOverlay(
  implementationRoot: string,
  runDirectory: string,
): Promise<string> {
  const runtimeDirectory = benchmarkRuntimeOverlayDirectory(
    implementationRoot,
    runDirectory,
  );
  const pokemonctlSource = path.join(
    implementationRoot,
    POKEMONCTL_RELATIVE_PATH,
  );
  if (!(await pathExists(pokemonctlSource))) {
    throw new Error(
      `implementation pokemonctl entrypoint not found: ${pokemonctlSource}`,
    );
  }
  await reserveRuntimeDirectory(runtimeDirectory);
  for (const relativePath of REQUIRED_RUNTIME_PATHS) {
    await copyRuntimePath(
      implementationRoot,
      runtimeDirectory,
      relativePath,
      true,
    );
  }
  for (const relativePath of OPTIONAL_RUNTIME_PATHS) {
    await copyRuntimePath(
      implementationRoot,
      runtimeDirectory,
      relativePath,
      false,
    );
  }
  return runtimeDirectory;
}
