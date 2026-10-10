import { Database } from "bun:sqlite";
import { realpath } from "node:fs/promises";
import path from "node:path";

/** Serialize a whole tournament while allowing its own short publications. */
export async function withKnockoutLock<T>(
  dir: string,
  action: () => Promise<T>,
): Promise<T> {
  const owner = await realpath(dir);
  const lock = new Database(path.join(owner, ".knockout-lock.sqlite"), {
    create: true,
  });
  try {
    try {
      lock.run("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "SQLITE_BUSY"
      )
        throw new Error(
          `knockout already running for ${owner}; retry when it finishes`,
          { cause: error },
        );
      throw error;
    }
    return await action();
  } finally {
    lock.close(true);
  }
}
