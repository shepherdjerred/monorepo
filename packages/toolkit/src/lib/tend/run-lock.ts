import { mkdir, open, rm } from "node:fs/promises";
import { z } from "zod";
import {
  formatDurationCompact,
  resolveTendPaths,
  type TendPaths,
} from "./paths.ts";
import {
  isProcessAliveByKillZero,
  processStartsMatch,
  readSingleProcessStart,
} from "./process-probe.ts";
import type { CommandRunner } from "./types.ts";

/** Another applied run holds the lock and its owner is alive. */
export class TendRunLockHeldError extends Error {}

const LockOwnerSchema = z.strictObject({
  pid: z.number().int().positive(),
  processStart: z.string().min(1),
  acquiredAt: z.string(),
});

function isEexistError(error: unknown): boolean {
  const parsed = z.looseObject({ code: z.string() }).safeParse(error);
  return parsed.success && parsed.data.code === "EEXIST";
}

export async function acquireTendRunLock(options: {
  readonly paths?: TendPaths | undefined;
  readonly ownerPid?: number | undefined;
  readonly processStart?: string | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly isPidAlive?: ((pid: number) => boolean) | undefined;
  readonly readPidStart?:
    ((pid: number) => Promise<string | undefined>) | undefined;
}): Promise<() => Promise<void>> {
  const paths = options.paths ?? resolveTendPaths();
  const ownerPid = options.ownerPid ?? process.pid;
  const checkAlive = options.isPidAlive ?? isProcessAliveByKillZero;
  const readStart =
    options.readPidStart ??
    ((pid: number) =>
      readSingleProcessStart(pid, {
        runner: options.runner,
        platform: options.platform,
      }));
  const ownStart =
    options.processStart ??
    (await readStart(ownerPid)) ??
    `unknown-${String(ownerPid)}`;

  await mkdir(paths.rootDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockFile, "wx", 0o600);
      try {
        const payload = JSON.stringify({
          pid: ownerPid,
          processStart: ownStart,
          acquiredAt: new Date().toISOString(),
        });
        await handle.writeFile(`${payload}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return () => rm(paths.lockFile, { force: true });
    } catch (error: unknown) {
      if (!isEexistError(error)) {
        throw error;
      }
      if (attempt > 0) {
        break;
      }
      if (!(await isLockFileStale(paths.lockFile, checkAlive, readStart))) {
        throw new TendRunLockHeldError(
          `Another toolkit tend --apply run is active (${paths.lockFile})`,
          { cause: error },
        );
      }
      await rm(paths.lockFile, { force: true });
    }
  }
  throw new Error(`Could not acquire toolkit tend lock at ${paths.lockFile}`);
}

async function isLockFileStale(
  lockFile: string,
  checkAlive: (pid: number) => boolean,
  readStart: (pid: number) => Promise<string | undefined>,
): Promise<boolean> {
  try {
    const text = await Bun.file(lockFile).text();
    const parsed = LockOwnerSchema.safeParse(JSON.parse(text));
    if (!parsed.success || !checkAlive(parsed.data.pid)) {
      return true;
    }
    if (parsed.data.processStart.startsWith("unknown-")) {
      return false;
    }
    const currentStart = await readStart(parsed.data.pid);
    return currentStart === undefined
      ? !checkAlive(parsed.data.pid)
      : !processStartsMatch(currentStart, parsed.data.processStart);
  } catch {
    return true;
  }
}

/** Clock and sleep for the lock wait; replaced in tests. */
export type LockTiming = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

const LOCK_POLL_MS = 1000;

/**
 * Take the run lock, waiting up to `waitMs` for the run that holds it. With
 * no wait this fails at once, as `acquireTendRunLock` does. Staleness is
 * decided by `acquireTendRunLock` on every attempt, so a holder that dies
 * while this waits is taken over on the next poll.
 */
export async function acquireTendRunLockWaiting(
  options: Parameters<typeof acquireTendRunLock>[0] & {
    readonly waitMs?: number | undefined;
    readonly timing?: LockTiming | undefined;
  },
): Promise<() => Promise<void>> {
  const waitMs = options.waitMs ?? 0;
  const timing = options.timing ?? {
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
  };
  const startedMs = timing.now();
  for (;;) {
    try {
      return await acquireTendRunLock(options);
    } catch (error: unknown) {
      if (!(error instanceof TendRunLockHeldError)) {
        throw error;
      }
      const waitedMs = timing.now() - startedMs;
      if (waitMs <= 0) {
        throw error;
      }
      if (waitedMs >= waitMs) {
        throw new TendRunLockHeldError(
          `${error.message}; gave up after waiting ${formatDurationCompact(waitedMs)}`,
          { cause: error },
        );
      }
      await timing.sleep(Math.min(LOCK_POLL_MS, waitMs - waitedMs));
    }
  }
}
