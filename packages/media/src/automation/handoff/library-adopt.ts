import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type {
  LibraryHandoffScope,
  LibraryHandoffNetworkProtocolSchema,
} from "#shared/handoff/protocol.ts";
import {
  movieDefinitionRef,
  matchesMovieDefinition,
} from "#infrastructure/movie-editions/definition.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { defaultPhysicalRoot } from "#infrastructure/handoff/default-edition.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { releasePersonalMigrationHolds } from "#migration/personal-state/holds.ts";

export async function adoptLibraryTargets(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    scope: LibraryHandoffScope;
    network: z.infer<typeof LibraryHandoffNetworkProtocolSchema>;
  },
): Promise<void> {
  const { scope, network, planId } = input;
  for (const selected of scope.targets) {
    const media = scope.media.find((item) => item.mediaId === selected.mediaId);
    if (media === undefined)
      throw new Error("Initial library target has no canonical snapshot");
    const movie = scope.files.some(
      (file) =>
        file.libraryKind === "movies" &&
        file.mediaIds.includes(selected.mediaId),
    );
    const rootMediaId = movie
      ? selected.mediaId
      : await defaultPhysicalRoot(tx, [selected.mediaId]);
    if (movie) {
      await ensureMovieDefinition(tx, {
        rootMediaId,
        edition: selected.edition,
      });
    }
    const plex = network.plex.filter(
      (item) =>
        item.mediaId === selected.mediaId && item.edition === selected.edition,
    );
    const priorKeeping = await tx.mediaIntent.findUnique({
      where: {
        mediaId_edition: {
          mediaId: selected.mediaId,
          edition: selected.edition,
        },
      },
      select: { libraryPolicyExplicit: true },
    });
    const data = {
      ...(priorKeeping?.libraryPolicyExplicit === true ||
      !(await hasPhysicalLibrary(tx, selected, scope.files))
        ? {}
        : { libraryKeep: true }),
      profileId: media.profileId,
      automationEpoch: scope.request.recoveryEpoch,
      desiredPresence: true,
      monitoring: media.monitored,
      libraryMonitoring:
        media.monitored &&
        (movie ||
          selected.mediaId !== rootMediaId ||
          (scope.request.schemaVersion === 3 &&
            scope.request.seriesMonitoring?.some(
              (policy) => policy.seriesId === rootMediaId,
            ) === true)),
      intentionallyRemovedAt: null,
      ...(plex.length === 0 ? {} : { availability: "available" as const }),
    };
    const intent = await tx.mediaIntent.upsert({
      where: {
        mediaId_edition: {
          mediaId: selected.mediaId,
          edition: selected.edition,
        },
      },
      create: {
        mediaId: selected.mediaId,
        edition: selected.edition,
        editionRootId: rootMediaId,
        generation: 1,
        ...data,
      },
      update: {
        ...data,
        generation: { increment: 1 },
        version: { increment: 1 },
      },
    });
    await tx.retentionDecision.updateMany({
      where: {
        mediaId: selected.mediaId,
        edition: selected.edition,
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: { state: "cancelled", version: { increment: 1 } },
    });
    await retainHouseholdHold(tx, { scope, selected });
    await tx.applicationEvent.create({
      data: {
        mediaId: selected.mediaId,
        kind: "library_target_adopted_v2",
        payload: {
          schemaVersion: 2,
          planId,
          edition: selected.edition,
          generation: intent.generation,
          recoveryEpoch: scope.request.recoveryEpoch,
        },
      },
    });
  }
  await updateCanonicalMedia(tx, input);
  const imported = await tx.applicationEvent.findFirst({
    where: { kind: "personal_state_imported", actorId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, actorId: true },
  });
  if (imported?.actorId !== null && imported?.actorId !== undefined)
    await releasePersonalMigrationHolds(tx, {
      actorId: imported.actorId,
      eventId: imported.id,
      scopes: scope.targets,
    });
}

async function hasPhysicalLibrary(
  tx: Prisma.TransactionClient,
  selected: LibraryHandoffScope["targets"][number],
  files: LibraryHandoffScope["files"],
) {
  const ancestry = {
    OR: [
      { id: selected.mediaId },
      { parentId: selected.mediaId },
      { parent: { parentId: selected.mediaId } },
    ],
  } satisfies Prisma.MediaItemWhereInput;
  const provedIds = files
    .filter((file) => file.edition === selected.edition)
    .flatMap((file) => file.mediaIds);
  // applyPreparedHandoff has rechecked every selected file's physical proof.
  // Targets precede native asset/coverage rebinding, so current coverage alone
  // cannot recognize a fresh file or a passive file's newly reviewed named cut.
  if (
    provedIds.length > 0 &&
    (await tx.mediaItem.findFirst({
      where: { id: { in: provedIds }, ...ancestry },
      select: { id: true },
    })) !== null
  )
    return true;
  return (
    (await tx.assetCoverage.findFirst({
      where: {
        current: true,
        edition: selected.edition,
        media: ancestry,
      },
      select: { assetId: true },
    })) !== null
  );
}

async function retainHouseholdHold(
  tx: Prisma.TransactionClient,
  input: {
    scope: LibraryHandoffScope;
    selected: LibraryHandoffScope["targets"][number];
  },
) {
  const { scope, selected } = input;
  const prior = await tx.recoveryHold.findUnique({
    where: {
      mediaId_edition: { mediaId: selected.mediaId, edition: selected.edition },
    },
  });
  // A file import must not overwrite a real/manual hold, or resurrect a source
  // review that a genuine immutable personal-import receipt already settled.
  if (
    prior !== null &&
    (prior.reason !== "migration_household_intent_review_required" ||
      prior.releasedAt !== null)
  )
    return;
  if (
    scope.files.some(
      (file) =>
        file.edition === selected.edition &&
        file.mediaIds.includes(selected.mediaId),
    )
  )
    await tx.recoveryHold.upsert({
      where: {
        mediaId_edition: {
          mediaId: selected.mediaId,
          edition: selected.edition,
        },
      },
      create: {
        mediaId: selected.mediaId,
        edition: selected.edition,
        recoveryEpoch: scope.request.recoveryEpoch,
        reason: "migration_household_intent_review_required",
      },
      update: {
        recoveryEpoch: scope.request.recoveryEpoch,
        reason: "migration_household_intent_review_required",
        releasedAt: null,
        releasedById: null,
        releaseEvidence: Prisma.DbNull,
        version: { increment: 1 },
      },
    });
}

async function updateCanonicalMedia(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof adoptLibraryTargets>[1],
) {
  const { scope, network } = input;
  for (const selected of scope.media) {
    const first = network.plex.find(
      (item) => item.mediaId === selected.mediaId && item.edition === "default",
    );
    const item = await tx.mediaItem.findUniqueOrThrow({
      where: { id: selected.mediaId },
    });
    const externalIds = z.record(z.string(), z.json()).parse(item.externalIds);
    await tx.mediaItem.update({
      where: { id: selected.mediaId },
      data: {
        version: { increment: 1 },
        ...(first === undefined
          ? {}
          : {
              availability: "available",
              externalIds: {
                ...externalIds,
                plexRatingKey: first.ratingKey,
                plexSectionId: first.sectionId,
              },
            }),
      },
    });
    if (first !== undefined)
      await mirrorDefaultAvailability(tx, [selected.mediaId], "available");
  }
}

async function ensureMovieDefinition(
  tx: Prisma.TransactionClient,
  scope: {
    rootMediaId: string;
    edition: LibraryHandoffScope["targets"][number]["edition"];
  },
) {
  const ref = movieDefinitionRef(scope.rootMediaId, scope.edition);
  const stored = await tx.mediaEditionDefinition.findUnique({
    where: {
      rootMediaId_key: { rootMediaId: scope.rootMediaId, key: scope.edition },
    },
  });
  if (stored !== null && !matchesMovieDefinition(stored, ref.definition))
    throw new Error("Initial library edition definition changed");
  if (stored === null)
    await tx.mediaEditionDefinition.create({
      data: {
        ...ref.definition,
        displayLabel: movieEditionDisplayLabel(scope.edition),
      },
    });
}
