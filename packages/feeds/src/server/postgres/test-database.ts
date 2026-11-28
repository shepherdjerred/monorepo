import path from "node:path";
import {
  currentDatabaseOwner,
  databaseUrlFromAdmin,
  ensureSharedPostgres,
  envWithPostgresBin,
  ownerCommentSql,
  psqlMaintenanceCommandsAsync,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";

const packageRoot = path.resolve(import.meta.dir, "../../..");

/**
 * A database on the shared test PostgreSQL with Feeds' migrations applied,
 * for the extended-tier integration suites.
 */
export async function createMigratedTestDatabase(): Promise<{
  readonly databaseUrl: string;
  readonly drop: () => Promise<void>;
}> {
  const { superUrl } = ensureSharedPostgres();
  const dbName = `feeds_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const databaseUrl = databaseUrlFromAdmin(superUrl, dbName);
  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${dbName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
    ],
    { adminUrl: superUrl },
  );
  const drop = async (): Promise<void> => {
    await psqlMaintenanceCommandsAsync(
      [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
      { adminUrl: superUrl },
    );
  };
  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: databaseUrl }),
  });
  if (migrate.exitCode !== 0) {
    await drop();
    const detail = migrate.stderr.length > 0 ? migrate.stderr : migrate.stdout;
    throw new Error(`feeds prisma migrate deploy failed: ${detail}`);
  }
  return { databaseUrl, drop };
}
