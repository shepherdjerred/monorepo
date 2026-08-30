import { mkdir, rm } from "node:fs/promises";
import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";

export async function acquireWorkerDeploymentLock(
  catalogPath: string,
  lockName: string,
  run: RolloutCommandRunner,
): Promise<() => Promise<void>> {
  const lockPath = `${catalogPath}.rollout-lock`;
  const remoteLockRef = `refs/temporal-worker-deployment-locks/${lockName}`;
  try {
    await mkdir(lockPath);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another Temporal Worker Deployment rollout is active", {
        cause: error,
      });
    }
    throw new Error("Unable to acquire Temporal Worker Deployment lock", {
      cause: error,
    });
  }
  try {
    await run([
      "git",
      "push",
      `--force-with-lease=${remoteLockRef}:`,
      "origin",
      `HEAD:${remoteLockRef}`,
    ]);
  } catch (error: unknown) {
    await rm(lockPath, { recursive: true, force: true });
    throw new Error("Another Temporal Worker Deployment rollout is active", {
      cause: error,
    });
  }
  return async () => {
    try {
      await rm(lockPath, { recursive: true, force: true });
    } finally {
      await run(["git", "push", "origin", `:${remoteLockRef}`]);
    }
  };
}
