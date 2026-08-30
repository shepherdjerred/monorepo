import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";

function getRemoteLockRef(lockName: string): string {
  return `refs/temporal-worker-deployment-locks/${lockName}`;
}

export async function readWorkerDeploymentLock(
  lockName: string,
  run: RolloutCommandRunner,
): Promise<string | undefined> {
  const ref = getRemoteLockRef(lockName);
  const result = await run(["git", "ls-remote", "origin", ref]);
  const line = result.stdout.trim();
  if (line.length === 0) {
    return undefined;
  }
  const fields = line.split(/\s+/u);
  const object = fields[0];
  if (object === undefined || fields.length !== 2 || fields[1] !== ref) {
    throw new Error(`Remote Temporal rollout lock returned an invalid ${ref}`);
  }
  if (!/^[a-f0-9]{40}$/u.test(object)) {
    throw new Error(`Remote Temporal rollout lock returned an invalid ${ref}`);
  }
  return object;
}

export async function acquireWorkerDeploymentLock(
  catalogPath: string,
  lockName: string,
  run: RolloutCommandRunner,
): Promise<() => Promise<void>> {
  const lockPath = `${catalogPath}.rollout-lock`;
  const remoteLockRef = getRemoteLockRef(lockName);
  const lockCommit = await run([
    "git",
    "-c",
    "user.name=Temporal Rollout Lock",
    "-c",
    "user.email=temporal-rollout@localhost",
    "commit-tree",
    "HEAD^{tree}",
    "-p",
    "HEAD",
    "-m",
    `Temporal rollout lock ${lockName} ${randomUUID()}`,
  ]);
  const lockObject = lockCommit.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(lockObject)) {
    throw new Error("Temporal rollout lock returned an invalid commit");
  }
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
      `${lockObject}:${remoteLockRef}`,
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
      await run([
        "git",
        "push",
        `--force-with-lease=${remoteLockRef}:${lockObject}`,
        "origin",
        `:${remoteLockRef}`,
      ]);
    }
  };
}
