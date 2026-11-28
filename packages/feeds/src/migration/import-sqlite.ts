/**
 * Copies Feeds' SQLite file into PostgreSQL and verifies the copy.
 *
 *   DATABASE_URL=... bun src/migration/import-sqlite.ts --from <feeds.sqlite> [--cutover]
 *
 * Without `--cutover` it is a rehearsal: it replaces PostgreSQL's rows with a
 * snapshot of the (possibly live) file, runs every gate and reports, and
 * refuses to run once PostgreSQL is primary. With `--cutover` it does the
 * same against the quiescent file and, when every gate passes, writes the
 * cutover marker; once the marker exists it does nothing, so PostgreSQL's
 * newer writes are never overwritten. It exits non-zero when a gate fails.
 *
 * Output is one JSON report on stdout: counts, check names and row IDs only.
 */
import { parseArgs } from "node:util";
import { PostgresFeedsStore } from "@shepherdjerred/feeds/server/postgres/store.ts";
import { createFeedsPrismaClient } from "@shepherdjerred/feeds/server/postgres/sql.ts";
import { asyncFeedsRepository } from "@shepherdjerred/feeds/server/sqlite-repository.ts";
import {
  copySqliteToPostgres,
  openSqliteSnapshot,
  readCutoverMarker,
  writeCutoverMarker,
} from "./sqlite-to-postgres.ts";
import {
  verifySqliteImport,
  type VerificationReport,
} from "./verify-sqlite-import.ts";

export type ImportOutcome =
  | { readonly status: "already-cut-over"; readonly marker: string }
  | { readonly status: "refused"; readonly reason: string }
  | {
      readonly status: "verified" | "cut-over" | "failed";
      readonly report: VerificationReport;
    };

export async function importSqliteIntoPostgres(options: {
  readonly from: string;
  readonly databaseUrl: string;
  readonly cutover: boolean;
  readonly now?: () => Date;
}): Promise<ImportOutcome> {
  const prisma = createFeedsPrismaClient(options.databaseUrl);
  try {
    const marker = await readCutoverMarker(prisma);
    if (marker !== undefined) {
      return options.cutover
        ? { status: "already-cut-over", marker }
        : {
            status: "refused",
            reason:
              "PostgreSQL is already primary; a rehearsal would overwrite it",
          };
    }
    const snapshot = openSqliteSnapshot(options.from);
    try {
      const counts = await copySqliteToPostgres(snapshot, prisma);
      const postgres = await PostgresFeedsStore.fromClient(prisma);
      const report = await verifySqliteImport({
        snapshot,
        sqlite: asyncFeedsRepository(snapshot.store),
        postgres,
        prisma,
      });
      if (!report.ok) {
        return { status: "failed", report };
      }
      if (!options.cutover) {
        return { status: "verified", report };
      }
      await writeCutoverMarker(
        prisma,
        JSON.stringify({
          completedAt: (options.now ?? (() => new Date()))().toISOString(),
          rows: counts,
        }),
      );
      return { status: "cut-over", report };
    } finally {
      snapshot.release();
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      cutover: { type: "boolean", default: false },
    },
    strict: true,
  });
  const databaseUrl = Bun.env["DATABASE_URL"] ?? "";
  if (databaseUrl === "" || values.from === undefined) {
    throw new Error(
      "Usage: DATABASE_URL=... bun src/migration/import-sqlite.ts --from <feeds.sqlite> [--cutover]",
    );
  }
  const outcome = await importSqliteIntoPostgres({
    from: values.from,
    databaseUrl,
    cutover: values.cutover,
  });
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  if (outcome.status === "failed" || outcome.status === "refused") {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
