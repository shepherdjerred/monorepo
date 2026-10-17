import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeCompensationPublicationCommandSchema,
  NativeCompensationVerifiedPublicationSchema,
  NativeCompensationFenceReleaseSchema,
  type NativeCompensationActivityInput,
  type NativeCompensationVerifiedPublication,
} from "#shared/native-recovery/compensation-runtime.ts";
import {
  ClosedCoordinatorObservationSchema,
  type ClosedCoordinatorObservation,
} from "#shared/publication-proof/references.ts";
import {
  runtimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { publicationPhysicalSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { compensationRecord, compensationAncestors } from "./records.ts";
import {
  lockNativeCompensationScope,
  assertCompensationOwner,
} from "./guards.ts";
import { assertCompensationFenceOwner } from "./fence.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { readVerifiedCompensationPublication } from "./publication-receipt.ts";
import { publicationFreshness } from "./publication-freshness.ts";

async function publicationContext(
  tx: Prisma.TransactionClient,
  continuationId: string,
) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const initial = await compensationRecord(tx, continuationId);
  await lockNativeCompensationScope(tx, initial.descriptor.scope);
  const record = await compensationRecord(tx, continuationId);
  const { row, descriptor, completion } = record;
  if (completion === null)
    throw new NativeCompensationProtection(
      "compensation_physical_completion_required",
    );
  await assertCompensationOwner(tx, row.receipt.actorId);
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeCompensationProtection(
      "compensation_publication_runtime_changed",
    );
  // The scope lock holds this exact lease and both storage roots through return.
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
  await assertNativeStorageRoots(tx, descriptor.scope.storageRoots);
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
  const completionHash = snapshotHash(nativeJson(completion));
  const bindingsHash = snapshotHash(nativeJson(completion.predecessorBindings));
  const generations = Object.fromEntries(
    intents.map((intent) => [intent.mediaId, intent.generation]),
  );
  const freshness = publicationFreshness(
    observed,
    Math.min(
      lease.expiresAt.getTime(),
      ...roots.map((root) => root.expiresAt.getTime()),
    ),
  );
  freshness.assertActive();
  return {
    ...record,
    completion,
    completionHash,
    bindingsHash,
    generations,
    assets,
    freshness,
  };
}

export async function queueCompensatedPublication(
  tx: Prisma.TransactionClient,
  input: {
    continuationId: string;
    triggerKey: string;
    previousWorkflowClosed?: ClosedCoordinatorObservation;
  },
): Promise<string | null> {
  const initial = await compensationRecord(tx, input.continuationId);
  if (initial.completion === null || initial.row.fenceRelease !== null)
    return null;
  let context;
  try {
    context = await publicationContext(tx, input.continuationId);
  } catch (error) {
    if (error instanceof NativeCompensationProtection) return null;
    throw error;
  }
  const { row, completionHash, bindingsHash, generations } = context;
  if (row.publicationCoordinatorOperationId !== null) {
    if (input.previousWorkflowClosed === undefined) return null;
    const closed = ClosedCoordinatorObservationSchema.parse(
      input.previousWorkflowClosed,
    );
    if (
      closed.operationId !== row.publicationCoordinatorOperationId ||
      Date.parse(closed.observedAt) > Date.now()
    )
      return null;
  }
  const command = NativeCompensationPublicationCommandSchema.parse({
    schemaVersion: 1,
    continuationId: row.id,
    recoveryEpoch: row.recoveryEpoch,
    completionHash,
    bindingsHash,
    generations,
  });
  const key = `compensation-publication:${row.id}:${String(row.version)}:${input.triggerKey}`;
  const existing = await tx.operation.findUnique({
    where: { idempotencyKey: key },
  });
  if (existing !== null) return existing.id;
  const operationId = crypto.randomUUID();
  const payload = {
    ...command,
    operationId,
    kind: "publish_compensated_media",
  };
  await tx.operation.create({
    data: {
      id: operationId,
      idempotencyKey: key,
      kind: "publish_compensated_media",
      targetId: row.id,
      userId: row.receipt.actorId,
      payload,
      outbox: { create: { kind: "publish_compensated_media", payload } },
    },
  });
  await tx.nativePublicationCompensationContinuation.update({
    where: { id: row.id },
    data: {
      publicationCoordinatorOperationId: operationId,
      version: { increment: 1 },
    },
  });
  return operationId;
}

function assertPublicationCommand(
  operation: Operation,
  binding: {
    command: z.infer<typeof NativeCompensationPublicationCommandSchema>;
    commandOperationId: string;
  },
  input: NativeCompensationActivityInput,
  context: Awaited<ReturnType<typeof publicationContext>>,
) {
  const { command, commandOperationId } = binding;
  const { row, completionHash, bindingsHash, generations } = context;
  if (
    operation.kind !== "publish_compensated_media" ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    commandOperationId !== input.operationId ||
    command.continuationId !== row.id ||
    command.recoveryEpoch !== row.recoveryEpoch ||
    command.completionHash !== completionHash ||
    command.bindingsHash !== bindingsHash ||
    snapshotHash(command.generations) !== snapshotHash(generations)
  )
    throw new NativeCompensationProtection(
      "compensation_publication_command_changed",
    );
}

export async function assertCompensatedPublication(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
) {
  const committed = await readVerifiedCompensationPublication(tx, input);
  if (committed !== null) return { ...committed, freshness: null };
  const context = await publicationContext(tx, input.continuationId);
  const { row, completionHash, bindingsHash, generations, assets } = context;
  if (
    row.publicationCoordinatorOperationId !== input.operationId ||
    row.recoveryEpoch !== input.recoveryEpoch
  )
    throw new NativeCompensationProtection(
      "compensation_publication_coordinator_changed",
    );
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const payload = NativeCompensationPublicationCommandSchema.extend({
    operationId: z.uuid(),
    kind: z.literal("publish_compensated_media"),
  }).parse(operation.payload);
  const { operationId: commandOperationId, kind: _kind, ...command } = payload;
  assertPublicationCommand(
    operation,
    { command, commandOperationId },
    input,
    context,
  );
  const chain = await compensationAncestors(tx, row.id);
  const commandHash = snapshotHash(command);
  const verifiedPublication =
    row.verifiedPublication === null
      ? null
      : NativeCompensationVerifiedPublicationSchema.parse(
          row.verifiedPublication,
        );
  if (verifiedPublication === null) {
    await assertCompensationFenceOwner(tx, {
      activity: input,
      purpose: "publish",
    });
  } else {
    if (
      verifiedPublication.continuationId !== row.id ||
      verifiedPublication.operationId !== input.operationId ||
      verifiedPublication.recoveryEpoch !== row.recoveryEpoch ||
      verifiedPublication.completionHash !== completionHash ||
      verifiedPublication.commandHash !== commandHash ||
      verifiedPublication.bindingsHash !== bindingsHash ||
      snapshotHash(verifiedPublication.generations) !==
        snapshotHash(generations)
    )
      throw new Error("Compensation verified publication binding changed");
    for (const ancestor of chain) {
      const release = NativeCompensationFenceReleaseSchema.parse(
        ancestor.row.fenceRelease,
      );
      if (
        release.continuationId !== ancestor.row.id ||
        release.transitionId !== ancestor.row.transitionId ||
        release.settlingContinuationId !== row.id ||
        release.settlingCompletionHash !== completionHash ||
        release.publicationHash !==
          snapshotHash(nativeJson(verifiedPublication))
      )
        throw new Error("Compensation fence release proof changed");
    }
  }
  context.freshness.assertActive();
  return {
    continuationId: row.id,
    publicationOperationId: input.operationId,
    recoveryEpoch: row.recoveryEpoch,
    completionHash,
    commandHash,
    bindingsHash,
    generations,
    mediaIds: row.mediaIds,
    assets,
    ancestorFenceIds: chain.map((item) => item.row.id),
    verifiedPublication,
    freshness: context.freshness,
  };
}
export type CompensationPublicationAuthority = Awaited<
  ReturnType<typeof assertCompensatedPublication>
>;

function assertPublicationCoverage(
  authority: CompensationPublicationAuthority,
  proof: NativeCompensationVerifiedPublication,
) {
  if (
    proof.continuationId !== authority.continuationId ||
    proof.operationId !== authority.publicationOperationId ||
    proof.recoveryEpoch !== authority.recoveryEpoch ||
    proof.completionHash !== authority.completionHash ||
    proof.commandHash !== authority.commandHash ||
    proof.bindingsHash !== authority.bindingsHash ||
    snapshotHash(proof.generations) !== snapshotHash(authority.generations) ||
    proof.items.length !== authority.mediaIds.length ||
    new Set(proof.items.map((item) => item.mediaId)).size !==
      authority.mediaIds.length
  )
    throw new Error(
      "Compensation verified publication omitted exact command coverage",
    );
}

export async function commitCompensatedPublication(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    publication: NativeCompensationVerifiedPublication;
  },
): Promise<void> {
  const authority = await assertCompensatedPublication(tx, input.activity);
  const proof = NativeCompensationVerifiedPublicationSchema.parse(
    input.publication,
  );
  if (authority.verifiedPublication !== null) {
    if (
      snapshotHash(nativeJson(authority.verifiedPublication)) !==
      snapshotHash(nativeJson(proof))
    )
      throw new Error("Compensation verified publication is immutable");
    return;
  }
  if (authority.freshness === null)
    throw new Error("Unverified publication lacks a live freshness fence");
  assertPublicationCoverage(authority, proof);
  for (const item of proof.items) {
    const asset = authority.assets.find((row) => row.assetId === item.assetId);
    const current = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: item.assetId },
    });
    if (
      asset === undefined ||
      !asset.mediaIds.includes(item.mediaId) ||
      asset.assetVersion !== item.assetVersion ||
      asset.checksum !== item.checksum ||
      current.path !== item.canonicalPath
    )
      throw new Error(
        "Compensation verified Plex item differs from completed physical binding",
      );
  }
  const chain = await compensationAncestors(tx, authority.continuationId);
  for (const ancestor of chain) {
    if (ancestor.row.fenceRelease !== null)
      throw new Error("Compensation ancestor fence was already released");
    const release = NativeCompensationFenceReleaseSchema.parse({
      schemaVersion: 1,
      continuationId: ancestor.row.id,
      transitionId: ancestor.row.transitionId,
      settlingContinuationId: authority.continuationId,
      settlingCompletionHash: authority.completionHash,
      publicationHash: snapshotHash(nativeJson(proof)),
      releasedAt: proof.verifiedAt,
    });
    await tx.nativePublicationCompensationContinuation.update({
      where: { id: ancestor.row.id },
      data: {
        fenceRelease: z.record(z.string(), z.json()).parse(release),
        ...(ancestor.row.id === authority.continuationId
          ? { verifiedPublication: z.record(z.string(), z.json()).parse(proof) }
          : {}),
        version: { increment: 1 },
      },
    });
    authority.freshness.assertActive();
  }
  authority.freshness.assertActive();
}
