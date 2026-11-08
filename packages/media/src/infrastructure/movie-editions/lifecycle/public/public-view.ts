import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  readMovieEditionContext,
  readMovieEditionRequests,
} from "#infrastructure/movie-editions/view.ts";
import {
  MovieEditionContextV4Schema,
  MovieEditionRequestListV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { movieChoiceActivationRequiredV4 } from "./public-state.ts";
import { readMovieProtectionRequestsV4 } from "#infrastructure/movie-editions/lifecycle/protection-requests.ts";
import {
  movieReadProtectionAccessV4,
  type MovieProtectionViewAccessV4,
} from "./public-access.ts";
import { movieOperationalAdmissionV4 } from "./public-inventory.ts";

export async function readMovieEditionContextV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: { mediaId: string; subjectUserId: string; access: MovieChoiceAccess },
  budget = new PublicationAuthorityReadBudget(),
) {
  const context = await readMovieEditionContext(tx, actor, input, budget);
  const runtime = await runtimeAuthority(tx);
  const defaults = await tx.qualityProfileDefault.findUnique({
    where: { kind: "movie" },
  });
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: input.mediaId },
  });
  const options = [];
  for (const option of context.options) {
    const reasons: string[] = option.reasons.filter(
      (reason) => reason !== "edition_acquisition_not_ready",
    );
    const target = targets.find((row) => row.edition === option.edition);
    const inventory = await movieOperationalAdmissionV4(
      tx,
      {
        scope: {
          rootMediaId: input.mediaId,
          mediaId: input.mediaId,
          edition: option.edition,
        },
        generation: target?.generation ?? 0,
        actorId: actor.id,
      },
      budget,
    );
    if (inventory.recoveryHeld) reasons.push("recovery_hold");
    if (inventory.reserved) reasons.push("acquisition_active");
    if (!runtime.active) reasons.push("runtime_protected");
    if (defaults === null && target?.profileId == null)
      reasons.push("quality_profile_required");
    const activationRequired =
      option.request === null
        ? false
        : await movieChoiceActivationRequiredV4(
            tx,
            {
              id: option.request.id,
              version: option.request.version,
              active: await requestActive(tx, option.request.id),
              choiceId: option.request.choiceId,
              scope: {
                rootMediaId: input.mediaId,
                mediaId: input.mediaId,
                edition: option.edition,
              },
            },
            budget,
          );
    options.push({
      ...option,
      reasons,
      activationRequired,
      acquisition: reasons.length === 0 ? "eligible" : "protected",
    });
  }
  return MovieEditionContextV4Schema.parse({
    ...context,
    schemaVersion: 4,
    options,
  });
}

async function requestActive(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.mediaRequest.findUniqueOrThrow({ where: { id } });
  return row.active && row.direct && !row.excluded;
}

export async function readMovieEditionRequestsV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    subjectUserId: string;
    cursor: string | null;
  } & MovieProtectionViewAccessV4,
  budget = new PublicationAuthorityReadBudget(),
) {
  if (input.access === null)
    return readMovieProtectionRequestsV4(
      tx,
      actor,
      {
        subjectUserId: input.subjectUserId,
        cursor: input.cursor,
        protection: movieReadProtectionAccessV4(input),
      },
      budget,
    );
  // Each fulfillment traverses its actual provenance with this one allowance.
  // A bounded page does not allocate another allowance for the next item.
  const page = await readMovieEditionRequests(
    tx,
    actor,
    {
      subjectUserId: input.subjectUserId,
      cursor: input.cursor,
      access: input.access,
    },
    {
      budget,
      pageSize: 5,
    },
  );
  const items = [];
  for (const item of page.items) {
    const activationRequired = await movieChoiceActivationRequiredV4(
      tx,
      {
        id: item.requestId,
        version: item.requestVersion,
        active: item.active,
        choiceId: item.choiceId,
        scope: item.scope,
      },
      budget,
    );
    items.push({ ...item, activationRequired });
  }
  return MovieEditionRequestListV4Schema.parse({
    ...page,
    schemaVersion: 4,
    items,
  });
}
