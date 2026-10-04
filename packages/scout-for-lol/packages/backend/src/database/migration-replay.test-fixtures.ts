import {
  devPostgresPort,
  ensureDevPostgres,
  psqlMaintenance,
} from "#src/testing/postgres-server.ts";

/**
 * A throwaway Postgres database built by replaying the checked-in migrations,
 * for tests that verify a migration against real rows instead of reasoning
 * about its SQL.
 */

const MIGRATIONS_DIR = `${import.meta.dir}/../../prisma/migrations`;

export type MigrationReplay = {
  /** Run SQL in the replay database; throws with stderr on failure. */
  psql: (sql: string) => string;
  /** Apply one migration by directory name; throws with its output. */
  applyMigration: (name: string) => void;
  /** Drop the database. */
  drop: () => void;
};

function psqlArgs(databaseName: string): string[] {
  return [
    "psql",
    "-h",
    "127.0.0.1",
    "-p",
    devPostgresPort().toString(),
    "-U",
    "scout",
    "-d",
    databaseName,
    "-v",
    "ON_ERROR_STOP=1",
  ];
}

/** Every migration directory, in the order Prisma applies them. */
function migrationNames(): string[] {
  const glob = new Bun.Glob("*/migration.sql");
  return [...glob.scanSync({ cwd: MIGRATIONS_DIR })]
    .map((file) => file.slice(0, file.indexOf("/")))
    .sort();
}

/**
 * Create `databaseName` fresh and apply every migration that sorts before
 * `migration`, leaving the database exactly as the target migration finds it.
 */
export function replayMigrationsBefore(
  databaseName: string,
  migration: string,
): MigrationReplay {
  ensureDevPostgres();
  psqlMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  psqlMaintenance(`CREATE DATABASE "${databaseName}"`);

  function psql(sql: string): string {
    const result = Bun.spawnSync(
      [...psqlArgs(databaseName), "-At", "-c", sql],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(`psql failed (${sql}): ${result.stderr.toString()}`);
    }
    return result.stdout.toString().trim();
  }

  function applyMigration(name: string): void {
    const result = Bun.spawnSync(
      [
        ...psqlArgs(databaseName),
        "-f",
        `${MIGRATIONS_DIR}/${name}/migration.sql`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `applying ${name} failed: ${result.stderr.toString()}${result.stdout.toString()}`,
      );
    }
  }

  const names = migrationNames();
  const target = names.indexOf(migration);
  if (target === -1) {
    throw new Error(`${migration} is missing from ${MIGRATIONS_DIR}`);
  }
  for (const name of names.slice(0, target)) {
    applyMigration(name);
  }
  return {
    psql,
    applyMigration,
    drop: () => {
      psqlMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    },
  };
}
