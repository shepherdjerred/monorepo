import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
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

  // Prisma's generated @prisma/client/default.js requires
  // ".prisma/client/default" relative to @prisma/client. On the deployed Bun
  // image, that package-local path was not resolving to node_modules/.prisma,
  // so make the expected package-local link explicit after generation.
  const clientDir = fileURLToPath(
    new URL("../node_modules/@prisma/client", import.meta.url),
  );
  const linkPath = `${clientDir}/.prisma`;
  await mkdir(path.dirname(linkPath), { recursive: true });
  await rm(linkPath, { recursive: true, force: true });
  await symlink("../../.prisma", linkPath, "dir");
} finally {
  await releaseGenerateLock();
}
