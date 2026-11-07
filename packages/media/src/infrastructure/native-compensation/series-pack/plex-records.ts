import type { Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { z } from "zod";
import {
  SeriesPackNativePlexRefV2Schema,
  SeriesPackNativePlexBatchV2Schema,
  SeriesPackNativePlexEnvelopeV2Schema,
  SeriesPackNativeNetworkEvidenceV3Schema,
  type SeriesPackNativePlexRefV2,
  type SeriesPackNativeNetworkEvidenceV3,
} from "#shared/native-recovery/series-pack/evidence.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { assertNativeEvidenceFresh } from "#infrastructure/native-recovery/evidence-freshness.ts";

type Plan = Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>;

export function seriesPackNativeNetworkIdentityV1(
  evidence: SeriesPackNativeNetworkEvidenceV3,
) {
  const closed = (
    row:
      | SeriesPackNativeNetworkEvidenceV3["originalWorkflowClosed"]
      | SeriesPackNativeNetworkEvidenceV3["originalAcquisitionClosed"]
      | null,
  ) => {
    if (row === null) return null;
    const { observedAt: _observedAt, ...identity } = row;
    return identity;
  };
  return {
    schemaVersion: 3,
    lifecycleKind: evidence.lifecycleKind,
    protocol: evidence.protocol,
    planId: evidence.planId,
    recoveryEpoch: evidence.recoveryEpoch,
    access: evidence.access,
    configurationDigest: evidence.mounts.configurationDigest,
    targetsDigest: evidence.quiescence.targetsDigest,
    controllers: evidence.quiescence.controllers,
    mounts: evidence.mounts.mounts,
    originalWorkflowClosed: closed(evidence.originalWorkflowClosed),
    originalAcquisitionClosed: closed(evidence.originalAcquisitionClosed),
    previousWorkflowClosed: closed(evidence.previousWorkflowClosed),
    plex: {
      canonicalPaths: evidence.plex.canonicalPaths,
      retainedAbsence: evidence.plex.retainedAbsence.map(
        ({ inventoryDigest: _digest, ...row }) => row,
      ),
      inventory: evidence.plex.inventory.map(({ sectionId, kind }) => ({
        sectionId,
        kind,
      })),
      playback: {
        state: evidence.plex.playback.state,
        scopeHash: evidence.plex.playback.scopeHash,
      },
    },
    torrents: evidence.torrents,
  };
}

/** Four actual parents: immutable batch + command + both observations. The
 * exact plan is an actual queried same-TX parent supplied by the new caller. */
export async function loadSeriesPackNativePlexV1(
  tx: Prisma.TransactionClient,
  rawRef: SeriesPackNativePlexRefV2,
  queried: {
    transaction: Prisma.TransactionClient;
    budget: PublicationAuthorityReadBudget;
    plan: Plan;
  },
  freshness?: PlexBindingFreshness,
) {
  if (queried.transaction !== tx)
    throw new Error(
      "Native pack paired proof has a foreign transaction parent",
    );
  const ref = SeriesPackNativePlexRefV2Schema.parse(rawRef);
  freshness?.assertActive();
  const row = await tx.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
    include: {
      operation: true,
      networkObservation: true,
      plexObservation: true,
    },
  });
  queried.budget.consume(4);
  const batch = SeriesPackNativePlexBatchV2Schema.parse(row.batch);
  const plan = queried.plan;
  const command =
    ref.parent.purpose === "native_execution"
      ? z
          .strictObject({
            schemaVersion: z.literal(1),
            kind: z.literal("compensate_series_pack_native_publication_v1"),
            operationId: z.uuid(),
            recoveryEpoch: z.int().nonnegative(),
            continuationId: z.uuid(),
          })
          .parse(row.operation.payload)
      : row.operation.kind === "prepare_series_pack_native_compensation_v1"
        ? z
            .strictObject({
              kind: z.literal("prepare_series_pack_native_compensation_v1"),
              operationId: z.uuid(),
              recoveryEpoch: z.int().nonnegative(),
              planId: z.uuid(),
            })
            .parse(row.operation.payload)
        : z
            .strictObject({
              kind: z.literal("apply_series_pack_native_compensation_v1"),
              operationId: z.uuid(),
              recoveryEpoch: z.int().nonnegative(),
              planId: z.uuid(),
              planHash: z.string().regex(/^[a-f0-9]{64}$/u),
              actorId: z.uuid(),
            })
            .parse(row.operation.payload);
  const network = SeriesPackNativeNetworkEvidenceV3Schema.parse(
    row.networkObservation.evidence,
  );
  const plex = SeriesPackNativePlexEnvelopeV2Schema.parse(
    row.plexObservation.evidence,
  );
  const origin = z
    .object({
      publication: z.object({
        intent: z.object({
          attemptId: z.uuid(),
          seriesPackPublication: z.object({ coordinatorOperationId: z.uuid() }),
        }),
      }),
    })
    .parse(plan.scope).publication.intent;
  const assertOriginalClosures = () => {
    if (
      network.originalWorkflowClosed.operationId !==
        origin.seriesPackPublication.coordinatorOperationId ||
      network.originalAcquisitionClosed.operationId !==
        origin.seriesPackPublication.coordinatorOperationId ||
      network.originalAcquisitionClosed.attemptId !== origin.attemptId
    )
      throw new Error(
        "Native pack paired proof names another original coordinator or acquisition",
      );
  };
  const commandMatchesParent = () => {
    switch (command.kind) {
      case "prepare_series_pack_native_compensation_v1":
        return command.planId === plan.id;
      case "apply_series_pack_native_compensation_v1":
        return command.planId === plan.id && command.actorId === plan.actorId;
      case "compensate_series_pack_native_publication_v1":
        return command.continuationId === ref.parent.continuationId;
    }
  };
  const assertPairedGraph1 = () => {
    if (
      identityHash(row.batch) !== row.batchHash ||
      row.batchHash !== ref.batchHash ||
      batch.batchId !== row.id ||
      row.planId !== plan.id ||
      row.operationId !== ref.parent.operationId ||
      row.operation.id !== ref.parent.operationId ||
      row.operation.userId !== plan.actorId ||
      command.operationId !== row.operation.id
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph1();
  const assertPairedGraph2 = () => {
    if (
      command.kind !== row.operation.kind ||
      command.recoveryEpoch !== plan.recoveryEpoch ||
      !commandMatchesParent() ||
      row.operation.targetId !==
        (ref.parent.purpose === "native_review"
          ? plan.id
          : ref.parent.continuationId) ||
      (ref.parent.purpose === "native_review"
        ? ![
            "prepare_series_pack_native_compensation_v1",
            "apply_series_pack_native_compensation_v1",
          ].includes(row.operation.kind)
        : row.operation.kind !==
          "compensate_series_pack_native_publication_v1") ||
      ref.parent.planId !== plan.id ||
      ref.parent.recoveryEpoch !== plan.recoveryEpoch ||
      identityHash(plan.scope) !== ref.parent.scopeHash
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph2();
  const assertPairedGraph3 = () => {
    if (
      identityHash(batch.parent) !== identityHash(ref.parent) ||
      identityHash(batch.network) !== identityHash(ref.network) ||
      identityHash(batch.plex) !== identityHash(ref.plex) ||
      batch.identityHash !== ref.identityHash ||
      row.networkObservationId !== ref.network.observationId ||
      row.plexObservationId !== ref.plex.observationId ||
      row.networkObservation.planId !== plan.id ||
      row.plexObservation.planId !== plan.id
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph3();
  const assertPairedGraph4 = () => {
    if (
      row.networkObservation.kind !== ref.parent.networkKind ||
      row.plexObservation.kind !== "plex_association" ||
      row.networkObservation.evidenceHash !==
        identityHash(row.networkObservation.evidence) ||
      row.plexObservation.evidenceHash !==
        identityHash(row.plexObservation.evidence) ||
      ref.network.evidenceHash !== row.networkObservation.evidenceHash ||
      ref.plex.evidenceHash !== row.plexObservation.evidenceHash ||
      batch.scopeRaw !== canonicalJson(z.json().parse(plan.scope)) ||
      batch.networkRaw !==
        canonicalJson(z.json().parse(row.networkObservation.evidence))
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph4();
  const assertPairedGraph5 = () => {
    if (
      batch.plexRaw !==
        canonicalJson(z.json().parse(row.plexObservation.evidence)) ||
      batch.identityRaw !==
        canonicalJson(
          z.json().parse(seriesPackNativeNetworkIdentityV1(network)),
        ) ||
      batch.identityHash !==
        identityHash(seriesPackNativeNetworkIdentityV1(network)) ||
      network.planId !== plan.id ||
      network.recoveryEpoch !== plan.recoveryEpoch ||
      identityHash(plex.parent) !== identityHash(ref.parent) ||
      plex.batchId !== row.id ||
      identityHash(plex.network) !== identityHash(ref.network)
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph5();
  const assertPairedGraph6 = () => {
    if (
      identityHash(plex.observation) !== identityHash(network.plex) ||
      row.networkObservation.observedAt.toISOString() !== network.capturedAt ||
      row.networkObservation.expiresAt.toISOString() !== batch.expiresAt ||
      row.plexObservation.expiresAt.toISOString() !== batch.expiresAt ||
      network.expiresAt !== batch.expiresAt ||
      network.plex.playback.checkedAt !== batch.sessionsCheckedAt
    )
      throw new Error(
        "Native pack paired proof lost its actual immutable command/plan/observation graph",
      );
  };
  assertPairedGraph6();
  assertOriginalClosures();
  if (freshness !== undefined) {
    assertNativeEvidenceFresh(network);
    if (freshness.expiresAtMs > Date.parse(batch.expiresAt))
      throw new Error(
        "Native pack phase exceeds its original paired proof deadline",
      );
    freshness.assertActive();
  }
  return { row, ref, batch, network, plex };
}
