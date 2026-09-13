import { ApplicationFailure } from "@temporalio/common";
import { RawCurrentGameInfoSchema } from "@scout-for-lol/data";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import configuration from "#src/configuration.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readVerifiedRawObjectText } from "#src/report-store/s3-raw-source.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  prematchContextFrom,
  trackedAccountConfigs,
  type ScoutV2PrematchContext,
} from "#src/temporal/v2/prematch-context.ts";

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
 * The digest comes from the receipt rather than from the object's own metadata,
 * so this checks the bytes against what was ATTESTED rather than against what
 * the bytes claim about themselves. A mismatch, a missing object or a payload
 * that no longer parses are all non-retryable: the receipt says these bytes
 * were archived, and if they cannot be read back as that snapshot then no
 * number of retries will change it, and the run must not quietly continue from
 * something else.
 */
async function readArchivedPrematchPayload(
  descriptor: ArtifactDescriptor,
  riotMatchId: RiotMatchId,
) {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw ApplicationFailure.nonRetryable(
      `A raw-archive receipt stands for ${riotMatchId} but no S3 bucket is configured, so the snapshot it attests to cannot be read back`,
      "MissingArchivedSnapshot",
    );
  }
  let text: string;
  try {
    text = await readVerifiedRawObjectText({
      client: createS3Client(),
      bucket,
      key: descriptor.key,
      expectedDigest: descriptor.digest,
    });
  } catch (error) {
    throw ApplicationFailure.nonRetryable(
      `The archived prematch snapshot for ${riotMatchId} could not be read back from ${descriptor.key}: ${error instanceof Error ? error.message : String(error)}`,
      "MissingArchivedSnapshot",
    );
  }
  const parsed = RawCurrentGameInfoSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `The archived prematch snapshot for ${riotMatchId} at ${descriptor.key} no longer parses as a spectator payload`,
      "MissingArchivedSnapshot",
    );
  }
  return parsed.data;
}
