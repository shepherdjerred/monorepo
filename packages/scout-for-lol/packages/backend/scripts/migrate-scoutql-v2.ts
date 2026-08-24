#!/usr/bin/env bun
/**
 * Rewrite every stored `Report.queryText` from legacy ScoutQL into ScoutQL v2.
 *
 * v2 is a hard cutover: the legacy metric enum, DURING, ANALYZE, and the
 * `WHERE games >= n` floor are gone from the runtime language, so a row left
 * in legacy syntax stops running the moment the release lands. Backend startup
 * runs this with --fix after `prisma migrate deploy` and before the
 * application starts, which is why an unconvertible row exits non-zero: a
 * report that silently answers a different question is worse than a deploy
 * that stops and asks.
 *
 * The rewrite splices at the legacy parser's own clause spans rather than at
 * string offsets, and every row is checked by two independent routes to the
 * same v2 plan (see scoutql-v2-convert.ts). Read-only by default.
 *
 *   bun scripts/migrate-scoutql-v2.ts --database file:./snapshot.db
 *   bun scripts/migrate-scoutql-v2.ts --database file:./snapshot.db --fix
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { convertStoredQuery } from "./scoutql-v2-convert.ts";

const logger = createLogger("migrate-scoutql-v2");

const ArgsSchema = z
  .object({
    database: z.string().min(1),
    fix: z.boolean().default(false),
  })
  .strict();

function parseArgs(argv: string[]): z.infer<typeof ArgsSchema> {
  const raw: Record<string, unknown> = { fix: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--fix") {
      raw["fix"] = true;
      continue;
    }
    if (arg === "--database") {
      raw["database"] = argv[++index];
      continue;
    }
    throw new Error(
      `Unknown argument ${arg ?? ""}. Expected --database <path> [--fix].`,
    );
  }
  return ArgsSchema.parse(raw);
}

const RowSchema = z.object({
  id: z.number(),
  title: z.string(),
  queryText: z.string(),
});

type Rewrite = { id: number; title: string; before: string; after: string };
type Refusal = { id: number; title: string; reason: string };

const args = parseArgs(Bun.argv.slice(2));
// bun:sqlite rejects `{ readonly: false }` outright — the write mode has to be
// asked for by name, so a plain negation silently makes --fix a no-op.
const db = new Database(
  args.database.replace(/^file:/u, ""),
  args.fix ? { readwrite: true } : { readonly: true },
);

const rows = z
  .array(RowSchema)
  .parse(db.query(`SELECT id, title, queryText FROM "Report"`).all());

let alreadyV2 = 0;
const rewrites: Rewrite[] = [];
const refusals: Refusal[] = [];

for (const row of rows) {
  const result = convertStoredQuery(row.queryText);
  if (result.kind === "already-v2") {
    alreadyV2++;
    continue;
  }
  if (result.kind === "unconvertible") {
    refusals.push({ id: row.id, title: row.title, reason: result.reason });
    continue;
  }
  rewrites.push({
    id: row.id,
    title: row.title,
    before: row.queryText,
    after: result.queryText,
  });
}

logger.info(`Reports:            ${rows.length.toString()}`);
logger.info(`  already v2:       ${alreadyV2.toString()}`);
logger.info(`  to rewrite:       ${rewrites.length.toString()}`);
logger.info(`  unconvertible:    ${refusals.length.toString()}`);

for (const rewrite of rewrites) {
  logger.info(`\n  [${rewrite.id.toString()}] ${rewrite.title}`);
  logger.info(`      before: ${rewrite.before}`);
  logger.info(`      after:  ${rewrite.after}`);
}

for (const refusal of refusals) {
  logger.info(`\n  [${refusal.id.toString()}] ${refusal.title}`);
  logger.info(`      ${refusal.reason}`);
}

// All or nothing, in one transaction. A refusal already stops startup, so
// there is nothing to gain from rewriting the rows around it — and a database
// half in each language is a state no later boot can tell apart from a
// deliberate one.
if (args.fix && rewrites.length > 0 && refusals.length === 0) {
  const update = db.query(`UPDATE "Report" SET "queryText" = ? WHERE "id" = ?`);
  const applyAll = db.transaction((pending: Rewrite[]) => {
    for (const rewrite of pending) {
      update.run(rewrite.after, rewrite.id);
    }
  });
  applyAll(rewrites);
  logger.info(`\nRewrote ${rewrites.length.toString()} reports.`);
}

db.close();

if (refusals.length > 0) {
  logger.info(
    "\nSome reports cannot be migrated automatically and need a human." +
      " Nothing was rewritten. Fix them in the app, then redeploy.",
  );
  process.exit(1);
}
if (rewrites.length > 0 && !args.fix) {
  logger.info("\nRe-run with --fix to rewrite them.");
  process.exit(1);
}
logger.info("\nEvery report speaks ScoutQL v2.");
