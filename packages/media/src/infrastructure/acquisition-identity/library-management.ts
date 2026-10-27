import type {
  MediaIntent,
  MediaItem,
  Prisma,
} from "#generated/prisma/client.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "#infrastructure/handoff/library-receipt.ts";
import {
  LibrarySeriesManagementSchema,
  type LibrarySeriesManagement,
} from "#shared/acquisition/library-management.ts";
import { identityHash } from "./snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import {
  protectLibraryManagement,
  type LibraryManagementInvocation,
} from "./library-policy.ts";
import { librarySourceAssociation } from "./library-association.ts";
import { readLibrarySeriesPolicy } from "./series-policy.ts";
type Input = {
  mediaIds: readonly string[];
  epoch: number;
  access: PlexAccess;
  expected?: LibrarySeriesManagement;
};
const hash = (value: unknown) => identityHash(nativeJson(value));

/** Caller holds canonical/target/runtime locks for mutation. Historical source rows consume the caller's one allowance. */
export async function readLibrarySeriesManagement(
  tx: Prisma.TransactionClient,
  input: Input,
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  if (hash(input.access) !== hash(invocation.access))
    protectLibraryManagement();
  const leaves = await tx.mediaItem.findMany({
    where: { id: { in: [...input.mediaIds] } },
    include: { parent: true },
    orderBy: { id: "asc" },
  });
  const seriesId = managementSeries(leaves, input.mediaIds);
  if (input.expected?.schemaVersion === 2)
    return readSeriesManagedCoverage(
      tx,
      { input, seriesId, leaves },
      invocation,
    );
  const origins =
    input.expected === undefined
      ? await tx.mediaHandoffReceipt.findMany({
          where: {
            recoveryEpoch: input.epoch,
            selection: {
              path: ["scope", "targets"],
              array_contains: input.mediaIds.map((mediaId) => ({
                mediaId,
                edition: "default",
              })),
            },
          },
          orderBy: { runtimeVersion: "desc" },
          take: 2,
          select: { id: true, runtimeVersion: true },
        })
      : [{ id: input.expected.receiptId, runtimeVersion: -1 }];
  if (input.expected === undefined) invocation.budget.consume(origins.length);
  const origin = origins[0];
  if (origin === undefined)
    return readSeriesManagedCoverage(
      tx,
      { input, seriesId, leaves },
      invocation,
    );
  if (origins[1]?.runtimeVersion === origin.runtimeVersion)
    protectLibraryManagement();
  const approval = await readLibraryHandoffReceipt(
    tx,
    origin.id,
    invocation.budget,
  );
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: { id: seriesId },
  });
  const targets = await tx.mediaIntent.findMany({
    where: {
      edition: "default",
      mediaId: { in: [seriesId, ...input.mediaIds] },
    },
    orderBy: { mediaId: "asc" },
  });
  const policy = managementPolicy(approval, root, targets, input);
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${approval.receipt.actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: approval.receipt.actorId },
  });
  invocation.budget.consume(1);
  if (actor.role !== "owner" || actor.restricted) protectLibraryManagement();
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: policy.profileId },
  });
  const association = await librarySourceAssociation(
    tx,
    {
      approval,
      root,
      ...(input.expected === undefined ? {} : { expected: input.expected }),
    },
    invocation,
  );
  const proof = LibrarySeriesManagementSchema.parse({
    schemaVersion: 1,
    kind: "library_series_management",
    seriesId,
    receiptId: approval.receipt.id,
    planId: approval.receipt.planId,
    planHash: approval.receipt.planHash,
    selectionHash: hash(policy.selected),
    actorId: actor.id,
    serverMachineId: input.access.serverMachineId,
    sectionId: input.access.sectionId,
    association,
    profileId: profile.id,
    profileVersionAtCapture: profile.version,
    rootGenerationAtCapture:
      policy.root === undefined ? null : policy.root.generation,
    birthEpoch: input.epoch,
    targets: targets
      .filter((target) => target.mediaId !== seriesId)
      .map((target) => ({
        mediaId: target.mediaId,
        generation: target.generation,
      })),
  });
  if (input.expected !== undefined && hash(proof) !== hash(input.expected))
    protectLibraryManagement();
  invocation.freshness.assertActive();
  return { proof, freshness: invocation.freshness };
}

async function readSeriesManagedCoverage(
  tx: Prisma.TransactionClient,
  state: {
    input: Input;
    seriesId: string;
    leaves: { seasonNumber: number | null }[];
  },
  invocation: LibraryManagementInvocation,
) {
  const { input, seriesId, leaves } = state;
  if (input.expected?.schemaVersion === 1)
    throw new Error("Episode approval cannot change its policy family");
  const policy = await readLibrarySeriesPolicy(
    tx,
    {
      seriesId,
      epoch: input.epoch,
      ...(input.expected === undefined ? {} : { expected: input.expected }),
    },
    invocation,
  );
  if (policy === null) {
    if (input.expected !== undefined) protectLibraryManagement();
    return null;
  }
  if (!policy.includeSpecials && leaves.some((leaf) => leaf.seasonNumber === 0))
    protectLibraryManagement();
  const targets = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: [...input.mediaIds] } },
    orderBy: { mediaId: "asc" },
  });
  if (
    targets.length !== input.mediaIds.length ||
    targets.some(
      (target) =>
        target.editionRootId !== seriesId ||
        target.automationEpoch !== input.epoch ||
        !target.desiredPresence ||
        !target.monitoring ||
        !target.libraryMonitoring ||
        target.intentionallyRemovedAt !== null ||
        target.profileId !== policy.profileId,
    )
  )
    protectLibraryManagement();
  const proof = LibrarySeriesManagementSchema.parse({
    ...policy,
    targets: targets.map((target) => ({
      mediaId: target.mediaId,
      generation: target.generation,
    })),
  });
  if (input.expected !== undefined && hash(proof) !== hash(input.expected))
    protectLibraryManagement();
  invocation.freshness.assertActive();
  return { proof, freshness: invocation.freshness };
}

function managementSeries(
  leaves: (MediaItem & { parent: MediaItem | null })[],
  ids: readonly string[],
) {
  if (
    ids.length === 0 ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    leaves.length !== ids.length
  )
    throw new Error(
      "Library management needs complete distinct bounded episode coverage",
    );
  const roots = new Set(
    leaves.map((leaf) =>
      leaf.parent?.kind === "series"
        ? leaf.parent.id
        : leaf.parent?.kind === "season"
          ? leaf.parent.parentId
          : null,
    ),
  );
  const root = [...roots][0];
  if (
    root == null ||
    roots.size !== 1 ||
    leaves.some(
      (leaf) =>
        leaf.kind !== "episode" ||
        leaf.catalogState !== "ready" ||
        leaf.seasonNumber === null ||
        leaf.episodeNumber === null,
    )
  )
    protectLibraryManagement();
  return root;
}

function managementPolicy(
  approval: LibraryHandoffReceipt,
  series: MediaItem,
  targets: MediaIntent[],
  input: Input,
) {
  const selected = approval.selection.scope.media.filter((item) =>
    input.mediaIds.includes(item.mediaId),
  );
  const policy = selected[0];
  const root = targets.find((target) => target.mediaId === series.id);
  if (
    policy?.profileId == null ||
    selected.length !== input.mediaIds.length ||
    selected.some(
      (item) => !item.monitored || item.profileId !== policy.profileId,
    ) ||
    series.kind !== "series" ||
    series.catalogState !== "ready" ||
    targets.length !== input.mediaIds.length + (root === undefined ? 0 : 1) ||
    approval.receipt.recoveryEpoch !== input.epoch ||
    input.access.sectionType !== "show" ||
    (root !== undefined &&
      root.generation > 0 &&
      (!root.desiredPresence ||
        !root.monitoring ||
        root.intentionallyRemovedAt !== null ||
        root.automationEpoch !== input.epoch)) ||
    targets
      .filter((target) => target.mediaId !== series.id)
      .some(
        (target) =>
          target.editionRootId !== series.id ||
          !target.desiredPresence ||
          !target.monitoring ||
          target.intentionallyRemovedAt !== null ||
          target.automationEpoch !== input.epoch ||
          target.profileId !== policy.profileId,
      )
  )
    protectLibraryManagement();
  return { root, selected, profileId: policy.profileId };
}
