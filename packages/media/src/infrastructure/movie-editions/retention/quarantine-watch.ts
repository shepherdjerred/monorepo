import { z } from "zod";
import { Prisma, type Operation } from "#generated/prisma/client.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import {
  QuarantinePlexRefV2Schema,
  RetentionPlexProjectionV1Schema,
  type QuarantinePlexRefV2,
  type BoundWatchAuthority,
} from "#shared/plex-binding/watch.ts";
import {
  PlexMovieAssociationV2Schema,
  type PlexAccess,
  type PlexBindingScope,
  type PlexBindingFreshness,
  type PlexAssociation,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  readPlexDefinition,
  readPlexPhysicalGroup,
} from "#infrastructure/plex-binding/read.ts";
import {
  parsePlexRecord,
  readPlexPointer,
} from "#infrastructure/plex-binding/records.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueOperation } from "#automation/store.ts";

type Decision = Prisma.RetentionDecisionGetPayload<{
  include: { plexProjection: true };
}>;
type Input = {
  decision: Decision;
  operation: Operation;
  scope: PlexBindingScope;
  assetId: string;
  access: PlexAccess;
};

/** A scoped v2 receipt has one exact group and no native union to rediscover. */
export function assertCapturedMovieQuarantinedPlexWatchScope(
  expected: {
    authority: BoundWatchAuthority;
    mediaIds: readonly string[];
    assetIds: readonly string[];
    continuationIds: readonly string[];
    cohortHash: string;
  },
  current: {
    authority: Extract<BoundWatchAuthority, { purpose: "quarantined" }>;
    association: PlexAssociation;
  },
) {
  const ref = current.authority.quarantine;
  if (
    !("schemaVersion" in ref) ||
    identityHash({
      authority: expected.authority,
      mediaIds: expected.mediaIds,
      assetIds: expected.assetIds,
      continuationIds: expected.continuationIds,
    }) !== expected.cohortHash ||
    identityHash({
      authority: current.authority,
      mediaIds: [ref.scope.mediaId],
      assetIds: [current.association.group.assetId],
      continuationIds: [],
    }) !== expected.cohortHash
  )
    throw new PlexBindingProtection("scope_changed");
}

/** The dispatcher has charged these parents; only this exact scoped receipt can authorize its history. */
export async function readMovieQuarantinedPlexWatchAuthority(
  tx: Prisma.TransactionClient,
  input: Input,
  budget?: PublicationAuthorityReadBudget,
) {
  const { decision, operation } = input;
  const raw = z
    .object({ movieQuarantinePlexReceiptV2: z.json() })
    .parse(operation.result).movieQuarantinePlexReceiptV2;
  const receiptHash = identityHash(raw);
  const receipt = parsePlexRecord(
    MovieQuarantinePlexReceiptV2Schema,
    raw,
    receiptHash,
  );
  const manifest = parsePlexRecord(
    RemovalPlanSchema,
    decision.manifest,
    receipt.manifestHash,
  );
  assertMovieQuarantineParents(input, receipt);
  const original = receipt.groups[0];
  const binding = receipt.bindings[0];
  const entry = manifest.assets[0];
  if (
    manifest.assets.length !== 1 ||
    entry?.assetId !== original.assetId ||
    entry.assetVersion !== original.assetVersion ||
    entry.checksum !== original.checksum ||
    identityHash(entry.mediaIds) !== identityHash([receipt.scope.mediaId]) ||
    identityHash(entry.generations) !==
      identityHash({ [receipt.scope.mediaId]: decision.generation })
  )
    throw new Error("Movie quarantine manifest changed its original group");
  const association = await readMovieQuarantineAssociation(tx, receipt, budget);
  const { asset, group } = await readPlexPhysicalGroup(tx, input.assetId);
  budget?.consume(1 + asset.coverage.length);
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  const runtime = await runtimeAuthority(tx);
  if (
    !runtime.active ||
    runtime.epoch !== receipt.recoveryEpoch ||
    asset.state !== "quarantined" ||
    target.editionRootId !== receipt.scope.rootMediaId ||
    target.automationEpoch !== runtime.epoch ||
    target.availability !== "quarantined" ||
    identityHash(group) !==
      identityHash({ ...original, assetVersion: original.assetVersion + 1 })
  )
    throw new PlexBindingProtection("ownership_changed");
  await assertMovieQuarantineRetired(tx, receipt, budget);
  await assertMovieQuarantineIdentity(tx, association, input.access);
  const quarantine = QuarantinePlexRefV2Schema.parse({
    schemaVersion: 2,
    scope: receipt.scope,
    decisionId: decision.id,
    decisionVersion: decision.version,
    manifestHash: receipt.manifestHash,
    operationId: operation.id,
    operationResultHash: receiptHash,
    recoveryEpoch: runtime.epoch,
    group,
    assets: [
      {
        assetId: original.assetId,
        planAssetVersion: original.assetVersion,
        quarantinedAssetVersion: original.assetVersion + 1,
        checksum: original.checksum,
        coverageHash: original.coverageHash,
      },
    ],
    nativeReceipts: [],
  });
  return {
    status: "current" as const,
    authority: {
      purpose: "quarantined" as const,
      binding,
      quarantine,
      quarantineHash: identityHash(quarantine),
    },
    association,
  };
}

type Receipt = z.infer<typeof MovieQuarantinePlexReceiptV2Schema>;

function assertMovieQuarantineParents(input: Input, receipt: Receipt) {
  const { decision, operation } = input;
  const command = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.literal("retain_movie_edition_v4"),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.id !== command.operationId ||
    operation.id !== receipt.operationId ||
    operation.targetId !== receipt.scope.mediaId ||
    command.mediaId !== receipt.scope.mediaId ||
    identityHash(command.scope) !== identityHash(receipt.scope) ||
    command.recoveryEpoch !== receipt.recoveryEpoch ||
    decision.id !== receipt.decisionId ||
    decision.mediaId !== receipt.scope.mediaId ||
    decision.edition !== receipt.scope.edition ||
    decision.generation !== command.generation ||
    receipt.scope.mediaId !== input.scope.mediaId ||
    receipt.scope.edition !== input.scope.edition ||
    receipt.groups[0].assetId !== input.assetId
  )
    throw new Error(
      "Movie quarantine receipt changed its exact command or scope",
    );
  assertMovieQuarantineProjection(decision, receipt);
}

function assertMovieQuarantineProjection(decision: Decision, receipt: Receipt) {
  const selected = receipt.decisions[0];
  const record = decision.plexProjection;
  if (
    record === null ||
    decision.state !== "quarantined" ||
    decision.version < selected.quarantinedVersion ||
    decision.quarantinedAt?.toISOString() !== receipt.committedAt ||
    decision.purgeAfter?.getTime() !==
      Date.parse(receipt.committedAt) + 7 * 86_400_000
  )
    throw new PlexBindingProtection("reconciliation_required");
  const projection = parsePlexRecord(
    RetentionPlexProjectionV1Schema,
    record.projection,
    record.projectionHash,
  );
  if (
    record.projectionHash !== selected.projectionHash ||
    projection.decisionId !== decision.id ||
    identityHash(projection.bindings) !== identityHash(receipt.bindings) ||
    identityHash(projection.groupHashes) !==
      identityHash([identityHash(receipt.groups[0])])
  )
    throw new Error("Movie quarantine immutable retention projection changed");
}

async function readMovieQuarantineAssociation(
  tx: Prisma.TransactionClient,
  receipt: Receipt,
  budget?: PublicationAuthorityReadBudget,
) {
  const binding = receipt.bindings[0];
  const row = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: binding.evidenceId },
  });
  budget?.consume(1);
  const association = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    row.evidence,
    binding.associationHash,
  );
  if (
    row.associationHash !== binding.associationHash ||
    row.mediaId !== receipt.scope.mediaId ||
    row.edition !== receipt.scope.edition ||
    row.assetId !== receipt.groups[0].assetId ||
    row.serverMachineId !== association.access.serverMachineId ||
    identityHash(association.scope) !== identityHash(binding.scope) ||
    identityHash(association.group) !== identityHash(receipt.groups[0])
  )
    throw new Error("Movie quarantine original association changed");
  return association;
}

async function assertMovieQuarantineRetired(
  tx: Prisma.TransactionClient,
  receipt: Receipt,
  budget?: PublicationAuthorityReadBudget,
) {
  const pointer = await readPlexPointer(tx, receipt.bindings[0].scope, budget);
  if (
    pointer.current !== null ||
    pointer.expected.revision !== receipt.bindings[0].revision + 1
  )
    throw new PlexBindingProtection("binding_changed");
  if (
    await tx.nativePublicationCompensationContinuation.count({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        OR: [
          { assetIds: { has: receipt.groups[0].assetId } },
          { mediaIds: { has: receipt.scope.mediaId } },
        ],
      },
    })
  )
    throw new PlexBindingProtection("compensation_fence_active");
}

async function assertMovieQuarantineIdentity(
  tx: Prisma.TransactionClient,
  association: z.infer<typeof PlexMovieAssociationV2Schema>,
  access: PlexAccess,
) {
  if (association.access.serverMachineId !== access.serverMachineId)
    throw new PlexBindingProtection("wrong_server");
  if (identityHash(association.access) !== identityHash(access))
    throw new PlexBindingProtection("wrong_section");
  const targets = await readPlexCanonicalTargets(tx, [association.scope]);
  const canonical = targets[0];
  if (
    canonical?.canonicalRootId !== association.editionRootId ||
    canonical.canonicalIdentityHash !== association.canonicalIdentityHash ||
    canonical.numberingHash !== association.numberingHash
  )
    throw new PlexBindingProtection("metadata_changed");
  const definition = await readPlexDefinition(
    tx,
    association.scope,
    association.editionRootId,
  );
  if (identityHash(definition) !== identityHash(association.definition))
    throw new PlexBindingProtection("binding_changed");
}

/** The caller validated the same settled unwatched projection and owns its exact cohort locks. */
export async function queueMovieQuarantinedWatchRestore(
  tx: Prisma.TransactionClient,
  input: { quarantine: QuarantinePlexRefV2; userId: string },
  freshness: PlexBindingFreshness,
  budget?: PublicationAuthorityReadBudget,
) {
  const { quarantine, userId } = input;
  const scope = quarantine.scope;
  const parent = await tx.operation.findUniqueOrThrow({
    where: { id: quarantine.operationId },
  });
  budget?.consume(1);
  const raw = z
    .object({ movieQuarantinePlexReceiptV2: z.json() })
    .parse(parent.result).movieQuarantinePlexReceiptV2;
  const receipt = parsePlexRecord(
    MovieQuarantinePlexReceiptV2Schema,
    raw,
    quarantine.operationResultHash,
  );
  if (
    parent.kind !== "retain_movie_edition_v4" ||
    receipt.operationId !== parent.id ||
    receipt.decisionId !== quarantine.decisionId ||
    identityHash(receipt.scope) !== identityHash(scope)
  )
    throw new Error("Movie watch restore lost its exact quarantine parent");
  const key = `movie-plex-unwatched-restore:${identityHash({
    operationId: parent.id,
    receiptHash: quarantine.operationResultHash,
    scope,
    recoveryEpoch: quarantine.recoveryEpoch,
  })}`;
  const existing = await tx.operation.findUnique({
    where: { idempotencyKey: key },
  });
  freshness.assertActive();
  if (existing !== null) {
    if (
      existing.kind !== "restore_movie_edition_v4" ||
      existing.targetId !== scope.mediaId
    )
      throw new Error("Bound movie quarantine restore command changed");
    return { operationId: existing.id, created: false };
  }
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const claims = await tx.mediaRequest.count({
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
  });
  const holds = await tx.recoveryHold.count({
    where: { mediaId: scope.mediaId, edition: scope.edition, releasedAt: null },
  });
  freshness.assertActive();
  if (
    holds !== 0 ||
    claims === 0 ||
    target.editionRootId !== scope.rootMediaId ||
    target.automationEpoch !== quarantine.recoveryEpoch ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null
  )
    throw new PlexBindingProtection("ownership_changed");
  await tx.mediaItem.update({
    where: { id: scope.mediaId },
    data: { version: { increment: 1 } },
  });
  freshness.assertActive();
  const next = await tx.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
    data: { generation: { increment: 1 }, version: { increment: 1 } },
  });
  freshness.assertActive();
  await tx.applicationEvent.create({
    data: {
      mediaId: scope.mediaId,
      actorId: userId,
      kind: "media_marked_unwatched",
      payload: { generation: next.generation, schemaVersion: 4, scope },
    },
  });
  freshness.assertActive();
  const operationId = await queueOperation(tx, {
    key,
    kind: "restore_movie_edition_v4",
    targetId: scope.mediaId,
    payload: {
      schemaVersion: 4,
      scope,
      mediaId: scope.mediaId,
      generation: next.generation,
    },
  });
  freshness.assertActive();
  return { operationId, created: true };
}
