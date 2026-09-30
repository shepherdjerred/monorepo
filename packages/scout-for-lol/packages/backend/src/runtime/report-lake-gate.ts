/**
 * The boot gate for a role that reads the report lake.
 *
 * An empty or unmounted lake directory is not an error condition for DuckDB —
 * it scans zero parquet files and returns zero rows — so a pod pointed at one
 * records every report run, parlay generation and dare settlement as a
 * *successful* run that happened to find nothing. That is the failure this
 * gate exists to convert into a refusal to start: a pod that cannot answer
 * correctly must not answer at all.
 *
 * Lives in its own module, rather than inline in `subsystems.ts`, for two
 * reasons. It stays dynamically imported, so a role that never touches the
 * lake does not load the report-lake paths module; and it can be called
 * directly against a temp directory, so the gate is provable in both
 * directions instead of only being reachable through a booting process.
 */

import { readCurrentBuildDir, resolveLakeDir } from "#src/report-lake/paths.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake-gate");

/**
 * What an unpublished lake means for this process.
 *
 * `refuse` is production and every non-dev path. `warn` exists only for
 * `SCOUT_DEV_SKIP_REPORT_LAKE_FOLD`, which `configuration.ts` refuses outside
 * `environment=dev` — see {@link assertPublishedReportLake}.
 */
export type UnpublishedLakePolicy = "refuse" | "warn";

function unpublishedLakeMessage(lakeDir: string): string {
  return `The report lake at ${lakeDir} has no published build. A role that reads the lake but does not publish it would answer every query with an empty result and record it as success. Mount the lake volume, or run a role that folds it.`;
}

/**
 * Refuse to continue when the lake this process reads has no published build.
 *
 * A corrupt lake — an empty `CURRENT` pointer, or one naming a build directory
 * that is gone — is a different condition and is never softened: that throw
 * comes out of {@link readCurrentBuildDir} and propagates under either policy.
 * Only *absence* is negotiable, and only in dev.
 */
export async function assertPublishedReportLake(
  options: {
    readonly onUnpublished?: UnpublishedLakePolicy;
    readonly lakeDir?: string;
  } = {},
): Promise<void> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const current = await readCurrentBuildDir(lakeDir);
  if (current === undefined) {
    if (options.onUnpublished === "warn") {
      logger.warn(`⚠️  ${unpublishedLakeMessage(lakeDir)}`, { lakeDir });
      return;
    }
    throw new Error(unpublishedLakeMessage(lakeDir));
  }
  logger.info("🗂️  Report lake build verified", { lakeDir, build: current });
}
