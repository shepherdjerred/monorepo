import { mkdir, rm } from "node:fs/promises";
import {
  maintenanceCommandEnvironment,
  spawnMaintenanceCommand,
  spawnMaintenanceCommandCapturingStdout,
  type MaintenanceCommand,
  type MaintenanceCommandHooks,
  type MaintenanceSubprocessKind,
} from "./maintenance.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const MAIN_BRANCH = "main";

function command(
  kind: MaintenanceSubprocessKind,
  commandArgs: readonly string[],
  cwd: string,
): MaintenanceCommand {
  return {
    kind,
    command: commandArgs,
    cwd,
    env: maintenanceCommandEnvironment({}),
    secretValues: [],
  };
}

export type MainRepositoryScanContext = {
  repoDir: string;
  repoSha: string;
};

/**
 * Clone public `main` into per-attempt scratch space and run a scanner against
 * that exact revision. The scratch directory is always removed so retries
 * cannot reuse a partial clone or accumulate repository data on the worker.
 */
export async function withMainRepositoryScan<T>(
  kind: MaintenanceSubprocessKind,
  hooks: MaintenanceCommandHooks,
  scan: (context: MainRepositoryScanContext) => Promise<T>,
): Promise<T> {
  const tempDir = `/tmp/${kind}-${crypto.randomUUID()}`;
  const repoDir = `${tempDir}/monorepo`;
  await mkdir(tempDir, { recursive: true });
  try {
    await spawnMaintenanceCommand(
      command(
        kind,
        [
          "git",
          "clone",
          "--depth",
          "1",
          "--branch",
          MAIN_BRANCH,
          "--single-branch",
          REPO_URL,
          repoDir,
        ],
        tempDir,
      ),
      hooks,
    );
    const revision = await spawnMaintenanceCommandCapturingStdout(
      command(kind, ["git", "rev-parse", "HEAD"], repoDir),
      hooks,
    );
    const repoSha = revision.stdout.trim();
    if (repoSha === "") {
      throw new Error("git rev-parse HEAD returned no commit for the clone");
    }
    return await scan({ repoDir, repoSha });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function mainRepositoryScanCommand(
  kind: MaintenanceSubprocessKind,
  commandArgs: readonly string[],
  cwd: string,
): MaintenanceCommand {
  return command(kind, commandArgs, cwd);
}
