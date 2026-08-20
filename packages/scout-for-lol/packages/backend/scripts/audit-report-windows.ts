#!/usr/bin/env bun
/**
 * Audit every stored report for an explicit ScoutQL time period.
 *
 * Run this against a snapshot of each environment BEFORE deploying the release
 * that requires a period, and again afterwards. It is the acceptance criterion
 * for the backfill migration, because the migration's `instr()` arithmetic
 * cannot tell you what it did to a query's meaning — only a real parse can.
 *
 * The property it checks is the one that matters: for every row the migration
 * rewrote, `parseAndCompile(before)` and `parseAndCompile(after)` must produce
 * the same plan apart from the window. A rewrite that moved a predicate into
 * the wrong clause, or truncated the text, shows up here and nowhere else.
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

const args = parseArgs(Bun.argv.slice(2));
const db = new Database(args.database.replace(/^file:/u, ""), {
  readonly: !args.fix,
});

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
    stated++;
    continue;
  }
  try {
    parseAndCompile(row.queryText);
    missing.push(row);
  } catch (error) {
    unparseable.push({
      id: row.id,
      title: row.title,
      message: error instanceof Error ? error.message : String(error),
    });
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
    const before = withoutWindow(parseAndCompile(row.queryText));
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

if (missing.length > 0 && !args.fix) {
  logger.info("\nRe-run with --fix to rewrite them, or deploy the migration.");
  process.exit(1);
}
logger.info("\nEvery report states a time period.");
