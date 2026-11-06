import { z } from "zod";
import type {
  AcquisitionAttempt,
  MediaIntent,
  Prisma,
} from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MovieBirthAuthoritySchema } from "#shared/movie-editions/management/contracts.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { readLibraryMovieManagement } from "#infrastructure/movie-editions/management/authority.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

/** One retained SDK/writer/consent deadline for the actual finalization transaction. */
export async function movieFinalizationFreshnessV4(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof assertMovieRetryFinalizationV4>[1] & {
    retry: true | undefined;
    original: PlexBindingFreshness;
    writerExpiresAtMs: number;
  },
) {
  const consent =
    input.retry === true
      ? await assertMovieRetryFinalizationV4(tx, input)
      : undefined;
  return plexBindingFreshness({
    observed: input.invocation.execution.observed,
    expiresAtMs: Math.min(
      input.original.expiresAtMs,
      input.writerExpiresAtMs,
      consent?.expiresAtMs ?? input.original.expiresAtMs,
    ),
    guards:
      consent === undefined ? [input.original] : [input.original, consent],
  });
}

/** Logical recovery of a real committed Plex receipt retains current original consent under the finalizer's held locks. */
export async function assertMovieRetryFinalizationV4(
  tx: Prisma.TransactionClient,
  input: {
    attempt: AcquisitionAttempt;
    target: MediaIntent | null;
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
  },
) {
  const { attempt, target, scope, access, invocation } = input;
  const profile = z
    .object({ profileId: z.uuid(), profileVersion: z.int().nonnegative() })
    .parse(attempt.failure);
  const generations = z
    .record(z.string(), z.int().nonnegative())
    .parse(attempt.generations);
  const currentProfile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: profile.profileId },
  });
  if (
    target === null ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null ||
    target.generation !== generations[scope.mediaId] ||
    target.automationEpoch !== attempt.recoveryEpoch ||
    target.profileId !== profile.profileId ||
    currentProfile.version !== profile.profileVersion
  )
    throw new PlexBindingProtection("scope_changed");
  const birth = MovieBirthAuthoritySchema.parse(attempt.movieEditionAuthority);
  if (birth.schemaVersion === 2) {
    const management = await readLibraryMovieManagement(
      tx,
      { scope, epoch: attempt.recoveryEpoch, access, expected: birth },
      invocation,
    );
    if (management === null)
      throw new Error(
        "Committed movie finalization lost its original management approval",
      );
    return management.freshness;
  }
  const choice = await readMovieChoice(tx, {
    requestId: birth.sponsorRequestId,
    expectedScope: scope,
    access,
    budget: invocation.budget,
  });
  if (
    choice.status !== "authorized" ||
    choice.choice.id !== attempt.movieEditionChoiceId ||
    choice.choice.choiceRevision !== attempt.movieEditionChoiceRevision ||
    choice.choice.actorId !== birth.actorId
  )
    throw new PlexBindingProtection("scope_changed");
  return choice.freshness;
}
