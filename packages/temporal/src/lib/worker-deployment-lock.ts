import { mkdir, rm } from "node:fs/promises";

export async function acquireWorkerDeploymentLock(
  catalogPath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${catalogPath}.rollout-lock`;
  try {
    await mkdir(lockPath);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another Temporal Worker Deployment rollout is active");
    }
    throw new Error("Unable to acquire Temporal Worker Deployment lock", {
      cause: error,
    });
  }
  return async () => {
    await rm(lockPath, { recursive: true, force: true });
  };
}
