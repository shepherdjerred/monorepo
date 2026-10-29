import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeCompensationPublicationCommandSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type {
  PlexBindingLockScope,
  PlexPublicationParent,
} from "#shared/plex-binding/expected.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  runtimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { publicationPhysicalSnapshot } from "#infrastructure/publication-proof/projection.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  type compensationAncestors,
  lockedCompensationAncestors,
  readCompensationLockDescriptor,
} from "#infrastructure/native-compensation/records.ts";
import {
  lockNativeCompensationScope,
  assertCompensationOwner,
} from "#infrastructure/native-compensation/guards.ts";
import { assertValidatedCompensationFenceOwner } from "#infrastructure/native-compensation/fence.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { publicationFreshness } from "#infrastructure/native-compensation/publication-freshness.ts";

type Chain = Awaited<ReturnType<typeof compensationAncestors>>;
type CompensationRecord = Chain[number];
type CompletedRecord = CompensationRecord & {
  completion: NonNullable<CompensationRecord["completion"]>;
};
export type CompensationPublicationTiming = {
  observed: { wall: number; monotonic: number };
  originalFreshness: PlexBindingFreshness;
  expectedAuthorityHash?: string;
};
export type CompensationPublicationPhase = {
  transaction: Prisma.TransactionClient;
  activity: NativeCompensationActivityInput;
  budget: PublicationAuthorityReadBudget;
  chain: Chain;
  record: CompletedRecord;
  operation: Operation;
  authority: ReturnType<typeof publicationAuthority>;
  parent: Extract<PlexPublicationParent, { kind: "compensation" }>;
  mediaIds: string[];
  assetIds: string[];
  userIds: string[];
  timing: CompensationPublicationTiming;
  freshness: PlexBindingFreshness;
  closed: boolean;
};

/** Full fresh publication authority. Nothing in this object is reusable in another TX. */
export async function loadCompensationPublicationPhase(
  tx: Prisma.TransactionClient,
  activity: NativeCompensationActivityInput,
  timing: CompensationPublicationTiming,
  budget: PublicationAuthorityReadBudget,
): Promise<CompensationPublicationPhase> {
  timing.originalFreshness.assertActive();
  const locator = await readCompensationLockDescriptor(
    tx,
    activity.continuationId,
    budget,
  );
  // This is only a pre-lock membership locator; the native prelude below locks
  // every returned identity, and later common scope assertions cannot expand it.
  const users = await tx.mediaUser.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (users.length > 100)
    throw new NativeCompensationProtection(
      "compensation_household_reconciliation_required",
    );
  // This existing lock acquires canonical/targets/requests, runtime/lease UPDATE,
  // all bounded household identities/mappings, then cleanup/assets/continuations.
  await lockNativeCompensationScope(tx, locator.descriptor.scope);
  const chain = await lockedCompensationAncestors(
    tx,
    {
      id: activity.continuationId,
      transitionId: locator.descriptor.scope.transition.transitionId,
    },
    budget,
  );
  const head = chain[0];
  if (head?.row.descriptorHash !== locator.descriptorHash)
    throw new Error("Compensation publication lock descriptor changed");
  if (head.completion === null)
    throw new NativeCompensationProtection(
      "compensation_physical_completion_required",
    );
  if (head.row.verifiedPublication !== null || head.row.fenceRelease !== null)
    throw new NativeCompensationProtection("compensation_publication_changed");
  const record: CompletedRecord = { ...head, completion: head.completion };
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${activity.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  budget.consume(1);
  await assertNativeStorageRoots(
    tx,
    record.descriptor.scope.storageRoots,
    budget,
  );
  const current = await assertPublicationCurrentRows(tx, record, timing);
  const authority = publicationAuthority(
    record,
    chain,
    { activity, operation },
    current,
  );
  const phase: CompensationPublicationPhase = {
    transaction: tx,
    activity,
    budget,
    chain,
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
      operationId: activity.operationId,
      recoveryEpoch: activity.recoveryEpoch,
    },
    mediaIds: [...new Set(record.descriptor.scope.intent.mediaIds)].sort(),
    assetIds: [
      ...new Set(
        record.descriptor.scope.intent.entries.flatMap(({ entry }) => [
          entry.assetId,
          ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
        ]),
      ),
    ].sort(),
    userIds: users.map((row) => row.id),
    timing,
    freshness: current.freshness,
    closed: false,
  };
  await assertValidatedCompensationFenceOwner(
    tx,
    { activity, purpose: "publish" },
    chain,
    budget,
  );
  if (
    timing.expectedAuthorityHash !== undefined &&
    compensationPublicationAuthorityHash(authority) !==
      timing.expectedAuthorityHash
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
  await bindPlexTransactionDeadline(tx, phase.freshness);
  phase.freshness.assertActive();
  return phase;
}

export function compensationPublicationAuthorityHash(
  authority: ReturnType<typeof publicationAuthority>,
): string {
  const { freshness: _freshness, ...identity } = authority;
  return snapshotHash(nativeJson(identity));
}

export function assertCompensationPublicationPhase(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  budget: PublicationAuthorityReadBudget,
) {
  if (phase.transaction !== tx || phase.closed || phase.budget !== budget)
    throw new Error(
      "Compensation publication phase is closed or belongs to another transaction/budget",
    );
  phase.freshness.assertActive();
  return phase;
}

/** Pure closure assertion: the phase acquired this entire cohort before any asset lock. */
export function assertCompensationPublicationLockScope(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  scope: PlexBindingLockScope,
  budget: PublicationAuthorityReadBudget,
) {
  assertCompensationPublicationPhase(tx, phase, budget);
  if (
    scope.expected.parents.length !== 1 ||
    snapshotHash(nativeJson(scope.expected.parents[0])) !==
      snapshotHash(nativeJson(phase.parent)) ||
    snapshotHash(scope.mediaIds) !== snapshotHash(phase.mediaIds) ||
    scope.assetIds.some((id) => !phase.assetIds.includes(id)) ||
    scope.userIds.some((id) => !phase.userIds.includes(id)) ||
    !phase.userIds.includes(phase.record.row.receipt.actorId)
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
}

/** Re-read mutable knowledge/deadlines; immutable receipts stay queried exactly once in this TX. */
export async function assertCompensationPublicationPhaseCurrent(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  budget: PublicationAuthorityReadBudget,
) {
  assertCompensationPublicationPhase(tx, phase, budget);
  const current = await assertPublicationCurrentRows(tx, phase.record, {
    ...phase.timing,
    originalFreshness: phase.freshness,
  });
  const authority = publicationAuthority(
    phase.record,
    phase.chain,
    { activity: phase.activity, operation: phase.operation },
    current,
  );
  if (
    compensationPublicationAuthorityHash(authority) !==
    compensationPublicationAuthorityHash(phase.authority)
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
  await assertValidatedCompensationFenceOwner(
    tx,
    { activity: phase.activity, purpose: "publish" },
    phase.chain,
    budget,
  );
  phase.freshness = current.freshness;
  phase.authority = authority;
  await bindPlexTransactionDeadline(tx, phase.freshness);
  phase.freshness.assertActive();
  return authority;
}

async function assertPublicationCurrentRows(
  tx: Prisma.TransactionClient,
  record: CompletedRecord,
  timing: CompensationPublicationTiming,
) {
  const { row, descriptor, completion } = record;
  timing.originalFreshness.assertActive();
  await assertCompensationOwner(tx, row.receipt.actorId);
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeCompensationProtection(
      "compensation_publication_runtime_changed",
    );
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: row.mediaIds } },
    orderBy: { mediaId: "asc" },
  });
  const claims = await tx.mediaRequest.findMany({
    where: { ...effectiveRequestWhere, mediaId: { in: row.mediaIds } },
    select: { mediaId: true },
  });
  if (
    intents.length !== row.mediaIds.length ||
    intents.some(
      (intent) =>
        intent.automationEpoch !== row.recoveryEpoch ||
        !intent.desiredPresence ||
        !intent.monitoring ||
        intent.intentionallyRemovedAt !== null,
    ) ||
    row.mediaIds.some((id) => !claims.some((claim) => claim.mediaId === id))
  )
    throw new NativeCompensationProtection(
      "compensation_all_leaves_need_current_positive_intent",
    );
  if (
    await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: row.mediaIds },
        releasedAt: null,
      },
    })
  )
    throw new NativeCompensationProtection(
      "compensation_household_reconciliation_required",
    );
  await assertLegacyClaimsResolved(tx, row.mediaIds);
  const roots = await tx.mediaStorageAuthority.findMany({
    where: {
      rootPath: {
        in: descriptor.scope.storageRoots.map((item) => item.rootPath),
      },
    },
  });
  const now = Date.now();
  if (
    roots.length !== descriptor.scope.storageRoots.length ||
    roots.some(
      (root) =>
        root.revokedAt !== null ||
        root.recoveryEpoch !== row.recoveryEpoch ||
        root.observedAt.getTime() > now ||
        root.expiresAt.getTime() <= now ||
        root.expiresAt.getTime() - root.observedAt.getTime() > 120_000,
    )
  )
    throw new NativeCompensationProtection(
      "compensation_publication_storage_changed",
    );
  for (const binding of completion.predecessorBindings) {
    if (
      snapshotHash(
        nativeJson(
          publicationPhysicalSnapshot(
            await snapshotPublicationAsset(tx, binding.after.id),
          ),
        ),
      ) !== snapshotHash(nativeJson(publicationPhysicalSnapshot(binding.after)))
    )
      throw new NativeCompensationProtection(
        "compensation_publication_binding_changed",
      );
  }
  const assets = completion.predecessorBindings.map(({ after }) => ({
    assetId: after.id,
    assetVersion: after.version,
    checksum: after.checksum,
    mediaIds: after.coverage.map((item) => item.mediaId),
  }));
  if (
    !(await recordsAuthorized(tx, {
      epoch: row.recoveryEpoch,
      mediaIds: row.mediaIds,
      assetIds: assets.map((item) => item.assetId),
    }))
  )
    throw new NativeCompensationProtection(
      "compensation_publication_record_authority_changed",
    );
  const native = publicationFreshness(
    timing.observed,
    Math.min(
      timing.originalFreshness.expiresAtMs,
      lease.expiresAt.getTime(),
      ...roots.map((root) => root.expiresAt.getTime()),
    ),
  );
  const freshness = {
    expiresAtMs: native.expiresAtMs,
    assertActive() {
      timing.originalFreshness.assertActive();
      native.assertActive();
    },
  };
  freshness.assertActive();
  return {
    assets,
    generations: Object.fromEntries(
      intents.map((intent) => [intent.mediaId, intent.generation]),
    ),
    freshness,
  };
}

function publicationAuthority(
  record: CompletedRecord,
  chain: Chain,
  commandParent: {
    activity: NativeCompensationActivityInput;
    operation: Operation;
  },
  current: Awaited<ReturnType<typeof assertPublicationCurrentRows>>,
) {
  const { activity, operation } = commandParent;
  const { row, completion } = record;
  const completionHash = snapshotHash(nativeJson(completion));
  const bindingsHash = snapshotHash(nativeJson(completion.predecessorBindings));
  const {
    operationId,
    kind: _kind,
    ...command
  } = NativeCompensationPublicationCommandSchema.extend({
    operationId: z.uuid(),
    kind: z.literal("publish_compensated_media"),
  }).parse(operation.payload);
  if (
    row.publicationCoordinatorOperationId !== activity.operationId ||
    row.recoveryEpoch !== activity.recoveryEpoch
  )
    throw new NativeCompensationProtection(
      "compensation_publication_coordinator_changed",
    );
  if (
    operation.id !== activity.operationId ||
    operation.kind !== "publish_compensated_media" ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    operationId !== activity.operationId ||
    command.continuationId !== row.id ||
    command.recoveryEpoch !== row.recoveryEpoch ||
    command.completionHash !== completionHash ||
    command.bindingsHash !== bindingsHash ||
    snapshotHash(command.generations) !== snapshotHash(current.generations)
  )
    throw new NativeCompensationProtection(
      "compensation_publication_command_changed",
    );
  return {
    continuationId: row.id,
    publicationOperationId: activity.operationId,
    recoveryEpoch: row.recoveryEpoch,
    completionHash,
    commandHash: snapshotHash(command),
    bindingsHash,
    generations: current.generations,
    mediaIds: row.mediaIds,
    assets: current.assets,
    ancestorFenceIds: chain.map((item) => item.row.id),
    verifiedPublication: null,
    freshness: current.freshness,
  };
}
