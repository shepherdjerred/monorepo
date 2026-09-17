import { ArtifactKindSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { oldestUnprojectedArchiveAt } from "#src/database/durable/pipeline-backlog.ts";
import { createLogger } from "#src/logger.ts";
import { scoutDurableLakeStagingLag } from "#src/metrics/durable-pipeline.ts";
import { registerDatabaseMetricSweep } from "#src/metrics/sweep-registry.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";

const logger = createLogger("lake-staging-lag");

/**
 * How far the lake has fallen behind the raw archive, per artifact kind.
 *
 * The lag is a receipt anti-join, not a column: staging writes NDJSON to one
 * role's RWO volume and `receipted-staging.ts` deliberately keeps those paths
 * out of the receipt, because a receipt has to stay true for readers that
 * cannot see that volume. What is durable and shared is the pair of receipts —
 * `raw-archive-<kind>` says the bytes are in S3, `lake-staging-<kind>` says the
 * lake has them — so an artifact archived with no staging receipt is one the
 * lake still owes, and the age of the oldest such archive is the lag.
 *
 * It is measured per artifact kind because the three fail independently. A
 * match whose timeline is still unstaged is an ordinary, frequent state, and a
 * single folded number would report the whole lake as healthy while timelines
 * silently fell days behind.
 *
 * ## Why this is not in `metrics/`
 *
 * The two receipt kinds come from `durable-receipts.ts`, and
 * `architecture.config.ts` forbids `metrics/` from importing `report-lake/`.
 * Re-deriving `raw-archive-${kind}` next to the gauge would satisfy the rule
 * by copying the vocabulary it exists to keep in one place — a metric that
 * matched no receipts at all would look exactly like a lake with no backlog.
 * So the sweep stays with the vocabulary and is registered by the composition
 * root; see `metrics/sweep-registry.ts`.
 */
export async function collectLakeStagingLagMetrics(db: Db): Promise<void> {
  const now = Date.now();
  try {
    await Promise.all(
      ArtifactKindSchema.options.map(async (artifact) => {
        const archivedAt = await oldestUnprojectedArchiveAt(db, {
          archiveReceiptKind: rawArchiveReceiptKind(artifact),
          stagingReceiptKind: lakeStagingReceiptKind(artifact),
        });
        scoutDurableLakeStagingLag.set(
          { artifact_kind: artifact },
          archivedAt === null
            ? 0
            : Math.max(0, (now - archivedAt.getTime()) / 1000),
        );
      }),
    );
  } catch (error) {
    for (const artifact of ArtifactKindSchema.options) {
      scoutDurableLakeStagingLag.set({ artifact_kind: artifact }, -1);
    }
    logger.error("Failed to update lake staging lag metrics", { error });
  }
}

/** Run the lag sweep against the process's own database; see the seam note in `durable-pipeline.ts`. */
export async function updateLakeStagingLagMetrics(): Promise<void> {
  await collectLakeStagingLagMetrics(prisma);
}

/**
 * Add this sweep to the scrape-time set.
 *
 * Called by the composition root on the roles that own the database sweeps,
 * rather than run as an import side effect, so that "this role computes the
 * lake lag" is a decision visible at the place every other role capability is
 * decided instead of a consequence of who imported what.
 */
export function registerLakeStagingLagSweep(): void {
  registerDatabaseMetricSweep("lake-staging-lag", updateLakeStagingLagMetrics);
}
