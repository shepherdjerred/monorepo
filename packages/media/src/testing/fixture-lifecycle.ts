import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "./postgres.ts";

/** Each scenario owns its database and directories, including failed setup. */
export async function createFixtureLifecycle() {
  const cluster = await startMediaTestPostgres();
  const directories: string[] = [];
  const close = async () => {
    try {
      await cluster.close();
    } finally {
      for (const directory of directories)
        await rm(directory, { recursive: true, force: true });
    }
  };
  return { db: cluster.database, directories, close };
}
