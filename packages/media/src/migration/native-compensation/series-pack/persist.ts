import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  SeriesPackNativePlexBatchV2Schema,
  SeriesPackNativePlexEnvelopeV2Schema,
  SeriesPackNativePlexRefV2Schema,
  type SeriesPackNativeNetworkEvidenceV3,
} from "#shared/native-recovery/series-pack/evidence.ts";
import { seriesPackNativeNetworkIdentityV1 } from "#infrastructure/native-compensation/series-pack/plex-records.ts";
import { reserveSeriesPackNativeSqlV1 } from "#infrastructure/native-compensation/series-pack/sql-budget.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { assertNativeEvidenceFresh } from "#infrastructure/native-recovery/evidence-freshness.ts";

type Frame = {
  transaction: Prisma.TransactionClient;
  plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>;
  operation: Prisma.OperationGetPayload<Record<string, never>>;
  scope: SeriesPackNativeCompensationScopeV3;
  continuation: { id: string; descriptorHash: string } | null;
};

/** The immutable paired records are real outputs of one complete, fresh current
 * phase. The existing tables/immutable triggers are reused with a strict new
 * schema2 batch; no historical v1 object is reinterpreted. */
export async function persistSeriesPackNativeNetworkV1(
  tx: Prisma.TransactionClient,
  frame: Frame,
  network: SeriesPackNativeNetworkEvidenceV3,
  input: {
    budget: PublicationAuthorityReadBudget;
    freshness: PlexBindingFreshness;
    startedAt: string;
  },
) {
  if (frame.transaction !== tx)
    throw new Error("Native pack paired writer has a foreign transaction");
  const { budget, freshness } = input;
  freshness.assertActive();
  assertNativeEvidenceFresh(network);
  if (
    network.originalWorkflowClosed.operationId !==
    frame.scope.publication.intent.seriesPackPublication.coordinatorOperationId
  )
    throw new Error(
      "Native pack paired writer has another original coordinator",
    );
  reserveSeriesPackNativeSqlV1(budget, frame.scope, "batch");
  const parent = {
    schemaVersion: 2 as const,
    protocol: "series_pack_publication_v3" as const,
    lifecycleKind: "publication_compensation" as const,
    purpose:
      frame.continuation === null
        ? ("native_review" as const)
        : ("native_execution" as const),
    networkKind:
      frame.continuation === null
        ? ("network" as const)
        : ("compensation_network" as const),
    planId: frame.plan.id,
    scopeHash: identityHash(frame.scope),
    recoveryEpoch: frame.plan.recoveryEpoch,
    operationId: frame.operation.id,
    continuationId: frame.continuation?.id ?? null,
    descriptorHash: frame.continuation?.descriptorHash ?? null,
  };
  const batchId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const networkRow = await tx.nativeRecoveryObservation.create({
    data: {
      createdAt: new Date(),
      planId: frame.plan.id,
      kind: parent.networkKind,
      evidence: z.record(z.string(), z.json()).parse(network),
      evidenceHash: identityHash(network),
      observedAt: new Date(network.capturedAt),
      expiresAt: new Date(network.expiresAt),
    },
  });
  const networkRef = {
    observationId: networkRow.id,
    evidenceHash: networkRow.evidenceHash,
  };
  const envelope = SeriesPackNativePlexEnvelopeV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    parent,
    batchId,
    network: networkRef,
    observation: network.plex,
  });
  const plexRow = await tx.nativeRecoveryObservation.create({
    data: {
      createdAt: new Date(),
      planId: frame.plan.id,
      kind: "plex_association",
      evidence: z.record(z.string(), z.json()).parse(envelope),
      evidenceHash: identityHash(envelope),
      observedAt: new Date(completedAt),
      expiresAt: new Date(network.expiresAt),
    },
  });
  const batch = SeriesPackNativePlexBatchV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    batchId,
    parent,
    network: networkRef,
    plex: { observationId: plexRow.id, evidenceHash: plexRow.evidenceHash },
    identityHash: identityHash(seriesPackNativeNetworkIdentityV1(network)),
    identityRaw: canonicalJson(
      z.json().parse(seriesPackNativeNetworkIdentityV1(network)),
    ),
    scopeRaw: canonicalJson(z.json().parse(frame.scope)),
    networkRaw: canonicalJson(z.json().parse(network)),
    plexRaw: canonicalJson(z.json().parse(envelope)),
    startedAt: input.startedAt,
    completedAt,
    sessionsCheckedAt: network.plex.playback.checkedAt,
    expiresAt: network.expiresAt,
  });
  const saved = await tx.nativePlexProofBatch.create({
    data: {
      createdAt: new Date(),
      id: batchId,
      planId: frame.plan.id,
      operationId: frame.operation.id,
      networkObservationId: networkRow.id,
      plexObservationId: plexRow.id,
      batch: z.record(z.string(), z.json()).parse(batch),
      batchHash: identityHash(batch),
    },
  });
  const ref = SeriesPackNativePlexRefV2Schema.parse({
    batchId,
    batchHash: saved.batchHash,
    parent,
    network: batch.network,
    plex: batch.plex,
    identityHash: batch.identityHash,
  });
  const previous =
    frame.operation.result === null
      ? {}
      : z.record(z.string(), z.json()).parse(frame.operation.result);
  const command = z.record(z.string(), z.json()).parse(frame.operation.payload);
  const updated = await tx.operation.updateMany({
    where: {
      id: frame.operation.id,
      kind: frame.operation.kind,
      payload: { equals: command },
      result: {
        equals: frame.operation.result ?? Prisma.DbNull,
      },
    },
    data: {
      result: z
        .record(z.string(), z.json())
        .parse({ ...previous, seriesPackNativePlexProofV2: ref }),
    },
  });
  if (updated.count !== 1)
    throw new Error(
      "Native pack paired proof pointer changed during its real observation",
    );
  freshness.assertActive();
  return ref;
}
