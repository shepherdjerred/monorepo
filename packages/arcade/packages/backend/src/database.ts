import path from "node:path";
import { mkdir } from "node:fs/promises";
import { runtimeEnvironment } from "./runtime/environment.ts";

/** Prisma refuses destructive schema changes; never pass --accept-data-loss. */
export async function initializeDatabase(databasePath: string): Promise<void> {
  const backend = path.resolve(
    import.meta.dirname,
    "../../../../discord-plays-mario-kart/packages/backend",
  );
  await mkdir(path.dirname(databasePath), { recursive: true });
  const cli = Bun.resolveSync("prisma/build/index.js", backend);
  const child = Bun.spawn([process.execPath, cli, "db", "push"], {
    cwd: backend,
    env: {
      ...runtimeEnvironment(),
      DATABASE_URL: `file:${path.resolve(databasePath)}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("Arcade database initialization failed");
}
