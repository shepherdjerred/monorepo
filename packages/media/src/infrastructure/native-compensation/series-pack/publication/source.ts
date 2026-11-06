import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { SeriesPackNativeSourceV1Schema } from "#shared/native-recovery/series-pack/source.ts";
import type { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";
import type { SeriesPackNativeVerifiedPublicationV2Schema } from "#shared/native-recovery/series-pack/runtime.ts";
import { queueOperation } from "#automation/store.ts";
import type { z } from "zod";

/** Only the actual serving write acknowledgement can queue current source
 * work. The six independent SQL birth parents are reserved before this write. */
export async function queueNativeSeriesPackSourceV1(
  tx: Prisma.TransactionClient,
  input: {
    record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>;
    acknowledgement: Prisma.NativePublicationCompensationContinuationGetPayload<
      Record<string, never>
    >;
    proof: z.infer<typeof SeriesPackNativeVerifiedPublicationV2Schema>;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { record, acknowledgement, proof } = input;
  const torrentId = record.publication.attempt.torrentId;
  if (
    torrentId === null ||
    record.completion === null ||
    record.transaction !== tx ||
    record.budget !== budget ||
    acknowledgement.id !== record.row.id ||
    acknowledgement.descriptorHash !== record.row.descriptorHash ||
    acknowledgement.fenceRelease === null ||
    identityHash(acknowledgement.verifiedPublication) !== identityHash(proof)
  )
    throw new Error(
      "Native pack source queue lost its actual serving acknowledgement",
    );
  const source = SeriesPackNativeSourceV1Schema.parse({
    schemaVersion: 1,
    protocol: "series_pack_publication_v3",
    continuationId: record.row.id,
    descriptorHash: record.row.descriptorHash,
    completionHash: identityHash(record.completion),
    publicationHash: identityHash(proof),
    originalAttemptId: record.publication.attempt.id,
    recoveryEpoch: record.row.recoveryEpoch,
  });
  budget.consume(6);
  return queueOperation(tx, {
    key: `native-series-pack-source-v1:${record.row.id}:${torrentId}`,
    kind: "maintain_torrent",
    targetId: torrentId,
    userId: record.row.receipt.actorId,
    payload: { torrentId, seriesPackNativeSourceV1: source },
    budget,
    createdAt: new Date(),
    availableAt: new Date(),
  });
}
