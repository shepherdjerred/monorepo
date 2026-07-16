/**
 * Manually run a report-lake compaction against the configured database.
 *
 *   bun run scripts/compact-report-lake.ts            # full rebuild
 *   bun run scripts/compact-report-lake.ts --fold     # fold staging only
 *
 * The lake location comes from REPORT_LAKE_DIR (default ./report-lake).
 */
import { prisma } from "#src/database/index.ts";
import {
  runReportLakeFold,
  runReportLakeRebuild,
} from "#src/report-lake/compactor.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("compact-report-lake");

const fold = Bun.argv.includes("--fold");
const summary = fold ? await runReportLakeFold() : await runReportLakeRebuild();

if (summary === null) {
  logger.error("Compaction did not run (another run in flight?)");
  process.exitCode = 1;
} else {
  logger.info(
    `${summary.tier} build ${summary.buildId}: ${summary.matchRows.toString()} match rows, ` +
      `${summary.prematchRows.toString()} prematch rows, ${summary.accountRows.toString()} accounts, ` +
      `${summary.skippedMatches.toString()}/${summary.skippedPrematches.toString()} skipped, ` +
      `${summary.durationMs.toString()}ms`,
  );
}

await prisma.$disconnect();
