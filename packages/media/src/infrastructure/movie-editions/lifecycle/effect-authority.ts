import { z } from "zod";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { movieAssessmentContext } from "#infrastructure/movie-editions/release-assessment.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { assertMovieAttemptIdentityV4 } from "./attempt-identity.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/authority.ts";

/** Complete scope and runtime locks belong to the caller. No version, birth or observation is renewed here. */
export async function movieAttemptEffectAuthorityV4(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  scope: MovieEditionScope,
  authority: {
    access: MovieChoiceAccess;
    invocation?: MovieManagementInvocation;
  },
) {
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const generations = z
    .record(z.string(), z.int().nonnegative())
    .parse(attempt.generations);
  const capturedProfile = z
    .object({ profileId: z.uuid(), profileVersion: z.int().nonnegative() })
    .parse(attempt.failure);
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  if (
    !target.monitoring ||
    !target.desiredPresence ||
    target.intentionallyRemovedAt !== null ||
    target.automationEpoch !== attempt.recoveryEpoch ||
    target.generation !== generations[scope.mediaId] ||
    reservation?.attemptId !== attempt.id ||
    reservation.generation !== target.generation
  )
    return null;
  await tx.$queryRaw`SELECT id FROM "QualityProfile" WHERE id = ${capturedProfile.profileId} FOR SHARE`;
  const current = await movieAssessmentContext(tx, scope);
  if (
    current.profile.id !== capturedProfile.profileId ||
    current.profile.version !== capturedProfile.profileVersion
  )
    return null;
  const authorized = await assertMovieAttemptIdentityV4(
    tx,
    attempt,
    scope,
    authority,
  );
  const candidate = {
    id: authorized.release.id,
    providerId: authorized.release.providerId,
    title: authorized.release.title,
    ...authorized.assessment.attributes,
  };
  const profile = {
    id: current.profile.id,
    version: current.profile.version,
    ...current.rules,
  };
  if (!evaluateRelease(candidate, profile, [scope.mediaId]).accepted)
    return null;
  authorized.freshness.assertActive();
  return {
    ...authorized,
    profile,
    target,
    policyMetadata: {
      runtimeMinutes: current.runtimeMinutes,
      originalLanguage: current.originalLanguage,
    },
  };
}
