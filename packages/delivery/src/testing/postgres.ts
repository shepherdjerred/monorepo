import path from "node:path";
import {
  createEmptyTestDatabase,
  createTemplateTestDatabase,
  postgresBinaryPath,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { createDatabase } from "#infrastructure/database.ts";
import { registerTestServices } from "./services.ts";

const migrationsRoot = new URL("../../prisma/migrations/", import.meta.url);

/**
 * Legacy helper retained for unit coverage of orphaned-owner PID detection.
 */
export function isOrphanedTestCluster(
  ownerPid: number | null,
  selfPid: number,
  alive: (pid: number) => boolean,
): boolean {
  return ownerPid === null || (ownerPid !== selfPid && !alive(ownerPid));
}

/** Committed migration directories in application order. */
export function migrationNames() {
  const names = [
    ...new Bun.Glob("*/migration.sql").scanSync({
      cwd: migrationsRoot.pathname,
      onlyFiles: true,
    }),
  ]
    .map((file) => path.dirname(file))
    .sort();
  if (names.length === 0)
    throw new Error("Delivery database migrations are missing");
  return names;
}

function optionalAdminUrl(): string | undefined {
  const raw = Bun.env["DELIVERY_TEST_ADMIN_DATABASE_URL"]?.trim();
  return raw !== undefined && raw !== "" ? raw : undefined;
}

async function applySqlMigration(
  url: string,
  name: string,
  allowAnyMajor: boolean,
): Promise<void> {
  const psql = postgresBinaryPath("psql", { allowAnyMajor });
  const migrationFile = new URL(`${name}/migration.sql`, migrationsRoot)
    .pathname;
  const result = await runCommandAsync([
    psql,
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--dbname",
    url,
    "--file",
    migrationFile,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${name}): ${result.stderr}`);
  }
}

/**
 * Isolated owned database on the shared local PostgreSQL harness (or
 * `DELIVERY_TEST_ADMIN_DATABASE_URL` when set); never uses a production URL.
 * `through` stops after the named migration so a test can seed rows in that
 * schema and apply the rest with `migrate()`.
 */
export async function createTestDatabase(options: { through?: string } = {}) {
  const names = migrationNames();
  if (options.through !== undefined && !names.includes(options.through))
    throw new Error(`Unknown Delivery migration ${options.through}`);

  const adminUrl = optionalAdminUrl();
  const allowAnyMajor = adminUrl !== undefined;

  const handle =
    options.through === undefined
      ? await createTemplateTestDatabase({
          prefix: "delivery",
          user: "delivery",
          adminUrl,
          migrationsDir: migrationsRoot.pathname,
          populate: async (templateUrl) => {
            for (const name of names) {
              await applySqlMigration(templateUrl, name, allowAnyMajor);
            }
          },
        })
      : await createEmptyTestDatabase({
          prefix: "delivery",
          user: "delivery",
          adminUrl,
        });

  const url = handle.url;
  const database = createDatabase(url);
  const applied = new Set<string>(options.through === undefined ? names : []);

  async function migrate(through?: string) {
    if (through !== undefined && !names.includes(through))
      throw new Error(`Unknown Delivery migration ${through}`);
    for (const name of names) {
      if (applied.has(name)) continue;
      if (through !== undefined && name > through) break;
      await applySqlMigration(url, name, allowAnyMajor);
      applied.add(name);
    }
  }

  const close = async () => {
    await database.$disconnect();
    await handle.drop();
  };

  try {
    if (options.through === undefined) {
      // A fully migrated database starts with the catalog's services registered,
      // as after a reconcile; a partial one is a migration test's v1 record.
      await registerTestServices(database);
    } else {
      await migrate(options.through);
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    database,
    url,
    /** Apply the remaining committed migrations, optionally stopping after one. */
    migrate,
    /** Names applied so far, in order. */
    get applied() {
      return names.filter((name) => applied.has(name));
    },
    close,
  };
}
