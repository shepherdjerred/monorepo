import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexBindingExpected,
  PlexPublicationParent,
} from "#shared/plex-binding/expected.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { FilePlanEntrySchema, GenerationsSchema } from "#shared/file-plan.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import { assertMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { assertArchiveAuthority } from "#infrastructure/native-archive/authority.ts";
import { publicationArchiveSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertCompensationFenceOwner } from "#infrastructure/native-compensation/fence.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import {
  assertCompensationPublicationPhase,
  assertCompensationPublicationPhaseCurrent,
  type CompensationPublicationPhase,
} from "#infrastructure/native-compensation/publication/phase.ts";
import { NativeCompensationPublicationCommandSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { PlexBindingProtection } from "./errors.ts";
import { ordinaryPlexLineageReader } from "./lineage.ts";
import { assertPlexRestorationParent } from "./restoration.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { assertPlexRollbackParent } from "./rollback.ts";
type LineageReader = () => ReturnType<typeof ordinaryPlexLineageReader>;
type ParentContext = {
  expected: PlexBindingExpected;
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
  lineage: LineageReader;
  compensationPhase?: CompensationPublicationPhase | undefined;
};

function parentAssets(
  tx: Prisma.TransactionClient,
  parent: PlexPublicationParent,
  context: ParentContext,
) {
  switch (parent.kind) {
    case "existing_asset":
      return existingParent(tx, parent, context);
    case "acquisition":
      return acquisitionParent(tx, parent, context);
    case "restore":
      return restoreParent(tx, parent, context);
    case "rollback":
      return rollbackParent(tx, parent, context);
    case "compensation":
      return compensationParent(tx, parent, context);
  }
}

/** Read-only parent assertion under the complete already-acquired publication scope. */
export async function assertPlexPublicationParents(
  tx: Prisma.TransactionClient,
  expected: PlexBindingExpected,
  freshness: PlexBindingFreshness,
  options: {
    budget?: PublicationAuthorityReadBudget;
    compensationPhase?: CompensationPublicationPhase | undefined;
  } = {},
) {
  const { budget = new PublicationAuthorityReadBudget(), compensationPhase } =
    options;
  const covered = new Set<string>();
  let cachedLineage: ReturnType<typeof ordinaryPlexLineageReader> | undefined;
  const lineage: LineageReader = () =>
    (cachedLineage ??= ordinaryPlexLineageReader(
      tx,
      expected.newGroups,
      budget,
    ));
  for (const parent of expected.parents) {
    if (parent.recoveryEpoch !== expected.recoveryEpoch)
      throw new PlexBindingProtection("ownership_changed");
    const ids = await parentAssets(tx, parent, {
      expected,
      freshness,
      budget,
      lineage,
      compensationPhase,
    });
    freshness.assertActive();
    for (const id of ids) {
      if (covered.has(id))
        throw new Error("Plex publication has overlapping parent authority");
      covered.add(id);
    }
  }
  if (
    identityHash([...covered].sort()) !==
    identityHash(expected.newGroups.map((group) => group.assetId))
  )
    throw new Error("Plex publication omitted exact physical parent coverage");
  if (
    !(await recordsAuthorized(tx, {
      epoch: expected.recoveryEpoch,
      mediaIds: expected.newGroups.flatMap((group) =>
        group.coverage.map((scope) => scope.mediaId),
      ),
      assetIds: [...covered],
    }))
  )
    throw new PlexBindingProtection("ownership_changed");
  if (
    !expected.parents.some((parent) => parent.kind === "compensation") &&
    (await tx.nativePublicationCompensationContinuation.count({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        OR: [
          { assetIds: { hasSome: [...covered] } },
          {
            mediaIds: {
              hasSome: expected.targets.map((target) => target.scope.mediaId),
            },
          },
        ],
      },
    }))
  )
    throw new PlexBindingProtection("compensation_fence_active");
  freshness.assertActive();
}

async function rollbackParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "rollback" }>,
  context: ParentContext,
) {
  const { expected, budget, lineage } = context;
  const result = await assertPlexRollbackParent(
    tx,
    { parent, groups: expected.newGroups },
    budget,
  );
  for (const group of result.ordinary) {
    const reader = await lineage();
    await reader.assert(group);
  }
  return result.groups.map((group) => group.assetId);
}

async function existingParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "existing_asset" }>,
  context: ParentContext,
) {
  const { expected, budget, lineage } = context;
  const group = expected.newGroups.find(
    (value) => value.assetId === parent.assetId,
  );
  if (
    group?.assetVersion !== parent.assetVersion ||
    group.ownershipEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("ownership_changed");
  if (parent.physicalGrant === null) {
    const reader = await lineage();
    await reader.assert(group);
  } else {
    if (parent.physicalGrant.assetId !== parent.assetId)
      throw new Error("Plex physical receipt asset changed");
    const file = publicationArchiveSnapshot(
      await snapshotPublicationAsset(tx, parent.assetId),
      expected.targets.find(
        (target) => target.scope.mediaId === group.coverage[0]?.mediaId,
      )?.editionRootId === group.coverage[0]?.mediaId
        ? "movies"
        : "tv",
    );
    await assertArchiveAuthority(tx, file, parent.physicalGrant, { budget });
  }
  return [parent.assetId];
}

function completeRequestCoverage(
  rawIdentity: unknown,
  mediaIds: string[],
  claimed: Set<string>,
) {
  return (
    managedSeriesIdentity(rawIdentity) !== null ||
    mediaIds.every((id) => claimed.has(id))
  );
}

async function acquisitionParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "acquisition" }>,
  context: ParentContext,
) {
  const { expected, freshness, lineage } = context;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: parent.attemptId },
    include: { reservations: true },
  });
  if (
    attempt.operationId !== parent.operationId ||
    attempt.recoveryEpoch !== parent.recoveryEpoch ||
    attempt.edition !== "default" ||
    !["imported", "completed"].includes(attempt.state) ||
    identityHash(attempt.filePlan) !== parent.planHash ||
    (attempt.identityEvidence === null
      ? null
      : identityHash(attempt.identityEvidence)) !== parent.identityHash ||
    identityHash(GenerationsSchema.parse(attempt.generations)) !==
      identityHash(parent.generations)
  )
    throw new PlexBindingProtection("ownership_changed");
  const plan = z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(100)
    .parse(attempt.filePlan);
  const groups = expected.newGroups.filter((group) =>
    plan.some((entry) => entry.assetId === group.assetId),
  );
  if (
    groups.length !== plan.length ||
    attempt.reservations.length !== attempt.mediaIds.length ||
    attempt.reservations.some(
      (row) =>
        row.edition !== "default" ||
        row.generation !== parent.generations[row.mediaId],
    )
  )
    throw new PlexBindingProtection("scope_changed");
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: attempt.mediaIds } },
  });
  const claims = await tx.mediaRequest.findMany({
    where: { ...effectiveRequestWhere, mediaId: { in: attempt.mediaIds } },
    select: { mediaId: true },
  });
  const claimed = new Set(claims.map((row) => row.mediaId));
  if (
    intents.length !== attempt.mediaIds.length ||
    intents.some(
      (row) =>
        !row.desiredPresence ||
        row.automationEpoch !== parent.recoveryEpoch ||
        row.generation !== parent.generations[row.mediaId],
    ) ||
    !completeRequestCoverage(
      attempt.identityEvidence,
      attempt.mediaIds,
      claimed,
    )
  )
    throw new PlexBindingProtection("scope_changed");
  const access = expected.access[0];
  if (access === undefined)
    throw new Error("Plex acquisition lacks configured access");
  const movie = expected.access.find((value) => value.sectionType === "movie");
  const movieAccess =
    movie === undefined
      ? undefined
      : {
          serverMachineId: movie.serverMachineId,
          movieSectionId: movie.sectionId,
        };
  await assertAttemptIdentity(tx, attempt, {
    serverMachineId: access.serverMachineId,
    movieAccess,
    libraryManagement: { access, freshness, budget: context.budget },
  });
  if (movieAccess !== undefined) {
    const choice = await assertMovieAttemptChoice(tx, {
      attemptId: attempt.id,
      purpose: "new_acquisition_effect",
      access: movieAccess,
    });
    if (choice !== null)
      await bindPlexTransactionDeadline(tx, {
        expiresAtMs: Math.min(choice.expiresAtMs, freshness.expiresAtMs),
        assertActive() {
          freshness.assertActive();
          choice.assertActive();
        },
      });
  }
  for (const group of groups) {
    const reader = await lineage();
    await reader.assert(group, "current_acquisition");
  }
  return groups.map((group) => group.assetId);
}

async function restoreParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "restore" }>,
  context: ParentContext,
) {
  const { expected, budget, lineage } = context;
  const { operation, receipt } = await assertPlexRestorationParent(
    tx,
    parent,
    budget,
  );
  if (
    !["restore_media", "restore_native_quarantine"].includes(operation.kind) ||
    receipt.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("ownership_changed");
  if (receipt.decisionId !== parent.decisionId)
    throw new Error("Plex restore decision parent changed");
  const groups = expected.newGroups.filter((group) =>
    receipt.assets.some(
      (asset) =>
        asset.assetId === group.assetId &&
        asset.assetVersion === group.assetVersion &&
        asset.checksum === group.checksum,
    ),
  );
  if (groups.length === 0) throw new PlexBindingProtection("ownership_changed");
  for (const group of groups) {
    if (
      group.coverage.some((scope) => !receipt.mediaIds.includes(scope.mediaId))
    )
      throw new PlexBindingProtection("ownership_changed");
    if (operation.kind === "restore_media") {
      const reader = await lineage();
      await reader.assert(group);
    }
  }
  return groups.map((group) => group.assetId);
}

async function compensationParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "compensation" }>,
  context: ParentContext,
) {
  const { expected, budget, compensationPhase } = context;
  const phase =
    compensationPhase === undefined
      ? undefined
      : assertCompensationPublicationPhase(tx, compensationPhase, budget);
  if (
    phase !== undefined &&
    identityHash(phase.parent) !== identityHash(parent)
  )
    throw new PlexBindingProtection("ownership_changed");
  const record =
    phase?.record ??
    (await compensationRecord(tx, parent.continuationId, budget));
  const { row } = record;
  const completion = compensationParentCompletion(record, parent);
  const operation =
    phase?.operation ??
    (await tx.operation.findUniqueOrThrow({
      where: { id: parent.operationId },
    }));
  if (phase === undefined) budget.consume(1);
  const command = assertCompensationParentCommand(operation, parent, {
    row,
    completion,
  });
  const targets = new Map(
    expected.targets.map((target) => [target.scope.mediaId, target]),
  );
  if (
    row.mediaIds.some(
      (id) => targets.get(id)?.generation !== command.generations[id],
    )
  )
    throw new PlexBindingProtection("scope_changed");
  if (phase === undefined)
    await assertCompensationFenceOwner(
      tx,
      {
        purpose: "publish",
        activity: {
          schemaVersion: 1,
          continuationId: row.id,
          operationId: parent.operationId,
          recoveryEpoch: parent.recoveryEpoch,
        },
      },
      budget,
    );
  else await assertCompensationPublicationPhaseCurrent(tx, phase, budget);
  for (const binding of completion.predecessorBindings) {
    const group = expected.newGroups.find(
      (value) => value.assetId === binding.after.id,
    );
    if (
      group?.assetVersion !== binding.after.version ||
      group.checksum !== binding.after.checksum ||
      group.canonicalPath !== binding.after.path ||
      identityHash(group.coverage) !==
        identityHash(
          binding.after.coverage
            .filter((value) => value.current)
            .map(({ mediaId, edition }) => ({ mediaId, edition })),
        )
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  return completion.predecessorBindings.map((binding) => binding.after.id);
}

function assertCompensationParentCommand(
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  parent: Extract<PlexPublicationParent, { kind: "compensation" }>,
  context: {
    row: Awaited<ReturnType<typeof compensationRecord>>["row"];
    completion: ReturnType<typeof compensationParentCompletion>;
  },
) {
  const { row, completion } = context;
  const command = NativeCompensationPublicationCommandSchema.extend({
    kind: z.literal("publish_compensated_media"),
    operationId: z.uuid(),
  }).parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    command.operationId !== parent.operationId ||
    command.continuationId !== row.id ||
    command.recoveryEpoch !== parent.recoveryEpoch ||
    command.completionHash !== parent.completionHash ||
    command.bindingsHash !== identityHash(completion.predecessorBindings)
  )
    throw new Error("Plex compensated publication command changed");
  return command;
}

function compensationParentCompletion(
  record: Awaited<ReturnType<typeof compensationRecord>>,
  parent: Extract<PlexPublicationParent, { kind: "compensation" }>,
) {
  const { row, completion } = record;
  if (
    completion === null ||
    row.receiptId !== parent.receiptId ||
    row.receipt.planHash !== parent.planHash ||
    row.descriptorHash !== parent.descriptorHash ||
    identityHash(completion) !== parent.completionHash ||
    row.publicationCoordinatorOperationId !== parent.operationId ||
    row.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("ownership_changed");
  return completion;
}
