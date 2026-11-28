import path from "node:path";
import type { LeaguePuuid, RiotMatchId } from "@scout-for-lol/data";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  devPostgresPort,
  ensureDevPostgres,
  psqlMaintenance,
} from "#src/testing/postgres-server.ts";
import { normalizeTestDatabaseName } from "#src/testing/test-database.ts";
import {
  currentDatabaseOwner,
  ownerCommentSql,
} from "#src/testing/test-database-owner.ts";

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
  // `dirname`, not a split on "/": Bun.Glob yields the platform separator.
  return [...glob.scanSync({ cwd: MIGRATIONS_DIR })]
    .map((file) => path.dirname(file))
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
  const resolvedName = normalizeTestDatabaseName(databaseName);
  ensureDevPostgres();
  psqlMaintenance(`DROP DATABASE IF EXISTS "${resolvedName}" WITH (FORCE)`);
  psqlMaintenance(`CREATE DATABASE "${resolvedName}"`);
  psqlMaintenance(ownerCommentSql(resolvedName, currentDatabaseOwner()));

  function psql(sql: string): string {
    const result = Bun.spawnSync(
      [...psqlArgs(resolvedName), "-At", "-c", sql],
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
        ...psqlArgs(resolvedName),
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
      psqlMaintenance(`DROP DATABASE IF EXISTS "${resolvedName}" WITH (FORCE)`);
    },
  };
}

const BlockedQueriesSchema = z.array(z.object({ blocked: z.number() }));

/**
 * Resolve once a cursor-repair migration statement is waiting on a row lock.
 *
 * Matched on the migration's leading comment: `pg_stat_activity.query` is
 * truncated at `track_activity_query_size`, so the SQL body may be cut off.
 */
export async function waitForBlockedCursorRepair(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = BlockedQueriesSchema.parse(
      await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query LIKE '-- Repair post-match cursors%'`,
      ),
    );
    if ((rows[0]?.blocked ?? 0) > 0) return;
    await Bun.sleep(25);
  }
  throw new Error("The repair never blocked on the writer's row lock");
}

export async function runCursorRepairUnderRowLock(args: {
  prisma: ExtendedPrismaClient;
  puuid: LeaguePuuid;
  lastProcessedMatchId: RiotMatchId;
  lastMatchTime: Date;
  applyRepair: () => Promise<void>;
}): Promise<void> {
  const locked = Promise.withResolvers<true>();
  const release = Promise.withResolvers<true>();
  const writer = args.prisma.$transaction(
    async (tx) => {
      await tx.account.updateMany({
        where: { puuid: args.puuid },
        data: {
          lastProcessedMatchId: args.lastProcessedMatchId,
          lastMatchTime: args.lastMatchTime,
        },
      });
      locked.resolve(true);
      await release.promise;
    },
    { timeout: 30_000 },
  );
  await locked.promise;
  const repair = args.applyRepair();
  await waitForBlockedCursorRepair(args.prisma);
  release.resolve(true);
  await writer;
  await repair;
}
