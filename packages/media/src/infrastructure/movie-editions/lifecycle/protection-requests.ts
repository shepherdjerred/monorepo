import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import {
  movieChoiceSubject,
  type MovieProtectionAccess,
} from "#infrastructure/movie-editions/access.ts";
import { MovieEditionRequestListV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieChoiceActivationRequiredV4 } from "./public/public-state.ts";

/** No serving query or metadata is fabricated when the configured movie section is unavailable. */
export async function readMovieProtectionRequestsV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    subjectUserId: string;
    cursor: string | null;
    protection: MovieProtectionAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const subject = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: input.subjectUserId,
    purpose: "protect",
    access: input.protection,
  });
  const rows = await tx.mediaRequest.findMany({
    where: {
      userId: subject.subject.id,
      media: { kind: "movie" },
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
    },
    include: { target: true },
    orderBy: { id: "asc" },
    take: 6,
  });
  const selected = rows.slice(0, 5);
  const items = [];
  for (const request of selected) {
    const active = request.active && !request.excluded;
    const scope = MovieEditionScopeSchema.parse({
      rootMediaId: request.mediaId,
      mediaId: request.mediaId,
      edition: request.edition,
    });
    const activationRequired = await movieChoiceActivationRequiredV4(
      tx,
      {
        id: request.id,
        version: request.version,
        active,
        choiceId: request.movieEditionChoiceId,
        scope,
      },
      budget,
    );
    items.push({
      access: "protection_only",
      requestId: request.id,
      scope,
      active,
      targetVersion: request.target.version,
      requestVersion: request.version,
      choiceId: request.movieEditionChoiceId,
      choiceRevision: request.movieEditionChoiceRevision,
      fulfillment: protectionFulfillmentV4(
        active,
        request.movieEditionChoiceId,
      ),
      canCancel: active,
      canRevokeChoice: active && request.movieEditionChoiceId !== null,
      activationRequired,
    });
  }
  subject.freshness?.assertActive();
  return MovieEditionRequestListV4Schema.parse({
    schemaVersion: 4,
    subjectUserId: subject.subject.id,
    items,
    nextCursor: rows.length > 5 ? (selected.at(-1)?.id ?? null) : null,
  });
}

function protectionFulfillmentV4(
  active: boolean,
  choiceId: string | null,
): MovieEditionFulfillment {
  if (!active)
    return { status: "protected", reason: "movie_edition_choice_changed" };
  return choiceId === null
    ? { status: "pending_choice", reason: "movie_edition_choice_required" }
    : { status: "protected", reason: "plex_scope_unconfigured" };
}
