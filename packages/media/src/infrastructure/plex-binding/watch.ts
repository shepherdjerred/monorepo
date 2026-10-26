import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import {
  BoundWatchAuthoritySchema,
  PlexWatchProjectionV1Schema,
  type BoundWatchAuthority,
  type BoundWatchRead,
} from "#shared/plex-binding/watch.ts";
import {
  PlexAssociationV1Schema,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readCurrentPlexBinding } from "./read.ts";
import { readQuarantinedPlexWatchAuthority } from "./quarantine.ts";
import { parsePlexRecord } from "./records.ts";
import { PlexBindingProtection } from "./errors.ts";
import { CommittedQuarantinePlexReceiptSchema } from "#shared/plex-binding/watch.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { queueOperation } from "#automation/store.ts";

async function readImmutableWatchAssociation(
  tx: Prisma.TransactionClient,
  authority: BoundWatchAuthority,
) {
  const row = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: authority.binding.evidenceId },
  });
  const association = parsePlexRecord(
    PlexAssociationV1Schema,
    row.evidence,
    authority.binding.associationHash,
  );
  if (
    row.associationHash !== authority.binding.associationHash ||
    row.assetId !== association.group.assetId ||
    row.serverMachineId !== association.access.serverMachineId ||
    row.mediaId !== authority.binding.scope.mediaId ||
    row.edition !== authority.binding.scope.edition ||
    identityHash(association.scope) !== identityHash(authority.binding.scope)
  )
    throw new Error("Watch authority immutable association changed");
  if (
    authority.purpose === "quarantined" &&
    identityHash(authority.quarantine) !== authority.quarantineHash
  )
    throw new Error("Watch quarantine reference hash changed");
  return association;
}

/** Caller supplies freshly authorized requester/config scope; this rechecks its exact DB snapshot. */
async function assertBoundAuthority(
  tx: Prisma.TransactionClient,
  authority: BoundWatchAuthority,
) {
  const association = await readImmutableWatchAssociation(tx, authority);
  if (authority.purpose === "current_serving") {
    const current = await readCurrentPlexBinding(tx, {
      scope: authority.binding.scope,
      assetId: association.group.assetId,
      access: association.access,
    });
    if (current.status !== "current")
      throw new PlexBindingProtection(current.reason);
    if (identityHash(current.snapshot) !== identityHash(authority.binding))
      throw new PlexBindingProtection("binding_changed");
  } else {
    const current = await readQuarantinedPlexWatchAuthority(tx, {
      decisionId: authority.quarantine.decisionId,
      scope: authority.binding.scope,
      assetId: association.group.assetId,
      access: association.access,
    });
    if (current.status !== "current")
      throw new PlexBindingProtection(current.reason);
    if (identityHash(current.authority) !== identityHash(authority))
      throw new PlexBindingProtection("binding_changed");
  }
}

/** Protective clearing preserves immutable integrity without requiring still-positive authority. */
async function assertUnknownWatchClear(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    authority: BoundWatchAuthority;
    watchBatchRevision: bigint;
  },
) {
  await readImmutableWatchAssociation(tx, input.authority);
  const row = await tx.plexWatchProjection.findUnique({
    where: {
      userId_mediaId_edition: {
        userId: input.userId,
        ...input.authority.binding.scope,
      },
    },
  });
  if (row === null) return;
  const stored = parsePlexRecord(
    BoundWatchAuthoritySchema,
    row.authority,
    row.authorityHash,
  );
  if (
    row.evidenceId !== stored.binding.evidenceId ||
    row.associationHash !== stored.binding.associationHash ||
    row.bindingRevision !== stored.binding.revision ||
    row.purpose !== stored.purpose ||
    row.mediaId !== stored.binding.scope.mediaId ||
    row.edition !== stored.binding.scope.edition ||
    row.source !== "plex"
  )
    throw new Error("Watch projection relational authority changed");
  if (row.watchBatchRevision >= input.watchBatchRevision)
    throw new PlexBindingProtection("scope_changed");
  await readImmutableWatchAssociation(tx, stored);
}

/** Historical WatchState alone never grants a known value under a different association. */
export async function readCurrentBoundWatch(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    authority: BoundWatchAuthority;
  },
): Promise<BoundWatchRead> {
  const authority = BoundWatchAuthoritySchema.parse(input.authority);
  const key = { userId: input.userId, ...authority.binding.scope };
  const row = await tx.plexWatchProjection.findUnique({
    where: { userId_mediaId_edition: key },
  });
  const watch = await tx.watchState.findUnique({
    where: { userId_mediaId_edition: key },
  });
  if (row === null || watch === null)
    return { status: "unknown", reason: "missing" };
  const stored = parsePlexRecord(
    BoundWatchAuthoritySchema,
    row.authority,
    row.authorityHash,
  );
  if (
    row.evidenceId !== stored.binding.evidenceId ||
    row.associationHash !== stored.binding.associationHash ||
    row.bindingRevision !== stored.binding.revision ||
    row.purpose !== stored.purpose ||
    row.mediaId !== stored.binding.scope.mediaId ||
    row.edition !== stored.binding.scope.edition ||
    row.source !== "plex"
  )
    throw new Error("Watch projection relational authority changed");
  if (identityHash(stored) !== identityHash(authority))
    return { status: "unknown", reason: "authority_changed" };
  if (
    watch.source !== "plex_current" ||
    watch.watched !== row.watched ||
    watch.observedAt.getTime() !== row.observedAt.getTime()
  )
    return { status: "unknown", reason: "value_changed" };
  const now = Date.now();
  if (
    row.observedAt.getTime() > now ||
    now - row.observedAt.getTime() > RETENTION_DEFAULTS.maximumWatchAgeMs
  )
    return { status: "unknown", reason: "stale" };
  const fence = await tx.watchObservationFence.findUnique({
    where: { mediaId_edition: authority.binding.scope },
  });
  if (fence?.settledRevision !== row.watchBatchRevision)
    return { status: "unknown", reason: "authority_changed" };
  try {
    await assertBoundAuthority(tx, authority);
  } catch (error) {
    if (error instanceof PlexBindingProtection)
      return { status: "unknown", reason: "authority_changed" };
    throw error;
  }
  const projection = PlexWatchProjectionV1Schema.parse({
    schemaVersion: 1,
    userId: input.userId,
    scope: authority.binding.scope,
    authority: stored,
    watchBatchRevision: row.watchBatchRevision.toString(),
    observedAt: row.observedAt.toISOString(),
    watched: row.watched,
    source: "plex",
  });
  return { status: "known", projection };
}

/** Called inside the existing issued/settled whole-cohort transaction; never acquires another root. */
export async function commitBoundWatch(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    authority: BoundWatchAuthority;
    watchBatchRevision: bigint;
    observedAt: Date;
    watched: boolean | null;
  },
  freshness: PlexBindingFreshness,
): Promise<void> {
  freshness.assertActive();
  const authority = BoundWatchAuthoritySchema.parse(input.authority);
  const key = { userId: input.userId, ...authority.binding.scope };
  const fence = await tx.watchObservationFence.findUniqueOrThrow({
    where: { mediaId_edition: authority.binding.scope },
  });
  freshness.assertActive();
  if (
    input.watchBatchRevision <= 0n ||
    input.watchBatchRevision > 9_223_372_036_854_775_807n ||
    fence.issuedRevision !== input.watchBatchRevision ||
    fence.settledRevision >= input.watchBatchRevision
  )
    throw new PlexBindingProtection("scope_changed");
  const now = Date.now();
  if (
    !Number.isFinite(input.observedAt.getTime()) ||
    input.observedAt.getTime() > now ||
    now - input.observedAt.getTime() > RETENTION_DEFAULTS.maximumWatchAgeMs
  )
    throw new PlexBindingProtection("verification_expired");
  if (input.watched === null)
    await assertUnknownWatchClear(tx, { ...input, authority });
  else await assertBoundAuthority(tx, authority);
  freshness.assertActive();
  if (input.watched === null) {
    await tx.plexWatchProjection.deleteMany({ where: key });
    freshness.assertActive();
    await tx.watchState.deleteMany({ where: key });
  } else {
    const values = {
      watched: input.watched,
      observedAt: input.observedAt,
      source: "plex_current",
    };
    await tx.watchState.upsert({
      where: { userId_mediaId_edition: key },
      create: { ...key, ...values },
      update: values,
    });
    freshness.assertActive();
    const projection = {
      evidenceId: authority.binding.evidenceId,
      associationHash: authority.binding.associationHash,
      bindingRevision: authority.binding.revision,
      purpose: authority.purpose,
      watchBatchRevision: input.watchBatchRevision,
      observedAt: input.observedAt,
      watched: input.watched,
      source: "plex",
      authority: z.record(z.string(), z.json()).parse(authority),
      authorityHash: identityHash(authority),
    };
    await tx.plexWatchProjection.upsert({
      where: { userId_mediaId_edition: key },
      create: { ...key, ...projection },
      update: projection,
    });
  }
  freshness.assertActive();
}

/** Caller holds the complete receipt asset/media cohort before identities, assets and watch fences. */
export async function queueQuarantinedUnwatchedRestore(
  tx: Prisma.TransactionClient,
  input: {
    authority: Extract<BoundWatchAuthority, { purpose: "quarantined" }>;
    userId: string;
    watchBatchRevision: bigint;
  },
  freshness: PlexBindingFreshness,
): Promise<{ operationId: string; created: boolean }> {
  freshness.assertActive();
  const authority = BoundWatchAuthoritySchema.parse(input.authority);
  if (authority.purpose !== "quarantined")
    throw new Error("Quarantine restore requires quarantined watch authority");
  await assertBoundAuthority(tx, authority);
  freshness.assertActive();
  const key = { userId: input.userId, ...authority.binding.scope };
  const observed = await tx.plexWatchProjection.findUniqueOrThrow({
    where: { userId_mediaId_edition: key },
  });
  const watch = await tx.watchState.findUniqueOrThrow({
    where: { userId_mediaId_edition: key },
  });
  const fence = await tx.watchObservationFence.findUniqueOrThrow({
    where: { mediaId_edition: authority.binding.scope },
  });
  freshness.assertActive();
  assertUnwatchedRestoreEvidence(
    { observed, watch, fence },
    authority,
    input.watchBatchRevision,
  );
  const parent = await tx.operation.findUniqueOrThrow({
    where: { id: authority.quarantine.operationId },
  });
  const raw = z
    .object({ quarantinePlexReceipt: z.json() })
    .parse(parent.result).quarantinePlexReceipt;
  const receipt = parsePlexRecord(
    CommittedQuarantinePlexReceiptSchema,
    raw,
    authority.quarantine.operationResultHash,
  );
  const mediaIds = receipt.groups
    .flatMap((group) => group.coverage.map((scope) => scope.mediaId))
    .sort();
  const restoreKey = `plex-unwatched-restore:${identityHash({
    operationId: parent.id,
    receiptHash: authority.quarantine.operationResultHash,
    recoveryEpoch: authority.quarantine.recoveryEpoch,
    nativeReceipts: authority.quarantine.nativeReceipts,
  })}`;
  const existing = await tx.operation.findUnique({
    where: { idempotencyKey: restoreKey },
  });
  freshness.assertActive();
  if (existing !== null) {
    if (
      !["restore_media", "restore_native_quarantine"].includes(existing.kind) ||
      !mediaIds.includes(existing.targetId ?? "")
    )
      throw new Error("Bound quarantine restore command changed");
    return { operationId: existing.id, created: false };
  }
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: mediaIds }, edition: "default" },
  });
  const claims = await tx.mediaRequest.findMany({
    where: { mediaId: { in: mediaIds }, ...effectiveRequestWhere },
    select: { mediaId: true },
  });
  const holds = await tx.recoveryHold.count({
    where: { mediaId: { in: mediaIds }, edition: "default", releasedAt: null },
  });
  freshness.assertActive();
  if (
    holds !== 0 ||
    intents.length !== mediaIds.length ||
    intents.some(
      (intent) =>
        intent.automationEpoch !== authority.quarantine.recoveryEpoch ||
        !intent.desiredPresence ||
        !intent.monitoring ||
        intent.intentionallyRemovedAt !== null,
    ) ||
    mediaIds.some(
      (mediaId) => !claims.some((claim) => claim.mediaId === mediaId),
    )
  )
    throw new PlexBindingProtection("ownership_changed");
  await tx.mediaItem.updateMany({
    where: { id: { in: mediaIds } },
    data: { version: { increment: 1 } },
  });
  freshness.assertActive();
  await tx.mediaIntent.updateMany({
    where: { mediaId: { in: mediaIds }, edition: "default" },
    data: { generation: { increment: 1 }, version: { increment: 1 } },
  });
  freshness.assertActive();
  const target = intents.find(
    (intent) => intent.mediaId === authority.binding.scope.mediaId,
  );
  if (target === undefined)
    throw new Error("Bound quarantine restore omitted selected target");
  const generation = target.generation + 1;
  await tx.applicationEvent.create({
    data: {
      mediaId: target.mediaId,
      actorId: input.userId,
      kind: "media_marked_unwatched",
      payload: { generation },
    },
  });
  freshness.assertActive();
  const operationId = await queueOperation(tx, {
    key: restoreKey,
    kind: "restore_media",
    targetId: target.mediaId,
    payload: { mediaId: target.mediaId, generation },
  });
  freshness.assertActive();
  return { operationId, created: true };
}

function assertUnwatchedRestoreEvidence(
  evidence: {
    observed: {
      watchBatchRevision: bigint;
      authorityHash: string;
      authority: unknown;
      watched: boolean;
      observedAt: Date;
      source: string;
    };
    watch: { watched: boolean; observedAt: Date; source: string };
    fence: { issuedRevision: bigint; settledRevision: bigint };
  },
  authority: BoundWatchAuthority,
  revision: bigint,
) {
  const { observed, watch, fence } = evidence;
  if (
    observed.watchBatchRevision !== revision ||
    observed.authorityHash !== identityHash(authority) ||
    identityHash(observed.authority) !== observed.authorityHash ||
    observed.watched ||
    watch.watched ||
    observed.observedAt.getTime() !== watch.observedAt.getTime() ||
    watch.source !== "plex_current" ||
    observed.source !== "plex" ||
    fence.issuedRevision !== revision ||
    fence.settledRevision > revision
  )
    throw new PlexBindingProtection("scope_changed");
}
