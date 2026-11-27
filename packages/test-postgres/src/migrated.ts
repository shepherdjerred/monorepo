import { envWithPostgresBin, runCommandAsync } from "./binaries.ts";
import { createEmptyTestDatabase } from "./databases.ts";
import type { OwnedTestDatabaseHandle } from "./databases.ts";
import { ensureSharedPostgres } from "./server.ts";
import type { TestDatabasePrefix } from "./sweep.ts";

/**
 * Creates an empty owned test database and applies the package's Prisma
 * migrations to it with `bun run migrate:deploy`. A failed migration drops the
 * database and throws with the command's output, so a broken migration fails
 * the suite loudly instead of leaving a half-built database behind.
 */
export async function createMigratedTestDatabase(options: {
  readonly prefix: TestDatabasePrefix;
  readonly packageRoot: string;
  readonly packageName: string;
}): Promise<OwnedTestDatabaseHandle> {
  const shared = ensureSharedPostgres();
  const handle = await createEmptyTestDatabase({
    prefix: options.prefix,
    kind: "test",
    adminUrl: shared.superUrl,
  });
  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: options.packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: handle.url }),
  });
  if (migrate.exitCode !== 0) {
    await handle.drop();
    throw new Error(
      `${options.packageName} prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  }
  return handle;
}
