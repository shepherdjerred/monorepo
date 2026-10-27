import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  createMoviePublicationV2,
  commitMoviePublicationOutcomeV2,
} from "#infrastructure/movie-editions/publication/store.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieFilePlanV2Schema } from "#shared/movie-editions/file-plan-v2.ts";
import { MoviePublicationOutcomeV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { producePublicationWithProtocol } from "#automation/publication-proof/producer.ts";
import { commitPublication } from "#automation/files/publication.ts";
import { commitEmbedded } from "#automation/files/embedded.ts";
import { authorizeMovieFilesV4, assertMovieFilePlanV4 } from "./authority.ts";
import { captureMoviePublicationV2 } from "./publication-intent.ts";
import { prepareMoviePublicationContentV2 } from "./publication-content.ts";
import { compensateMoviePublicationV2 } from "./publication-compensation.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Edition scope is explicit throughout the actual WAL/filesystem producer; original v1 histories remain v1. */
export async function promoteMovieV4(
  initial: FileContext,
  raw: MovieAttemptOperationV4,
): Promise<void> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const invocation = publicationInvocation(initial, execution);
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const plan = MovieFilePlanV2Schema.parse(attempt.filePlan);
  if (
    attempt.coordinatorOperationId !== input.operationId ||
    plan.attemptId !== attempt.id ||
    hash(plan.scope) !== hash(input.scope)
  )
    throw new FileGuardError("movie_publication_scope_changed");
  const existing = await loadMoviePublicationV2(initial.db, attempt.id, budget);
  if (existing !== null && existing.outcome !== null) {
    if (existing.outcome.kind !== "published")
      throw new FileGuardError("movie_publication_compensated");
    // Literal completed retry acknowledges history only; it grants no new filesystem or Plex effect.
    return;
  }
  const access = requireMovieChoiceAccess(
    (await fileMovieAccess(invocation, [input.scope.mediaId])) ?? {},
  );
  const context = await prepareMoviePublicationContentV2(
    invocation,
    plan,
    existing?.reference ?? null,
    budget,
  );
  try {
    await producePublicationWithProtocol(
      {
        context,
        attempt,
        plan: plan.entries,
        rawFilePlanHash: hash(attempt.filePlan),
        authorizePlan: async (tx) => {
          await context.checkpoint("publication-authorization");
          const authority = await authorizeMovieFilesV4(
            tx,
            context,
            input,
            access,
          );
          await assertMovieFilePlanV4(tx, context, authority, plan);
          const physical = await publicationAuthorityDeadline(tx, context, {
            libraryKind: "movies",
            recoveryEpoch: attempt.recoveryEpoch,
          });
          const freshness = {
            expiresAtMs: Math.min(
              physical.expiresAtMs,
              authority.freshness.expiresAtMs,
            ),
            assertActive: () => {
              execution.assertActive();
              physical.assertActive();
              authority.freshness.assertActive();
            },
          };
          await bindPlexTransactionDeadline(tx, freshness);
          return freshness.assertActive;
        },
        authorizeEntry: async (tx) => {
          const authority = await authorizeMovieFilesV4(
            tx,
            context,
            input,
            access,
          );
          await assertMovieFilePlanV4(tx, context, authority, plan);
        },
        commit: async (tx, entry) => {
          await commitPublication({
            tx,
            context,
            entry,
            torrentId: attempt.torrentId,
            recoveryEpoch: attempt.recoveryEpoch,
            movieScope: plan.scope,
          });
          await commitEmbedded({
            tx,
            context,
            entry,
            recoveryEpoch: attempt.recoveryEpoch,
            movieScope: plan.scope,
          });
        },
      },
      {
        lockScope: async (tx) => {
          await lockMovieCommand(tx, input.scope);
        },
        load: async (tx, id) => {
          const stored = await loadMoviePublicationV2(tx, id, budget);
          return stored?.reference ?? null;
        },
        capture: async (tx, current, transitionId) =>
          createMoviePublicationV2(
            tx,
            await captureMoviePublicationV2(
              tx,
              {
                context,
                attempt: current,
                plan,
                transitionId,
                rawFilePlanHash: hash(attempt.filePlan),
              },
              budget,
            ),
            budget,
          ),
        snapshot: (tx, id) =>
          snapshotMoviePublicationAssetV2(tx, plan.scope, id, budget),
        complete: async (tx, reference, outcome) => {
          await commitMoviePublicationOutcomeV2(
            tx,
            {
              reference,
              outcome: MoviePublicationOutcomeV2Schema.parse({
                schemaVersion: 2,
                scope: plan.scope,
                ...outcome,
              }),
            },
            budget,
          );
        },
      },
    );
  } catch (error) {
    if (
      error instanceof MovieChoiceProtection ||
      (error instanceof FileGuardError && error.reason.includes("obsolete"))
    )
      await compensateMoviePublicationV2(context, plan, budget);
    throw error;
  }
}
