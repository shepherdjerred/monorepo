import { mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const lockParent = fileURLToPath(new URL("../node_modules", import.meta.url));
const lockDir = `${lockParent}/.prisma-generate.lock`;
const pidPath = `${lockDir}/pid`;

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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return getErrorCode(error) !== "ESRCH";
  }
}

async function checkStaleLock(
  pidFile: string,
  targetDir: string,
): Promise<string | null> {
  const file = Bun.file(pidFile);
  if (await file.exists()) {
    const content = await file.text();
    const pid = Number(content.trim());
    if (Number.isNaN(pid) || !Number.isInteger(pid) || pid <= 0) {
      return `invalid PID "${content.trim()}" in lock`;
    }
    return isProcessAlive(pid)
      ? null
      : `process ${String(pid)} is dead (ESRCH)`;
  }

  try {
    const stats = await stat(targetDir);
    if (Date.now() - stats.mtimeMs > 1000) {
      return "lock directory has been abandoned with no PID file";
    }
  } catch {
    // targetDir may have been removed concurrently.
  }
  return null;
}

async function acquireGenerateLock(): Promise<() => Promise<void>> {
  await mkdir(lockParent, { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      await Bun.write(pidPath, String(process.pid));

      const onSignal = () => {
        void (async () => {
          try {
            await rm(lockDir, { recursive: true, force: true });
          } finally {
            process.exit(1);
          }
        })();
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);

      return async () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (getErrorCode(error) !== "EEXIST") {
        throw error;
      }

      const staleReason = await checkStaleLock(pidPath, lockDir);
      if (staleReason !== null) {
        console.warn(`Removing stale Prisma generation lock (${staleReason})`);
        await rm(lockDir, { recursive: true, force: true });
        continue;
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
  const generate = Bun.spawn(
    ["bun", "x", "--no-install", "--trust", "prisma", "generate"],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await generate.exited;
  if (exitCode !== 0) {
    throw new Error(`prisma generate exited with code ${String(exitCode)}`);
  }
} finally {
  await releaseGenerateLock();
}
