import type {
  MediaIntent,
  MediaItem,
  Prisma,
} from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "#infrastructure/handoff/library-receipt.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  LibrarySeriesManagementSchema,
  type LibrarySeriesManagement,
} from "#shared/acquisition/library-management.ts";
import { identityHash } from "./snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  PlexAssociationSchema,
  type PlexAccess,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";

export type LibraryManagementInvocation = {
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
  access: PlexAccess;
};
type Input = {
  mediaIds: readonly string[];
  epoch: number;
  access: PlexAccess;
  expected?: LibrarySeriesManagement;
};
const hash = (value: unknown) => identityHash(nativeJson(value));
export function protectLibraryManagement(): never {
  throw new MediaError(
    "library_management_unconfirmed",
    "Existing-library monitoring needs its current owner-approved policy",
    409,
  );
}

/** Caller holds canonical/target/runtime locks for mutation. Historical source rows consume the caller's one allowance. */
export async function readLibrarySeriesManagement(
  tx: Prisma.TransactionClient,
  input: Input,
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  const leaves = await tx.mediaItem.findMany({
    where: { id: { in: [...input.mediaIds] } },
    include: { parent: true },
    orderBy: { id: "asc" },
  });
  const seriesId = managementSeries(leaves, input.mediaIds);
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
  if (origin === undefined) return null;
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
  const association = await sourceAssociation(
    tx,
    { approval, root, input },
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

async function sourceAssociation(
  tx: Prisma.TransactionClient,
  state: { approval: LibraryHandoffReceipt; root: MediaItem; input: Input },
  invocation: LibraryManagementInvocation,
) {
  const { approval, root, input } = state;
  const files = approval.selection.scope.files.filter(
    (file) => file.libraryKind === "tv",
  );
  const where =
    input.expected === undefined
      ? {
          assetId: { in: files.map((file) => file.assetId) },
          serverMachineId: input.access.serverMachineId,
          edition: "default",
          evidence: { path: ["editionRootId"], equals: root.id },
        }
      : { id: input.expected.association.evidenceId };
  const rows = await tx.plexAssociationEvidence.findMany({
    where,
    orderBy: { id: "asc" },
    take: 1,
  });
  invocation.budget.consume(rows.length);
  const row = rows[0];
  if (row === undefined) protectLibraryManagement();
  const evidence = parsePlexRecord(
    PlexAssociationSchema,
    row.evidence,
    row.associationHash,
  );
  if (
    evidence.kind !== "episode" ||
    evidence.editionRootId !== root.id ||
    evidence.scope.edition !== "default" ||
    evidence.access.serverMachineId !== input.access.serverMachineId ||
    evidence.access.sectionId !== input.access.sectionId ||
    !files.some(
      (file) =>
        file.assetId === row.assetId &&
        file.mediaIds.includes(evidence.scope.mediaId),
    ) ||
    root.tmdbId === null ||
    !evidence.hierarchy.show.guids.includes(`tmdb://${String(root.tmdbId)}`)
  )
    protectLibraryManagement();
  return { evidenceId: row.id, associationHash: row.associationHash };
}
