import { ApplicationFailure } from "@temporalio/common";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedPrematchSnapshot } from "#src/report-lake/receipted-archive.ts";
import { ArchivedObjectUnusableError } from "#src/report-store/s3-raw-source.ts";
import {
  prematchContextFrom,
  trackedAccountConfigs,
  type ScoutV2PrematchContext,
} from "#src/temporal/v2/prematch/prematch-context.ts";

/**
 * Resuming a prematch capture from what it already archived.
 *
 * The capture has three durable effects — the S3 object, the lake projection
 * and the notification intents — and only the first is gated by a receipt the
 * others can be reconstructed from. A run that archived the snapshot and then
 * died still owes the projection and the intents, and the live spectator
 * endpoint is no help: by the time the retry lands the game may be over, so a
 * live-first capture would report an empty result, complete, and leave its
 * game-scoped Workflow ID sealing the loss.
 *
 * The archived payload is the answer. It is the canonical copy by definition —
 * S3 is the raw store the report lake rebuilds from — so a resumed run can
 * finish every remaining phase from it without Riot being involved at all.
 */

/**
 * The snapshot this game already has, if one was ever archived.
 *
 * `null` means nothing was archived, which is the only state in which a live
 * read may be consulted and its answer believed.
 */
export async function resumeArchivedPrematchContext(
  riotMatchId: RiotMatchId,
  database: ExtendedPrismaClient = prisma,
): Promise<ScoutV2PrematchContext | null> {
  const descriptor = await storedRawArchiveDescriptor(
    database,
    riotMatchId,
    "prematch",
  );
  if (descriptor === null) return null;

  const gameInfo = await readArchivedPrematchPayload(descriptor, riotMatchId);
  return prematchContextFrom(
    gameInfo,
    await trackedAccountConfigs(database),
    riotMatchId,
  );
}

/**
 * Read one archived spectator snapshot back, verified against its receipt.
 *
 * Two failure classes, and collapsing them is the bug this exists to avoid —
 * the same distinction the spectator boundary draws, on the storage side.
 *
 * An {@link ArchivedObjectUnusableError} is a FACT about what is stored: the
 * object is gone, its bytes do not match the digest that was attested, or they
 * do not parse as a spectator payload. No retry changes any of that, so it
 * terminates the run and the operator sees a snapshot that cannot be resumed.
 *
 * Anything else is a TRANSPORT failure — a SeaweedFS timeout, a 5xx, a dropped
 * connection — and it establishes nothing about whether the object is there.
 * Turning one of those into a terminal failure would permanently strand an
 * archived snapshot without its lake projection or its notifications, because
 * once the game has ended discovery cannot start another execution to try
 * again. So it propagates untouched and the Activity's retry is the wait loop.
 */
async function readArchivedPrematchPayload(
  descriptor: ArtifactDescriptor,
  riotMatchId: RiotMatchId,
): Promise<RawCurrentGameInfo> {
  try {
    return await readArchivedPrematchSnapshot(descriptor, riotMatchId);
  } catch (error) {
    if (error instanceof ArchivedObjectUnusableError) {
      throw ApplicationFailure.nonRetryable(
        `The archived prematch snapshot for ${riotMatchId} cannot be resumed from: ${error.message}`,
        "MissingArchivedSnapshot",
      );
    }
    throw error;
  }
}
