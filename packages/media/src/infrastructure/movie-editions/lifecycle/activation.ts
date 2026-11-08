import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { ActivateMovieEditionChoiceV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { movieChoiceSubject } from "#infrastructure/movie-editions/access.ts";
import {
  lockMovieCommand,
  movieCommandConflict,
} from "#infrastructure/movie-editions/locks.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { personalRequestGenerationChange } from "#infrastructure/library-monitoring/intent.ts";
import { invalidateMovieRetentionV4 } from "./invalidate.ts";
import { movieChoiceActivationRequiredV4 } from "./public/public-state.ts";

/** Continue the actual selected choice; its birth and historical v3 ACK are never rewritten. */
export async function activateMovieChoiceV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: ActivateMovieEditionChoiceV4,
  authority: {
    access: MovieChoiceAccess;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { media, target } = await lockMovieCommand(tx, input.scope);
  if (
    target === null ||
    media.version !== input.expected.mediaVersion ||
    target.version !== input.expected.targetVersion
  )
    throw movieCommandConflict();
  const subject = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: input.subjectUserId,
    purpose: "choose",
    access: authority.access,
  });
  const selected = await readMovieChoice(tx, {
    requestId: input.requestId,
    expectedScope: input.scope,
    ...authority,
  });
  if (selected.status !== "authorized")
    throw new MediaError(
      "movie_choice_activation_protected",
      "The current edition choice must remain authorized",
      409,
    );
  if (
    selected.request.userId !== input.subjectUserId ||
    selected.request.version !== input.expected.requestVersion ||
    selected.choice.id !== input.choiceId ||
    selected.choice.choiceRevision !== input.expected.choiceRevision
  )
    throw movieCommandConflict();
  if (
    !(await movieChoiceActivationRequiredV4(
      tx,
      {
        id: selected.request.id,
        version: selected.request.version,
        active: true,
        choiceId: selected.choice.id,
        scope: input.scope,
      },
      authority.budget,
    ))
  )
    throw new MediaError(
      "movie_choice_already_active",
      "This exact edition declaration already has its scoped command",
      409,
    );
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  if (reservation !== null)
    throw new MediaError(
      "native_operation_unsettled",
      "Finish or recover the current acquisition before activating this choice",
      409,
    );
  const epoch = await commandAutomationEpoch(tx);
  if (epoch < 0)
    throw new MediaError(
      "runtime_protected",
      "Media automation is paused",
      409,
    );
  const defaults = await tx.qualityProfileDefault.findUnique({
    where: { kind: "movie" },
  });
  const profileId = target.profileId ?? defaults?.profileId;
  if (profileId === undefined)
    throw new MediaError(
      "quality_profile_required",
      "Select a movie quality profile before activation",
      409,
    );
  const intent = await tx.mediaIntent.update({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
    data: {
      desiredPresence: true,
      monitoring: true,
      intentionallyRemovedAt: null,
      ...personalRequestGenerationChange(target, epoch),
      version: { increment: 1 },
      profileId,
      automationEpoch: epoch,
    },
  });
  const updated = await tx.mediaItem.update({
    where: { id: media.id },
    data: { version: { increment: 1 } },
  });
  await invalidateMovieRetentionV4(tx, input.scope);
  const freshness = {
    expiresAtMs: Math.min(
      subject.freshness?.expiresAtMs ?? Infinity,
      selected.freshness.expiresAtMs,
    ),
    assertActive: () => {
      subject.freshness?.assertActive();
      selected.freshness.assertActive();
    },
  };
  freshness.assertActive();
  return { media: updated, intent, selected, freshness };
}
