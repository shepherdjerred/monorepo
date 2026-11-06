import { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type {
  PlexBindingLockScope,
  PlexPublicationParent,
} from "#shared/plex-binding/expected.ts";
import type { SeriesPackNativeActivityV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { assertNoPendingSeriesPackPublicationV1 } from "#infrastructure/acquisition-identity/series-pack/publication/fence.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { lockSeriesPackNativeScopeV1 } from "#infrastructure/native-compensation/series-pack/locks.ts";
import { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";
import {
  assertSeriesPackNativePublicationCurrentV1,
  assertSeriesPackNativeGenerationsV1,
} from "./current.ts";
import { assertSeriesPackNativePublicationCommandV1 } from "./record.ts";

type Timing = {
  observed: { wall: number; monotonic: number };
  originalFreshness: PlexBindingFreshness;
  expectedAuthorityHash?: string;
};

/** New descriptor-2 serving phase. Every historical model in this graph was
 * queried in THIS transaction and paid by THIS original Activity allowance.
 * The old descriptor-1 phase and parser remain separate literal code paths. */
export async function loadSeriesPackNativePublicationPhaseV1(
  tx: Prisma.TransactionClient,
  activity: SeriesPackNativeActivityV1,
  timing: Timing,
  budget: PublicationAuthorityReadBudget,
) {
  timing.originalFreshness.assertActive();
  const locator =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
      select: { descriptor: true, descriptorHash: true },
    });
  budget.consume(1);
  if (identityHash(locator.descriptor) !== locator.descriptorHash)
    throw new Error(
      "Native pack serving locator lost its literal descriptor hash",
    );
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
    locator.descriptor,
  );
  await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
  const users = await tx.mediaUser.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (users.length > 100)
    throw new NativeCompensationProtection(
      "compensation_household_reconciliation_required",
    );
  if (users.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(users.map((row) => row.id))}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(users.map((row) => row.id))}) ORDER BY "userId" FOR SHARE`,
    );
  }
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    activity.continuationId,
    budget,
  );
  if (
    record.row.descriptorHash !== locator.descriptorHash ||
    record.completion === null ||
    record.row.fenceRelease !== null ||
    record.row.verifiedPublication !== null
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${activity.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  budget.consume(1);
  await assertNativeOwner(tx, record.row.receipt.actorId);
  budget.consume(1);
  await assertLegacyClaimsResolved(tx, record.row.mediaIds, budget);
  const identity = assertSeriesPackNativePublicationCommandV1(
    record,
    operation,
    activity,
  );
  await assertNativeStorageRoots(tx, descriptor.scope.storageRoots, budget);
  const current = await assertSeriesPackNativePublicationCurrentV1(
    tx,
    record,
    timing,
  );
  assertSeriesPackNativeGenerationsV1(
    identity.command.generations,
    current.generations,
  );
  const overlaps = await tx.nativePublicationCompensationContinuation.count({
    where: {
      id: { not: record.row.id },
      fenceRelease: { equals: Prisma.DbNull },
      OR: [
        { mediaIds: { hasSome: record.row.mediaIds } },
        { assetIds: { hasSome: record.row.assetIds } },
      ],
    },
  });
  if (overlaps !== 0)
    throw new NativeCompensationProtection(
      "compensation_unrelated_fence_active",
    );
  await assertNoPendingSeriesPackPublicationV1(tx, {
    mediaIds: record.row.mediaIds,
    assetIds: record.row.assetIds,
    seriesPackPublicationAttemptId:
      record.publication.reference.intent.attemptId,
  });
  const authority = {
    continuationId: record.row.id,
    publicationOperationId: operation.id,
    recoveryEpoch: record.row.recoveryEpoch,
    completionHash: identity.completionHash,
    bindingsHash: identity.bindingsHash,
    commandHash: identity.commandHash,
    generations: identity.command.generations,
    mediaIds: record.row.mediaIds,
    assets: identity.assets,
    ancestorFenceIds: [record.row.id],
    verifiedPublication: null,
    freshness: current.freshness,
  };
  const phase = {
    protocol: "series_pack_publication_v3" as const,
    transaction: tx,
    activity,
    budget,
    record,
    operation,
    authority,
    parent: {
      kind: "compensation",
      continuationId: record.row.id,
      receiptId: record.row.receiptId,
      planHash: record.row.receipt.planHash,
      descriptorHash: record.row.descriptorHash,
      completionHash: authority.completionHash,
      operationId: operation.id,
      recoveryEpoch: record.row.recoveryEpoch,
    } satisfies Extract<PlexPublicationParent, { kind: "compensation" }>,
    mediaIds: [...record.row.mediaIds].sort(),
    assetIds: [...record.row.assetIds].sort(),
    userIds: users.map((row) => row.id),
    timing,
    freshness: current.freshness,
    closed: false,
  };
  snapshots.set(phase, phaseIdentity(phase));
  if (
    timing.expectedAuthorityHash !== undefined &&
    seriesPackNativePublicationAuthorityHashV1(authority) !==
      timing.expectedAuthorityHash
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
  await bindPlexTransactionDeadline(tx, phase.freshness);
  return phase;
}

export type SeriesPackNativePublicationPhaseV1 = Awaited<
  ReturnType<typeof loadSeriesPackNativePublicationPhaseV1>
>;
const snapshots = new WeakMap<SeriesPackNativePublicationPhaseV1, string>();
const phaseIdentity = (phase: SeriesPackNativePublicationPhaseV1) =>
  identityHash(
    nativeJson({
      record: phase.record.row,
      operation: phase.operation,
      parent: phase.parent,
      mediaIds: phase.mediaIds,
      assetIds: phase.assetIds,
      userIds: phase.userIds,
    }),
  );

export function seriesPackNativePublicationAuthorityHashV1(
  authority: SeriesPackNativePublicationPhaseV1["authority"],
) {
  const { freshness: _freshness, ...identity } = authority;
  return identityHash(identity);
}

export function assertSeriesPackNativePublicationPhaseV1(
  tx: Prisma.TransactionClient,
  phase: SeriesPackNativePublicationPhaseV1,
  budget: PublicationAuthorityReadBudget,
) {
  if (
    phase.transaction !== tx ||
    phase.record.transaction !== tx ||
    phase.budget !== budget ||
    phase.closed ||
    snapshots.get(phase) !== phaseIdentity(phase)
  )
    throw new Error(
      "Native pack serving phase is closed, mutated, forged or belongs to another transaction/budget",
    );
  phase.freshness.assertActive();
  return phase;
}

export function assertSeriesPackNativePublicationLockScopeV1(
  tx: Prisma.TransactionClient,
  phase: SeriesPackNativePublicationPhaseV1,
  scope: PlexBindingLockScope,
  budget: PublicationAuthorityReadBudget,
) {
  assertSeriesPackNativePublicationPhaseV1(tx, phase, budget);
  if (
    scope.expected.parents.length !== 1 ||
    identityHash(scope.expected.parents[0]) !== identityHash(phase.parent) ||
    identityHash(scope.mediaIds) !== identityHash(phase.mediaIds) ||
    scope.assetIds.some((id) => !phase.assetIds.includes(id)) ||
    scope.userIds.some((id) => !phase.userIds.includes(id)) ||
    !phase.userIds.includes(phase.record.row.receipt.actorId)
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
}

export async function assertSeriesPackNativePublicationPhaseCurrentV1(
  tx: Prisma.TransactionClient,
  phase: SeriesPackNativePublicationPhaseV1,
  budget: PublicationAuthorityReadBudget,
) {
  assertSeriesPackNativePublicationPhaseV1(tx, phase, budget);
  const current = await assertSeriesPackNativePublicationCurrentV1(
    tx,
    phase.record,
    {
      ...phase.timing,
      originalFreshness: phase.freshness,
    },
  );
  assertSeriesPackNativeGenerationsV1(
    phase.authority.generations,
    current.generations,
  );
  phase.freshness = current.freshness;
  await bindPlexTransactionDeadline(tx, phase.freshness);
  return phase.authority;
}
