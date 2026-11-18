import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createEmptyTestDatabase,
  createTemplateTestDatabase,
  envWithPostgresBin,
  postgresBinaryPath,
  runCommandAsync,
  runCommandSync,
} from "@shepherdjerred/test-postgres";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { historicalIntentFixtureDatabase } from "./historical-intent-client.ts";

const MEDIA_TEST_DB_NAME_PATTERN = /^media_(?:test|mig)_[a-z0-9_]+$/u;

const MediaTestDatabaseTargetSchema = z
  .array(
    z.strictObject({
      database: z.string().regex(MEDIA_TEST_DB_NAME_PATTERN),
      user: z.string().min(1),
      port: z.int().positive(),
    }),
  )
  .length(1);

export async function mediaTestDatabaseUrl(source: Database): Promise<string> {
  const [target] = MediaTestDatabaseTargetSchema.parse(
    await source.$queryRaw`
      SELECT current_database() AS database, current_user AS "user", inet_server_port() AS port
    `,
  );
  if (target === undefined) {
    throw new Error("Disposable media test database endpoint missing");
  }
  return `postgres://${encodeURIComponent(target.user)}@127.0.0.1:${String(target.port)}/${encodeURIComponent(target.database)}`;
}

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = path.join(packageRoot, "prisma/migrations");

export type MediaMigrationCeiling =
  | "20261017001600_visibility"
  | "20261017001700_default_edition_scope"
  | "20261017001800_capacity_observation"
  | "20261017001900_watch_observation_fence"
  | "20261017002000_native_archive_cleanup"
  | "20261017002100_publication_compensation"
  | "20261017002200_movie_edition_choice"
  | "20261017002300_plex_association_binding";

function optionalAdminUrl(): string | undefined {
  const raw = Bun.env["MEDIA_TEST_ADMIN_DATABASE_URL"]?.trim();
  return raw !== undefined && raw !== "" ? raw : undefined;
}

async function listMediaMigrations(): Promise<string[]> {
  const entries = await readdir(migrationsDir);
  return entries.filter((name) => /^\d{14}_[a-z0-9_]+$/u.test(name)).sort();
}

function buildApplyMigration(
  url: string,
  migrations: readonly string[],
  allowAnyMajor: boolean,
): (name: string) => void {
  return (name: string) => {
    if (!migrations.includes(name)) {
      throw new Error("Unknown test migration");
    }
    const psql = postgresBinaryPath("psql", { allowAnyMajor });
    const migrationFile = path.join(migrationsDir, name, "migration.sql");
    const result = runCommandSync(
      [psql, url, "-v", "ON_ERROR_STOP=1", "-f", migrationFile],
      { cwd: packageRoot },
    );
    if (result.exitCode !== 0) {
      throw new Error(`psql failed (${name}): ${result.stderr}`);
    }
  };
}

/** Isolated owned database on the shared local PostgreSQL harness; never touches production. */
export async function startMediaTestPostgres(
  options: {
    migrationCeiling?: MediaMigrationCeiling;
  } = {},
) {
  const adminUrl = optionalAdminUrl();
  const allowAnyMajor = adminUrl !== undefined;
  const migrations = await listMediaMigrations();
  const ceiling = options.migrationCeiling;

  const handle =
    ceiling === undefined
      ? await createTemplateTestDatabase({
          prefix: "media",
          user: "media",
          adminUrl,
          migrationsDir,
          populate: async (templateUrl) => {
            const result = await runCommandAsync(
              ["bun", "run", "migrate:deploy"],
              {
                cwd: packageRoot,
                env: envWithPostgresBin(
                  { DATABASE_URL: templateUrl },
                  { allowAnyMajor },
                ),
              },
            );
            if (result.exitCode !== 0) {
              throw new Error(
                `Media template migrate:deploy failed: ${result.stderr || result.stdout}`,
              );
            }
          },
        })
      : await createEmptyTestDatabase({
          prefix: "media",
          user: "media",
          adminUrl,
        });

  const applyMigration = buildApplyMigration(
    handle.url,
    migrations,
    allowAnyMajor,
  );

  try {
    if (!MEDIA_TEST_DB_NAME_PATTERN.test(handle.dbName)) {
      throw new Error(`Unexpected media test database name: ${handle.dbName}`);
    }
    const psql = postgresBinaryPath("psql", { allowAnyMajor });
    const timezoneResult = await runCommandAsync(
      [
        psql,
        handle.adminUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `ALTER DATABASE "${handle.dbName}" SET timezone TO 'UTC'`,
      ],
      { cwd: packageRoot },
    );
    if (timezoneResult.exitCode !== 0) {
      throw new Error(
        `Failed to set UTC timezone on ${handle.dbName}: ${timezoneResult.stderr}`,
      );
    }
    if (ceiling !== undefined) {
      for (const migration of migrations.filter((name) => name <= ceiling)) {
        applyMigration(migration);
      }
    }
    const base = createDatabase(handle.url);
    try {
      const database =
        ceiling === undefined
          ? base
          : await historicalIntentFixtureDatabase(base, handle.url);
      const close = async () => {
        await database.$disconnect();
        if (database !== base) await base.$disconnect();
        await handle.drop();
      };
      return {
        database,
        url: handle.url,
        applyMigration,
        close,
      };
    } catch (error) {
      await base.$disconnect();
      throw error;
    }
  } catch (error) {
    await handle.drop();
    throw error;
  }
}
