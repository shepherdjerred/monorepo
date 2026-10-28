import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  movieChoiceSubject,
  movieSourceSection,
} from "#infrastructure/movie-editions/access.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { readLibraryMovieManagement } from "#infrastructure/movie-editions/management/authority.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { movieAssessmentContext } from "#infrastructure/movie-editions/release-assessment.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { evaluateRelease } from "#domain/quality.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { readMovieRetrySourceV4 } from "./retry-source.ts";

export async function movieRetryAuthorityV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    source: Awaited<ReturnType<typeof readMovieRetrySourceV4>>;
    access: MovieChoiceAccess;
    actorId?: string;
    invocation?: MovieManagementInvocation;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { source, scope, budget } = input;
  const current = await movieAssessmentContext(tx, scope, budget);
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  if (
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null ||
    target.generation !== source.generation ||
    target.automationEpoch !== source.attempt.recoveryEpoch ||
    reservation?.attemptId !== source.attempt.id ||
    reservation.generation !== source.generation ||
    identityHash(current.profile) !==
      identityHash(source.recorded.assessment.profile) ||
    current.canonicalHash !== source.recorded.assessment.canonicalHash
  )
    throw new MediaError(
      "movie_retry_authority_changed",
      "Original movie acquisition choice, profile or scope changed",
      409,
    );
  const cut = await assertMovieCutV2(tx, {
    scope,
    releaseId: source.attempt.releaseId,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
    budget,
  });
  if (
    identityHash(cut.candidate) !== identityHash(source.recorded.assessment.cut)
  )
    throw new MediaError(
      "movie_retry_authority_changed",
      "Original movie cut evidence changed",
      409,
    );
  const candidate = {
    id: source.recorded.release.id,
    providerId: source.recorded.release.providerId,
    title: source.recorded.release.title,
    ...source.recorded.assessment.attributes,
  };
  if (
    !evaluateRelease(
      candidate,
      {
        id: current.profile.id,
        version: current.profile.version,
        ...current.rules,
      },
      [scope.mediaId],
    ).accepted
  )
    throw new MediaError(
      "movie_retry_authority_changed",
      "Original movie release no longer satisfies its captured profile",
      409,
    );
  return retryConsent(tx, input);
}

async function retryConsent(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof movieRetryAuthorityV4>[1],
) {
  const { source, scope, access, budget } = input;
  const identity = source.recorded.identity;
  if (identity.schemaVersion === 3) {
    if (input.invocation === undefined)
      return manualManagementAdmission(tx, input, identity.management.actorId);
    const management = await readLibraryMovieManagement(
      tx,
      {
        scope,
        epoch: source.attempt.recoveryEpoch,
        access,
        expected: identity.management,
      },
      input.invocation,
    );
    if (management === null)
      throw new Error("Recorded movie management approval disappeared");
    return management.freshness;
  }
  const current = await readMovieChoice(tx, {
    requestId: identity.sponsorRequestId,
    expectedScope: scope,
    access,
    budget,
  });
  if (
    current.status !== "authorized" ||
    current.choice.id !== source.attempt.movieEditionChoiceId ||
    current.choice.choiceRevision !==
      source.attempt.movieEditionChoiceRevision ||
    current.choice.actorId !== identity.sponsorAuthority.actorId ||
    (input.actorId !== undefined && current.choice.actorId !== input.actorId)
  )
    throw new MediaError(
      "movie_retry_choice_changed",
      "Retry must retain the same current personal movie choice",
      409,
    );
  current.freshness.assertActive();
  return current.freshness;
}

async function manualManagementAdmission(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof movieRetryAuthorityV4>[1],
  ownerId: string,
) {
  if (input.actorId !== ownerId)
    throw new MediaError(
      "owner_required",
      "Only the original approving owner may retry this managed acquisition",
      403,
    );
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  const current = await movieChoiceSubject(tx, {
    actorId: ownerId,
    subjectUserId: ownerId,
    access: input.access,
    purpose: "choose",
    mediaSectionId: movieSourceSection(media.externalIds),
  });
  if (
    current.actor.role !== "owner" ||
    !target.libraryMonitoring ||
    current.freshness === null
  )
    throw new MediaError(
      "movie_retry_management_required",
      "Current owner-approved movie management is required",
      409,
    );
  current.freshness.assertActive();
  return current.freshness;
}
