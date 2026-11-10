import type { MediaAutomationContext } from "#automation/context.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { MediaError } from "#application/errors.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { managedSponsorActor } from "#infrastructure/acquisition-identity/sponsor.ts";

/** Capture once before the first await. Never mutate a cached worker context or replace a caller's allowance. */
export async function acquisitionInvocation(
  initial: MediaAutomationContext,
  target: { mediaId: string } | { attemptId: string },
) {
  if (initial.libraryManagement !== undefined) {
    initial.libraryManagement.freshness.assertActive();
    return initial;
  }
  const execution = initial.plexBindingExecution();
  execution.assertActive();
  const attempt =
    "attemptId" in target
      ? await initial.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: target.attemptId },
          select: { mediaIds: true, identityEvidence: true },
        })
      : null;
  const mediaIds = "mediaId" in target ? [target.mediaId] : attempt?.mediaIds;
  if (mediaIds === undefined)
    throw new Error("Acquisition invocation lost its target");
  const episode = await initial.db.mediaItem.findFirst({
    where: { id: { in: mediaIds }, kind: "episode" },
    select: { id: true },
  });
  const context = { ...initial, plexBindingExecution: () => execution };
  if (episode === null) return context;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [
      execution,
      {
        assertActive: () => {
          execution.signal.throwIfAborted();
        },
      },
    ],
  });
  const access = await initial.plexAccess("show");
  freshness.assertActive();
  const budget =
    initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget();
  await refreshPersonalTvAccess(context, {
    target,
    mediaIds,
    attempt,
    execution,
    budget,
  });
  freshness.assertActive();
  return {
    ...context,
    libraryManagement: {
      freshness,
      access,
      budget,
    },
  };
}

async function refreshPersonalTvAccess(
  context: MediaAutomationContext,
  input: {
    target: { mediaId: string } | { attemptId: string };
    mediaIds: string[];
    attempt: { identityEvidence: unknown } | null;
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const reservation =
    "mediaId" in input.target
      ? await context.db.acquisitionReservation.findUnique({
          where: {
            mediaId_edition: {
              mediaId: input.target.mediaId,
              edition: "default",
            },
          },
          select: { attempt: { select: { identityEvidence: true } } },
        })
      : null;
  input.budget.consume(reservation === null ? 0 : 2);
  const retained = input.attempt ?? reservation?.attempt;
  const identity =
    retained?.identityEvidence == null
      ? null
      : DefaultAcquisitionIdentitySchema.parse(retained.identityEvidence);
  if (identity !== null && identity.schemaVersion !== 1) return;
  const requests =
    identity === null
      ? await context.db.mediaRequest.findMany({
          where: { mediaId: { in: input.mediaIds }, ...effectiveRequestWhere },
          select: {
            id: true,
            userId: true,
            sponsorRequestId: true,
            user: { select: { plexIdentity: { select: { kind: true } } } },
          },
          take: Math.min(101, input.budget.takeWeighted(3)),
        })
      : [];
  input.budget.consume(
    requests.reduce(
      (count, request) =>
        count + 2 + (request.user.plexIdentity === null ? 0 : 1),
      0,
    ),
  );
  if (requests.length > 100)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Requester refresh exceeds the bounded acquisition scope",
      409,
    );
  const sponsors =
    identity === null
      ? await Promise.all(
          requests.map(async (request) => {
            const actorId =
              request.user.plexIdentity?.kind === "managed"
                ? await managedSponsorActor(context.db, request, input.budget)
                : request.userId;
            if (actorId === null)
              throw new MediaError(
                "plex_library_access_required",
                "Managed requester has no recorded owner coordinator",
                403,
              );
            return { userId: request.userId, actorId };
          }),
        )
      : [identity.sponsorAuthority];
  await context.refreshRequesterAccess(sponsors, input.execution, input.budget);
}
