import { Prisma } from "#generated/prisma/client.ts";
import {
  SeriesPackNativeVerifiedPublicationV2Schema,
  SeriesPackNativeFenceReleaseV2Schema,
} from "#shared/native-recovery/series-pack/runtime.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertSeriesPackNativePublicationPhaseCurrentV1,
  type SeriesPackNativePublicationPhaseV1,
} from "./phase.ts";
import { z } from "zod";
import { assertSeriesPackNativePublicationCommandV1 } from "./record.ts";
import { reserveSeriesPackNativePublicationSqlV1 } from "./sql-ledger.ts";
import { queueNativeSeriesPackSourceV1 } from "./source.ts";

/** Actual serving bindings and the native whole fence release commit in ONE TX. */
export async function commitSeriesPackNativePublicationV1(
  tx: Prisma.TransactionClient,
  phase: SeriesPackNativePublicationPhaseV1,
  raw: z.infer<typeof SeriesPackNativeVerifiedPublicationV2Schema>,
  options: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const authority = await assertSeriesPackNativePublicationPhaseCurrentV1(
    tx,
    phase,
    options.budget,
  );
  const proof = SeriesPackNativeVerifiedPublicationV2Schema.parse(raw);
  if (
    proof.continuationId !== authority.continuationId ||
    proof.operationId !== authority.publicationOperationId ||
    proof.recoveryEpoch !== authority.recoveryEpoch ||
    proof.completionHash !== authority.completionHash ||
    proof.commandHash !== authority.commandHash ||
    proof.bindingsHash !== authority.bindingsHash ||
    proof.commandRaw !==
      canonicalJson(
        z
          .json()
          .parse(
            assertSeriesPackNativePublicationCommandV1(
              phase.record,
              phase.operation,
              phase.activity,
            ).command,
          ),
      ) ||
    identityHash(proof.generations) !== identityHash(authority.generations) ||
    proof.items.length !== authority.mediaIds.length ||
    new Set(proof.items.map((item) => item.mediaId)).size !==
      authority.mediaIds.length ||
    proof.items.some(
      (item) =>
        phase.record.completion?.predecessorBindings.some(
          ({ after }) =>
            after.id === item.assetId &&
            after.version === item.assetVersion &&
            after.checksum === item.checksum &&
            after.path === item.canonicalPath &&
            after.coverage.some(
              (row) => row.current && row.mediaId === item.mediaId,
            ),
        ) !== true,
    )
  )
    throw new Error(
      "Native pack verified Plex publication omitted or changed a completed predecessor",
    );
  const release = SeriesPackNativeFenceReleaseV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    continuationId: phase.record.row.id,
    transitionId: phase.record.row.transitionId,
    settlingContinuationId: phase.record.row.id,
    settlingCompletionHash: authority.completionHash,
    publicationHash: identityHash(proof),
    releasedAt: proof.verifiedAt,
    publicationRaw: canonicalJson(z.json().parse(proof)),
  });
  const guard = {
    expiresAtMs: Math.min(
      phase.freshness.expiresAtMs,
      options.freshness.expiresAtMs,
    ),
    assertActive() {
      phase.freshness.assertActive();
      options.freshness.assertActive();
    },
  };
  await bindPlexTransactionDeadline(tx, guard);
  guard.assertActive();
  // SQL independently queries the actual continuation, receipt, plan, command
  // and owner. New serving evidence is validated as a real same-TX write closure.
  reserveSeriesPackNativePublicationSqlV1(options.budget, "commit");
  const written =
    await tx.nativePublicationCompensationContinuation.updateManyAndReturn({
      where: {
        id: phase.record.row.id,
        version: phase.record.row.version,
        receiptId: phase.record.row.receiptId,
        descriptorHash: phase.record.row.descriptorHash,
        publicationCoordinatorOperationId: authority.publicationOperationId,
        verifiedPublication: { equals: Prisma.DbNull },
        fenceRelease: { equals: Prisma.DbNull },
      },
      data: {
        verifiedPublication: proof,
        fenceRelease: release,
        version: { increment: 1 },
      },
    });
  const acknowledgement = written[0];
  if (acknowledgement === undefined || written.length !== 1)
    throw new Error("Native pack serving completion CAS changed");
  const {
    receipt: _receipt,
    updatedAt: _beforeTime,
    ...before
  } = phase.record.row;
  const { updatedAt: _afterTime, ...after } = acknowledgement;
  if (
    identityHash(nativeJson(after)) !==
    identityHash(
      nativeJson({
        ...before,
        verifiedPublication: proof,
        fenceRelease: release,
        version: before.version + 1,
      }),
    )
  )
    throw new Error("Native pack serving write acknowledgement changed");
  await queueNativeSeriesPackSourceV1(
    tx,
    { record: phase.record, acknowledgement, proof },
    options.budget,
  );
  guard.assertActive();
  phase.closed = true;
}
