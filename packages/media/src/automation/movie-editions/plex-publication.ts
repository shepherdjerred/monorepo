import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { captureMoviePlexExpectedV2 } from "#infrastructure/movie-editions/plex/expected.ts";
import { commitMoviePlexV2 } from "#infrastructure/movie-editions/plex/commit.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexRead } from "#automation/publication/association/io.ts";
import { verifyMoviePlexV2 } from "./plex-verification.ts";

type Result = {
  status: "available" | "waiting" | "blocked" | "obsolete";
  reason: string | null;
};

/** Only verified scoped Parts/edition metadata may advance availability; Activity results contain no private metadata. */
export async function publishMoviePlexV4(
  context: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
  execution: PlexBindingExecution,
): Promise<Result> {
  execution.assertActive();
  execution.signal.throwIfAborted();
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const prior = await readMoviePlexReceiptV2(context.db, input, budget);
  execution.assertActive();
  execution.signal.throwIfAborted();
  if (prior !== null) return { status: "available", reason: null };
  const invocation = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  try {
    if (!(await context.gates.acquisition()))
      return { status: "blocked", reason: "acquisition_disabled" };
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    const prepared = await context.db.$transaction((tx) =>
      captureMoviePlexExpectedV2(tx, input, access, budget),
    );
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(
        invocation.expiresAtMs,
        prepared.authority.freshness.expiresAtMs,
        prepared.leaseExpiresAtMs,
      ),
      guards: [invocation, prepared.authority.freshness],
    });
    await plexRead(
      { plex: context.plex, execution, freshness },
      () => context.plex.refresh(access.movieSectionId, execution.signal),
      "wrong_section",
    );
    const verified = await verifyMoviePlexV2(
      context,
      {
        purpose: "current_serving",
        expected: prepared.expected,
        canonicalTargets: prepared.canonicalTargets,
        access: prepared.expected.access,
        observed: execution.observed,
        expiresAtMs: freshness.expiresAtMs,
        guards: [freshness],
      },
      execution,
    );
    if ("status" in verified)
      return { status: "waiting", reason: verified.reason };
    const currentAccess = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (identityHash(currentAccess) !== identityHash(access))
      throw new PlexBindingProtection("wrong_section");
    await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, input.scope);
        const completed = await readMoviePlexReceiptV2(tx, input, budget);
        if (completed !== null) return;
        if (!(await context.gates.acquisition()))
          throw new PlexBindingProtection("scope_changed");
        await commitMoviePlexV2(
          tx,
          {
            input,
            access,
            expected: prepared.expected,
            verified,
            observed: execution.observed,
          },
          budget,
        );
        verified.freshness.assertActive();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "available", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      !(error instanceof PlexBindingProtection) &&
      !(error instanceof MovieChoiceProtection)
    )
      throw error;
    const completed = await readMoviePlexReceiptV2(context.db, input, budget);
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (completed !== null) return { status: "available", reason: null };
    return {
      status:
        error instanceof MovieChoiceProtection ||
        error.reason === "scope_changed" ||
        error.reason === "ownership_changed"
          ? "obsolete"
          : "waiting",
      reason:
        error instanceof MovieChoiceProtection ? error.code : error.reason,
    };
  }
}
