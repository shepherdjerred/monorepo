#!/usr/bin/env bun
/**
 * Audit every stored report for an explicit ScoutQL time period.
 *
 * Run this read-only against a snapshot before deploying the release that
 * requires a period. Backend startup runs it with --fix after Prisma migrations
 * and before the application starts; it is the parser-aware data migration.
 *
 * The property it checks is the one that matters: two independently rewritten
 * forms must produce the same plan apart from the window. A rewrite that moved
 * a predicate into the wrong clause, or truncated the text, fails startup.
 *
 * Read-only by default. `--fix` rewrites rows the SQL missed, splicing at the
 * parser's own clause span rather than at a string offset — whitespace-proof in
 * a way the migration's SQL cannot be.
 *
 *   bun scripts/audit-report-windows.ts --database file:./snapshot.db
 *   bun scripts/audit-report-windows.ts --database file:./snapshot.db --fix
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  REPORT_WINDOW_REQUIRED_MESSAGE,
  parseAndCompile,
  parseReportQuery,
  type ReportQueryPlan,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("audit-report-windows");

const ArgsSchema = z
  .object({
    database: z.string().min(1),
    fix: z.boolean().default(false),
  })
  .strict();

const LOOKBACK_CLAUSE = (source: string): string =>
  `${source === "prematch_participants" ? "observed_at" : "game_creation_at"} >= CURRENT_TIMESTAMP - INTERVAL '30 days'`;

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

/** Everything about a plan except which period it covers. */
function withoutWindow(plan: ReportQueryPlan): Omit<ReportQueryPlan, "window"> {
  const { window: _window, ...rest } = plan;
  return rest;
}

function hasStatedPeriod(queryText: string): boolean {
  const { ast, diagnostics } = parseReportQuery(queryText);
  // A row the migration spliced at the wrong offset lands here as a parse
  // error, which routes it to `unparseable` and a nonzero exit — the point of
  // running this after the migration and not only before it.
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return false;
  }
  if (ast.during !== undefined || ast.analysis !== undefined) return true;
  return ast.where.some((clause) => clause.kind === "lookback");
}

/**
 * Add the legacy lookback predicate, spliced at the parser's own WHERE/GROUP BY
 * boundary. Writes the legacy form rather than DURING for the same reason the
 * migration does: an older image can still parse it.
 */
function addPeriod(queryText: string): string {
  const { ast } = parseReportQuery(queryText);
  if (ast.groupBy === undefined || ast.source === undefined) {
    throw new Error("query has no GROUP BY to splice against");
  }
  const predicate = LOOKBACK_CLAUSE(ast.source.value.trim().toLowerCase());
  const last = ast.where.at(-1);
  const insertAt = last === undefined ? ast.source.span.end : last.span.end;
  const joiner = last === undefined ? " WHERE " : " AND ";
  return (
    queryText.slice(0, insertAt) +
    joiner +
    predicate +
    queryText.slice(insertAt)
  );
}

/**
 * The same period expressed as a DURING clause after GROUP BY.
 *
 * Deliberately a different splice point and a different clause from
 * {@link addPeriod}, so comparing the two plans actually tests something.
 */
function withDuringClause(queryText: string): string {
  const { ast } = parseReportQuery(queryText);
  const anchor = ast.having ?? ast.groupBy;
  if (anchor === undefined || ast.source === undefined) {
    throw new Error("query has no GROUP BY to splice against");
  }
  // Rank sources are snapshots/whole-competition leaderboards. Their legacy
  // timestamp predicate was historically ignored and compiles as ALL TIME for
  // rollback compatibility, so the independent comparison must state the same
  // honest window.
  const period =
    ast.source.value === "rank_current" ||
    ast.source.value === "competition_rank"
      ? "DURING ALL TIME"
      : "DURING LAST 30 DAYS";
  return (
    queryText.slice(0, anchor.span.end) +
    ` ${period}` +
    queryText.slice(anchor.span.end)
  );
}

const args = parseArgs(Bun.argv.slice(2));
// bun:sqlite rejects `{ readonly: false }` outright — the write mode has to be
// asked for by name, so a plain negation silently made --fix unusable.
const db = new Database(
  args.database.replace(/^file:/u, ""),
  args.fix ? { readwrite: true } : { readonly: true },
);

const RowSchema = z.object({
  id: z.number(),
  title: z.string(),
  queryText: z.string(),
  isEnabled: z.number(),
});
const rows = z
  .array(RowSchema)
  .parse(
    db.query(`SELECT id, title, queryText, isEnabled FROM "Report"`).all(),
  );

let stated = 0;
const missing: { id: number; title: string; queryText: string }[] = [];
const unparseable: { id: number; title: string; message: string }[] = [];

for (const row of rows) {
  if (hasStatedPeriod(row.queryText)) {
    // Presence alone is not acceptance: the parser deliberately retains the
    // raw DURING/ANALYZE tail, and only compilation validates its grammar and
    // source compatibility.
    try {
      parseAndCompile(row.queryText);
      stated++;
    } catch (error) {
      unparseable.push({
        id: row.id,
        title: row.title,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    continue;
  }
  // A row with no period no longer compiles — that is the whole point of the
  // release this audits. It must still be counted as fixable rather than as
  // broken, or the gate reports success on exactly the rows it exists to find.
  try {
    parseAndCompile(row.queryText);
    missing.push(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === REPORT_WINDOW_REQUIRED_MESSAGE) {
      missing.push(row);
      continue;
    }
    unparseable.push({ id: row.id, title: row.title, message });
  }
}

logger.info(`Reports:            ${rows.length.toString()}`);
logger.info(`  state a period:   ${stated.toString()}`);
logger.info(`  missing a period: ${missing.length.toString()}`);
logger.info(`  do not compile:   ${unparseable.length.toString()}`);

for (const row of unparseable) {
  logger.info(`\n  [${row.id.toString()}] ${row.title}\n      ${row.message}`);
}

if (missing.length > 0) {
  logger.info("\nRows missing a period:");
  for (const row of missing) {
    const rewritten = addPeriod(row.queryText);
    // The original no longer compiles — a missing period IS a compile error
    // now — so there is no "before" plan to compare against directly.
    //
    // Compare two INDEPENDENTLY derived variants instead: the WHERE predicate
    // spliced at the parser's clause boundary, and a DURING clause appended
    // after GROUP BY. They travel different code paths to the same window, so
    // if either splice landed in the wrong clause or truncated the text, their
    // plans diverge. Comparing the rewrite against itself, as an earlier
    // version of this did, proves nothing.
    const viaDuring = withDuringClause(row.queryText);
    const before = withoutWindow(parseAndCompile(viaDuring));
    const after = withoutWindow(parseAndCompile(rewritten));
    const equivalent = Bun.deepEquals(before, after);
    logger.info(
      `  [${row.id.toString()}] ${row.title} — plan preserved: ${equivalent ? "yes" : "NO"}`,
    );
    if (!equivalent) {
      logger.info(`      before: ${row.queryText}`);
      logger.info(`      after:  ${rewritten}`);
      throw new Error(
        `Rewriting report ${row.id.toString()} would change its plan. Fix it by hand.`,
      );
    }
    if (args.fix) {
      db.query(`UPDATE "Report" SET "queryText" = ? WHERE "id" = ?`).run(
        rewritten,
        row.id,
      );
      logger.info(`      fixed`);
    }
  }
}

db.close();

// A row that cannot be parsed at all is a failure too: it will never run
// again, and reporting it without a nonzero exit lets a release proceed past it.
if (unparseable.length > 0) {
  logger.info("\nSome reports do not parse at all and need a human.");
  process.exit(1);
}
if (missing.length > 0 && !args.fix) {
  logger.info("\nRe-run with --fix to rewrite them, or deploy the migration.");
  process.exit(1);
}
logger.info("\nEvery report states a time period.");
