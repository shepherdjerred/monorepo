import { z } from "zod";
import type {
  AcquisitionAttempt,
  MediaRequest,
  MovieEditionChoice,
} from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieAcquisitionIdentitySchema } from "#shared/movie-editions/management/contracts.ts";
import { readMovieAttemptSponsorRowsV4 } from "#infrastructure/movie-editions/attempt-sponsor.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { movieManagementContext } from "./management-context.ts";

/** Renew literal retained principals before current authority reads, never inside effect transactions. */
export async function refreshMovieAttemptRequesterAccessV4(
  initial: MediaAutomationContext,
  scope: MovieEditionScope,
  source: AcquisitionAttempt | string,
) {
  const context = movieManagementContext(initial);
  const { execution, budget } = context.movieManagement;
  execution.assertActive();
  execution.signal.throwIfAborted();
  const attempt =
    typeof source === "string"
      ? await context.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: source },
        })
      : source;
  if (typeof source === "string") budget.consume(1);
  const identity = MovieAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  if (identityHash(identity.scope) !== identityHash(scope))
    throw new Error(
      "Movie requester renewal changed its retained edition scope",
    );
  if (identity.schemaVersion === 3) return;
  const sponsor = await readMovieAttemptSponsorRowsV4(context.db, {
    attemptId: attempt.id,
    expectedScope: scope,
    expectedRequestId: identity.sponsorRequestId,
    queriedAttempt: { tx: context.db, attempt },
    budget,
  });
  if (
    sponsor === null ||
    identityHash(sponsor.authority) !== identityHash(identity.sponsorAuthority)
  )
    throw new Error(
      "Movie requester renewal changed its immutable sponsor pair",
    );
  await context.refreshRequesterAccess([sponsor.authority], execution, budget);
  execution.assertActive();
  execution.signal.throwIfAborted();
}

/** The recorded request is a locator only; normal choice guards still authorize every forward effect. */
export async function refreshMovieCommandRequesterAccessV4(
  initial: MediaAutomationContext,
  scope: MovieEditionScope,
  payload: unknown,
) {
  const locator = z
    .object({
      requestId: z.uuid().optional(),
      libraryManagementReceiptId: z.uuid().optional(),
    })
    .parse(payload);
  if (locator.libraryManagementReceiptId !== undefined) return;
  // Reviewed release selection and personal feed commands predate a birth and retain only their scope.
  if (locator.requestId === undefined)
    return refreshMovieScopeRequestersV4(initial, scope);
  const context = movieManagementContext(initial);
  const request = await context.db.mediaRequest.findUniqueOrThrow({
    where: { id: locator.requestId },
    include: { movieEditionChoice: true },
  });
  context.movieManagement.budget.consume(
    request.movieEditionChoice === null ? 1 : 2,
  );
  await refreshChoices(context, scope, [request]);
}

/** Due and caption work renew only existing live choices of their exact scope before current authority checks. */
export async function refreshMovieScopeRequestersV4(
  initial: MediaAutomationContext,
  scope: MovieEditionScope,
) {
  const context = movieManagementContext(initial);
  const requests = await context.db.mediaRequest.findMany({
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      active: true,
      direct: true,
      excluded: false,
      movieEditionChoiceId: { not: null },
    },
    include: { movieEditionChoice: true },
    orderBy: { id: "asc" },
    take: context.movieManagement.budget.takeWeighted(2),
  });
  context.movieManagement.budget.consume(
    requests.reduce(
      (count, request) => count + (request.movieEditionChoice === null ? 1 : 2),
      0,
    ),
  );
  await refreshChoices(context, scope, requests);
}

async function refreshChoices(
  context: ReturnType<typeof movieManagementContext>,
  scope: MovieEditionScope,
  requests: (MediaRequest & {
    movieEditionChoice: MovieEditionChoice | null;
  })[],
) {
  const { execution, budget } = context.movieManagement;
  execution.assertActive();
  execution.signal.throwIfAborted();
  const sponsors = requests.flatMap((request) => {
    const choice = request.movieEditionChoice;
    if (
      choice === null ||
      request.excluded ||
      !request.active ||
      !request.direct ||
      request.mediaId !== scope.mediaId ||
      request.edition !== scope.edition
    )
      return [];
    if (
      choice.id !== request.movieEditionChoiceId ||
      choice.choiceRevision !== request.movieEditionChoiceRevision ||
      choice.requestId !== request.id ||
      choice.rootMediaId !== scope.rootMediaId ||
      choice.edition !== scope.edition ||
      choice.subjectUserId !== request.userId
    )
      throw new Error(
        "Movie requester renewal lost its exact immutable choice pointer",
      );
    return [{ userId: choice.subjectUserId, actorId: choice.actorId }];
  });
  await context.refreshRequesterAccess(sponsors, execution, budget);
  execution.assertActive();
  execution.signal.throwIfAborted();
}
