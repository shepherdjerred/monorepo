import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import {
  NativeCompensationScopeSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { hasPendingLegacyClaims } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { lockNativeSubtitleRows } from "#automation/native-subtitles/snapshot.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import {
  nativeJson,
  nativeHousehold,
  NativeHouseholdSchema,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { captureInterruptedPublicationWorkFromIntent } from "#infrastructure/publication-proof/lifecycle.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import {
  type compensationRecord,
  type compensationAncestors,
  lockedCompensationAncestors,
  readCompensationLockDescriptor,
} from "./records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { buildNativeCompensationScopeProjection } from "./scope.ts";
import { assertValidatedCompensationFenceOwner } from "./fence.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { archiveMedia } from "#infrastructure/native-archive/snapshots.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";

export async function lockNativeCompensationScope(
  tx: Prisma.TransactionClient,
  scope: NativeCompensationScope,
): Promise<void> {
  const ids = scope.intent.mediaIds;
  const assets = [
    ...new Set(
      scope.intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  await lockDefaultMedia(tx, ids);
  await lockEffectiveRequests(tx, ids);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id='singleton' FOR UPDATE`;
  await hasPendingLegacyClaims(tx, ids);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "UpgradeCleanup" WHERE "assetId" IN (${Prisma.join(assets)}) OR "successorAssetId" IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
  );
  await lockNativeSubtitleRows(tx, assets);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE "mediaIds" && ARRAY[${Prisma.join(ids)}]::text[] ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw`SELECT id FROM "MediaPublicationTransition" WHERE id=${scope.transition.transitionId} FOR UPDATE`;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "NativePublicationCompensationContinuation" WHERE "mediaIds" && ARRAY[${Prisma.join(ids)}]::text[] OR "assetIds" && ARRAY[${Prisma.join(assets)}]::text[] ORDER BY id FOR UPDATE`,
  );
  await lockSubtitlePolicies(tx);
  const profiles = scope.media.flatMap((row) =>
    row.profile === null
      ? []
      : [z.object({ id: z.uuid() }).parse(row.profile).id],
  );
  if (profiles.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id IN (${Prisma.join(profiles)}) ORDER BY id FOR SHARE`,
    );
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" ORDER BY "rootPath" FOR UPDATE`;
}

export async function assertNativeCompensationSnapshot(
  tx: Prisma.TransactionClient,
  input: { planId: string; scope: NativeCompensationScope },
  budget = new PublicationAuthorityReadBudget(),
) {
  await assertNativeExclusion(tx);
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const authority = await runtimeAuthority(tx);
  budget.consume(1);
  if (
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    runtime.version !== plan.runtimeVersion ||
    plan.restoreOperationId !== input.scope.request.restoreOperationId ||
    (input.scope.request.activation === "activate"
      ? runtime.mode !== "observe" || runtime.ownershipConfirmed
      : !authority.active)
  )
    throw new NativeCompensationProtection("compensation_runtime_changed");
  if (
    snapshotHash(
      nativeJson(NativeCompensationScopeSchema.parse(plan.scope)),
    ) !== snapshotHash(nativeJson(input.scope))
  )
    throw new NativeCompensationProtection(
      "compensation_reviewed_records_changed",
    );
  const projection = await buildNativeCompensationScopeProjection(
    tx,
    input.scope.request,
    budget,
    input.scope.storageRoots,
  );
  const current = projection.scope;
  if (
    snapshotHash(nativeJson(current)) !== snapshotHash(nativeJson(input.scope))
  )
    throw new NativeCompensationProtection(
      "compensation_reviewed_records_changed",
    );
  return { plan, runtime, scope: current, projection };
}

export async function assertCompensationOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  try {
    return await assertNativeOwner(tx, actorId);
  } catch (error) {
    if (error instanceof MediaError && error.code === "forbidden")
      throw new NativeCompensationProtection("compensation_owner_changed");
    throw error;
  }
}

export async function assertNativeCompensation(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  budget = new PublicationAuthorityReadBudget(),
  projection?: NativeReceiptReadPort,
): Promise<CompensationExecutionAuthority> {
  const phase = await assertNativeCompensationPhase(
    tx,
    input,
    budget,
    projection,
  );
  return phase.authority;
}

type CompensationRecord = Awaited<ReturnType<typeof compensationRecord>>;
export type CompensationExecutionAuthority = {
  continuationId: string;
  receiptId: string;
  planId: string;
  version: number;
  recoveryEpoch: number;
  descriptor: CompensationRecord["descriptor"];
  descriptorHash: string;
  execution: CompensationRecord["execution"];
  completion: CompensationRecord["completion"];
  networkScope: NativeCompensationScope;
};
export type CompensationExecutionPhase = {
  transaction: Prisma.TransactionClient;
  activity: NativeCompensationActivityInput;
  authority: CompensationExecutionAuthority;
  chain: Awaited<ReturnType<typeof compensationAncestors>>;
  operation: Prisma.OperationGetPayload<Record<string, never>>;
  budget: PublicationAuthorityReadBudget;
  plex: { ref: NativePlexProofRef; expiresAtMs: number } | null;
  closed: boolean;
};

/** One full locked current authority and immutable closure, never reusable across transactions. */
export async function assertNativeCompensationPhase(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  budget: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
): Promise<CompensationExecutionPhase> {
  projection?.assertTransaction(tx, budget);
  const initial = await readCompensationLockDescriptor(
    tx,
    input.continuationId,
    budget,
  );
  await lockNativeCompensationScope(tx, initial.descriptor.scope);
  const chain = await lockedCompensationAncestors(
    tx,
    {
      id: input.continuationId,
      transitionId: initial.descriptor.scope.transition.transitionId,
    },
    budget,
    projection,
  );
  const record = chain[0];
  if (record?.row.descriptorHash !== initial.descriptorHash)
    throw new NativeCompensationProtection(
      "compensation_reviewed_records_changed",
    );
  const { row, descriptor, execution, completion } = record;
  if (
    row.coordinatorOperationId !== input.operationId ||
    row.recoveryEpoch !== input.recoveryEpoch ||
    !["pending", "compensating", "protected", "compensated"].includes(row.state)
  )
    throw new NativeCompensationProtection("compensation_coordinator_changed");
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const payload = z
    .strictObject({
      ...NativeCompensationActivityInputSchema.shape,
      kind: z.literal("compensate_native_publication"),
    })
    .parse(operation.payload);
  const { kind: _kind, ...activity } = payload;
  if (
    operation.kind !== "compensate_native_publication" ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    snapshotHash(activity) !== snapshotHash(input)
  )
    throw new NativeCompensationProtection("compensation_operation_changed");
  const authority: CompensationExecutionAuthority = {
    continuationId: row.id,
    receiptId: row.receiptId,
    planId: row.receipt.planId,
    version: row.version,
    recoveryEpoch: row.recoveryEpoch,
    descriptor,
    descriptorHash: row.descriptorHash,
    execution,
    completion,
    networkScope: descriptor.scope,
  };
  const phase: CompensationExecutionPhase = {
    transaction: tx,
    activity: input,
    authority,
    chain,
    operation,
    budget,
    plex: null,
    closed: false,
  };
  if (completion !== null) return phase;
  await assertCompensationOwner(tx, row.receipt.actorId);
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeCompensationProtection("compensation_runtime_protected");
  {
    await assertValidatedCompensationFenceOwner(
      tx,
      {
        activity: input,
        purpose: "compensate",
      },
      chain,
      budget,
    );
    for (const file of descriptor.scope.files) {
      const current = await snapshotPublicationAsset(tx, file.assetId);
      if (
        current.version !== file.assetVersion ||
        current.ownershipEpoch !== file.ownershipEpoch ||
        current.checksum !== file.checksum ||
        current.path !== file.canonicalPath ||
        snapshotHash(nativeJson(current.subtitles)) !==
          snapshotHash(nativeJson(file.subtitles))
      )
        throw new NativeCompensationProtection(
          "compensation_predecessor_changed",
        );
    }
  }
  authority.networkScope = await currentCompensationScope(tx, record);
  await assertCompensationPhaseCurrent(tx, phase);
  return phase;
}

export function assertCompensationPhaseTransaction(
  tx: Prisma.TransactionClient,
  phase: CompensationExecutionPhase,
) {
  if (phase.transaction !== tx || phase.closed)
    throw new Error(
      "Compensation phase is closed or belongs to another transaction",
    );
  const record = phase.chain[0];
  if (record === undefined)
    throw new Error("Compensation phase omitted its queried record");
  return record;
}

/** Locked identities/coordinator stay fixed; unlocked knowledge and exclusion are re-read. */
export async function assertCompensationPhaseCurrent(
  tx: Prisma.TransactionClient,
  phase: CompensationExecutionPhase,
): Promise<void> {
  const record = assertCompensationPhaseTransaction(tx, phase);
  if (phase.authority.completion !== null)
    throw new Error(
      "Completed compensation phase cannot authorize new effects",
    );
  await assertNoSubtitleReplacement(tx, record.row.assetIds);
  await assertNativeExclusion(tx);
  const interrupted = await captureInterruptedPublicationWorkFromIntent(
    tx,
    record.original,
    phase.budget,
    record.queriedParent,
  );
  if (
    snapshotHash(nativeJson(interrupted)) !==
    snapshotHash(nativeJson(record.descriptor.scope.interruptedWork))
  )
    throw new NativeCompensationProtection(
      "compensation_interrupted_work_changed",
    );
  const current = await currentCompensationScope(tx, record);
  if (
    snapshotHash(nativeJson(current)) !==
    snapshotHash(nativeJson(phase.authority.networkScope))
  )
    throw new NativeCompensationProtection(
      "compensation_reviewed_records_changed",
    );
}

async function currentCompensationScope(
  tx: Prisma.TransactionClient,
  record: Awaited<ReturnType<typeof compensationRecord>>,
) {
  const { row, descriptor } = record;
  const media = await archiveMedia(tx, row.mediaIds);
  if (
    snapshotHash(nativeJson(media)) !==
    snapshotHash(nativeJson(descriptor.scope.media))
  )
    throw new NativeCompensationProtection(
      "compensation_current_intent_or_catalog_changed",
    );
  const ancestors = media.flatMap((item) =>
    [item.parent?.id, item.parent?.parent?.id].filter((id) => id !== undefined),
  );
  const household = await nativeHousehold(tx, row.mediaIds, ancestors);
  const reviewedHousehold = NativeHouseholdSchema.parse(
    descriptor.scope.household,
  );
  for (const key of ["requests", "coverage", "personalHolds"] as const)
    if (
      snapshotHash(nativeJson(household[key])) !==
      snapshotHash(nativeJson(reviewedHousehold[key]))
    )
      throw new NativeCompensationProtection("compensation_household_changed");
  const holds = record.selection.compensationAuthorization.recoveryHoldBindings;
  if (
    household.recoveryHolds.length !== row.mediaIds.length ||
    holds.length !== row.mediaIds.length ||
    household.recoveryHolds.some(
      (hold) =>
        hold["releasedAt"] !== null ||
        !holds.some(
          (binding) =>
            binding.mediaId === hold.mediaId &&
            binding.version === hold.version &&
            binding.recoveryEpoch === hold.recoveryEpoch,
        ),
    )
  )
    throw new NativeCompensationProtection(
      "compensation_recovery_hold_changed",
    );
  return NativeCompensationScopeSchema.parse({
    ...descriptor.scope,
    media,
    household,
  });
}
