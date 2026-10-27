import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieRequestV3 } from "#shared/movie-editions/commands.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";
import { queueMediaSubtitleTargets } from "#automation/subtitles/queue.ts";
import {
  movieChoiceSubject,
  movieChoiceAudit,
  movieSourceSection,
  type MovieChoiceAccess,
} from "./access.ts";
import { lockMovieCommand, movieCommandConflict } from "./locks.ts";
import { matchesMovieDefinition, movieDefinitionRef } from "./definition.ts";
import { personalRequestGenerationChange } from "#infrastructure/library-monitoring/intent.ts";

export async function chooseMovieEdition(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: Omit<MovieRequestV3, "schemaVersion">,
  access: MovieChoiceAccess,
) {
  const scope = {
    rootMediaId: input.mediaId,
    mediaId: input.mediaId,
    edition: input.selection.edition,
  };
  const { media, target } = await lockMovieCommand(tx, scope);
  const proposed = movieDefinitionRef(media.id, scope.edition);
  const stored = await tx.mediaEditionDefinition.findUnique({
    where: { rootMediaId_key: { rootMediaId: media.id, key: scope.edition } },
  });
  const prior = await tx.mediaRequest.findUnique({
    where: {
      userId_mediaId_edition: {
        userId: input.subjectUserId,
        mediaId: media.id,
        edition: scope.edition,
      },
    },
  });
  assertChoiceCas(input, {
    mediaVersion: media.version,
    targetVersion: target?.version ?? null,
    stored,
    prior,
    proposed,
  });
  const epoch = await commandAutomationEpoch(tx);
  const subject = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: input.subjectUserId,
    access,
    purpose: "choose",
    mediaSectionId: movieSourceSection(media.externalIds),
  });
  if (stored === null)
    await tx.mediaEditionDefinition.create({
      data: {
        ...proposed.definition,
        displayLabel: movieEditionDisplayLabel(scope.edition),
      },
    });
  const defaults =
    scope.edition === "default"
      ? await tx.qualityProfileDefault.findUnique({ where: { kind: "movie" } })
      : null;
  const intent = await tx.mediaIntent.upsert({
    where: { mediaId_edition: { mediaId: media.id, edition: scope.edition } },
    create: {
      mediaId: media.id,
      edition: scope.edition,
      editionRootId: media.id,
      generation: 1,
      version: 1,
      desiredPresence: true,
      monitoring: scope.edition === "default",
      availability: scope.edition === "default" ? media.availability : "wanted",
      profileId: defaults?.profileId ?? null,
      automationEpoch: scope.edition === "default" ? epoch : -1,
    },
    update: {
      desiredPresence: true,
      monitoring:
        target?.libraryMonitoring === true || scope.edition === "default",
      intentionallyRemovedAt: null,
      ...personalRequestGenerationChange(target, epoch),
      version: { increment: 1 },
      ...(scope.edition === "default"
        ? {
            automationEpoch: epoch,
            profileId: target?.profileId ?? defaults?.profileId ?? null,
          }
        : {}),
    },
  });
  const base =
    prior ??
    (await tx.mediaRequest.create({
      data: {
        mediaId: media.id,
        edition: scope.edition,
        userId: input.subjectUserId,
      },
    }));
  const choice = await tx.movieEditionChoice.create({
    data: {
      requestId: base.id,
      choiceRevision: base.movieEditionChoiceRevision + 1,
      actorId: subject.actor.id,
      subjectUserId: subject.subject.id,
      rootMediaId: media.id,
      edition: scope.edition,
      definitionVersion: proposed.definitionVersion,
      registryVersion: input.selection.registryVersion,
      requestVersionAtChoice: base.version + 1,
      authority: movieChoiceAudit(subject, access),
    },
  });
  const request = await tx.mediaRequest.update({
    where: { id: base.id },
    data: {
      active: true,
      direct: true,
      excluded: false,
      coverageCompletedAt: null,
      subtitleLanguages: input.options.subtitleLanguages,
      movieEditionChoiceId: choice.id,
      movieEditionChoiceRevision: choice.choiceRevision,
      version: { increment: 1 },
    },
  });
  const updated = await tx.mediaItem.update({
    where: { id: media.id },
    data: { version: { increment: 1 } },
  });
  if (scope.edition === "default") {
    await invalidateRetention(tx, media.id);
    await queueMediaSubtitleTargets(tx, media.id);
  }
  await tx.applicationEvent.create({
    data: {
      mediaId: media.id,
      actorId: subject.actor.id,
      kind: "movie_edition_chosen",
      payload: {
        requestId: request.id,
        subjectUserId: subject.subject.id,
        choiceId: choice.id,
        choiceRevision: choice.choiceRevision,
        edition: scope.edition,
      },
    },
  });
  subject.freshness?.assertActive();
  return {
    request,
    choice,
    intent,
    media: updated,
    freshness: subject.freshness,
  };
}

function assertChoiceCas(
  input: Omit<MovieRequestV3, "schemaVersion">,
  current: {
    mediaVersion: number;
    targetVersion: number | null;
    stored: Awaited<
      ReturnType<
        Prisma.TransactionClient["mediaEditionDefinition"]["findUnique"]
      >
    >;
    prior: Awaited<
      ReturnType<Prisma.TransactionClient["mediaRequest"]["findUnique"]>
    >;
    proposed: ReturnType<typeof movieDefinitionRef>;
  },
) {
  const { expected, selection } = input;
  if (
    current.stored !== null &&
    !matchesMovieDefinition(current.stored, current.proposed.definition)
  )
    throw new MediaError(
      "edition_definition_conflict",
      "Stored edition authority conflicts with the registry",
      409,
    );
  if (
    selection.definitionDigest !== current.proposed.definitionDigest ||
    expected.mediaVersion !== current.mediaVersion ||
    expected.targetVersion !== current.targetVersion ||
    (expected.definition === null) !== (current.stored === null) ||
    (expected.definition !== null &&
      expected.definition.definitionDigest !==
        current.proposed.definitionDigest) ||
    (expected.request === null) !== (current.prior === null) ||
    (expected.request !== null &&
      (expected.request.id !== current.prior?.id ||
        expected.request.version !== current.prior.version ||
        expected.request.choiceRevision !==
          current.prior.movieEditionChoiceRevision))
  )
    throw movieCommandConflict();
}
