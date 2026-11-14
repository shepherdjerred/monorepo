import type { MediaRequest } from "#generated/prisma/client.ts";
import { currentFulfillmentAsset } from "#automation/editions/fulfillment.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { readMovieDemandAuthority } from "#infrastructure/movie-editions/fulfillment.ts";
import { watchRequesterMappingVerification } from "#infrastructure/plex-binding/watch.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { householdRetentionState } from "#infrastructure/request-interest/protection.ts";
import type { RetentionPlexAuthority } from "./retention.ts";
import { FileGuardError, type Transaction } from "#automation/files/types.ts";

type RetentionMovieInput = {
  mediaId: string;
  kind: string;
  requests: readonly Pick<MediaRequest, "direct" | "interestState">[];
  household: Awaited<ReturnType<typeof householdRetentionState>>;
  access: MovieChoiceAccess | undefined;
  budget: PublicationAuthorityReadBudget;
  plex: RetentionPlexAuthority | undefined;
};
type AuthorizedMovieInput = RetentionMovieInput & {
  access: MovieChoiceAccess;
};

/** Caller owns the complete request/identity cohort and original invocation budget. */
export async function captureRetentionMovieAuthority(
  tx: Transaction,
  input: RetentionMovieInput,
): Promise<MovieChoiceFreshness[]> {
  if (input.kind !== "movie") return [];
  const access = input.access;
  if (access === undefined)
    throw new FileGuardError("movie_edition_choice_changed");
  const authorized = { ...input, access };
  const demand = await currentDemandFreshness(tx, authorized);
  const choices = await choiceRecipientFreshness(tx, authorized);
  await assertHistoricalRecipientIdentities(tx, authorized, choices.userIds);
  return [...(demand === null ? [] : [demand]), ...choices.guards];
}

async function currentDemandFreshness(
  tx: Transaction,
  input: AuthorizedMovieInput,
): Promise<MovieChoiceFreshness | null> {
  // Released direct claims explain removal; they are not new acquisition
  // demand. A derived claim still needs the exact live container predicate.
  if (
    !input.requests.some(
      (request) => !request.direct || request.interestState === "following",
    )
  )
    return null;
  const demand = await readMovieDemandAuthority(tx, {
    mediaId: input.mediaId,
    access: input.access,
    budget: input.budget,
    currentAsset: await currentFulfillmentAsset(tx, input.mediaId),
  });
  for (const request of demand.demands) {
    if (request.fulfillment.status === "not_applicable")
      throw new Error("Movie retention demand lost its movie authority");
    if (request.fulfillment.status !== "fulfilled")
      throw new FileGuardError(request.fulfillment.reason);
  }
  return demand.freshness;
}

async function choiceRecipientFreshness(
  tx: Transaction,
  input: AuthorizedMovieInput,
) {
  // Finished roots remain deletion/notice participants. Revalidate their
  // exact actor and subject without making them acquisition or restore demand.
  const guards: MovieChoiceFreshness[] = [];
  const userIds = new Set<string>();
  for (const request of input.household.roots) {
    if (request.movieEditionChoiceId === null) continue;
    const identity = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: {
        rootMediaId: input.mediaId,
        mediaId: input.mediaId,
        edition: "default",
      },
      access: input.access,
      budget: input.budget,
    });
    if (identity.status === "not_applicable")
      throw new Error("Movie retention recipient lost its movie authority");
    if (identity.status !== "authorized")
      throw new FileGuardError(identity.reason);
    guards.push(identity.freshness);
    userIds.add(request.userId);
  }
  return { guards, userIds };
}

async function assertHistoricalRecipientIdentities(
  tx: Transaction,
  input: AuthorizedMovieInput,
  choiceRecipients: ReadonlySet<string>,
) {
  // No-root owner consent retains its existing Network proof. Only actual
  // request roots are members of the already-held requester identity cohort.
  for (const requester of input.household.recipients) {
    if (
      choiceRecipients.has(requester.userId) ||
      !input.household.roots.some(
        (request) => request.userId === requester.userId,
      )
    )
      continue;
    const mapping = await tx.plexIdentityMapping.findUnique({
      where: { userId: requester.userId },
    });
    input.budget.consume(mapping === null ? 0 : 1);
    const verifiedAt = watchRequesterMappingVerification(
      { plexAccountId: requester.user.plexAccountId, plexIdentity: mapping },
      {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        kind: input.kind,
        now: new Date(),
      },
    );
    if (verifiedAt === null) throw new FileGuardError("watch_unconfirmed");
    // Legacy observations may have refreshed an older mapping with actual
    // Plex scope reads. Preserve that original bounded Network proof; no
    // choice or actor is synthesized for an historical observation recipient.
    input.plex?.freshness.assertActive();
  }
}
