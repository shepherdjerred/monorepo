import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const lockParent = fileURLToPath(new URL("../node_modules", import.meta.url));
const lockDir = `${lockParent}/.prisma-generate.lock`;

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error == null) {
    return undefined;
  }
  if (!("code" in error)) {
    return undefined;
  }
  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

async function acquireGenerateLock(): Promise<() => Promise<void>> {
  await mkdir(lockParent, { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (getErrorCode(error) !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt > 120_000) {
        throw new Error("Timed out waiting for Prisma generation lock", {
          cause: error,
        });
      }
      await Bun.sleep(100);
    }
  }
}

const releaseGenerateLock = await acquireGenerateLock();
try {
  const generate = Bun.spawn(["bunx", "--trust", "prisma", "generate"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await generate.exited;
  if (exitCode !== 0) {
    throw new Error(`prisma generate exited with code ${String(exitCode)}`);
  }
} finally {
  await releaseGenerateLock();
}
