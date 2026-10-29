import type { FileContext, Transaction } from "#automation/files/types.ts";
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
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
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
import {
  authorizeMovieFilesV4,
  assertMovieFilePlanV4,
  MovieTorrentObservationSchema,
  type MovieFileAuthorityV4,
} from "./authority.ts";
import { captureMoviePublicationV2 } from "./publication-intent.ts";
import { prepareMoviePublicationContentV2 } from "./publication-content.ts";
import { compensateMoviePublicationV2 } from "./publication-compensation.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import {
  matchesMovieDefinition,
  movieDefinitionRef,
} from "#infrastructure/movie-editions/definition.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Edition scope is explicit throughout the actual WAL/filesystem producer; original v1 histories remain v1. */
export async function promoteMovieV4(
  initial: FileContext,
  raw: MovieAttemptOperationV4,
): Promise<void> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const budget =
    initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget();
  const invocation = {
    ...publicationInvocation(initial, execution),
    movieManagement: { execution, budget },
  };
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
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
  const locked = new WeakMap<
    Transaction,
    { authority: MovieFileAuthorityV4; assertActive: () => void }
  >();
  const assertHeldAuthority = async (tx: Transaction) => {
    const held = locked.get(tx);
    if (held === undefined)
      throw new Error("Movie publication has no transaction-held authority");
    await context.checkpoint("publication-authorization");
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const configured = requireMovieChoiceAccess(
      (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (hash(configured) !== hash(access))
      throw new FileGuardError("wrong_section");
    held.assertActive();
    return held;
  };
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
          // Freeze the mutable torrent observation for this transaction too;
          // canonical/target/request/runtime/profile/identity locks are held above.
          const torrentId = authority.attempt.torrentId;
          if (torrentId === null) throw new FileGuardError("torrent_unowned");
          await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${torrentId} FOR SHARE`;
          await tx.$queryRaw`SELECT "rootMediaId",key FROM "MediaEditionDefinition" WHERE "rootMediaId"=${input.scope.rootMediaId} AND key=${input.scope.edition} FOR SHARE`;
          const definition = await tx.mediaEditionDefinition.findUniqueOrThrow({
            where: {
              rootMediaId_key: {
                rootMediaId: input.scope.rootMediaId,
                key: input.scope.edition,
              },
            },
          });
          budget.consume(1);
          if (
            !matchesMovieDefinition(
              definition,
              movieDefinitionRef(input.scope.rootMediaId, input.scope.edition)
                .definition,
            )
          )
            throw new FileGuardError("edition_definition_conflict");
          const torrent = await tx.torrent.findUniqueOrThrow({
            where: { id: torrentId },
          });
          budget.consume(1);
          if (
            !torrent.owned ||
            torrent.ownershipEpoch !== authority.attempt.recoveryEpoch
          )
            throw new FileGuardError("torrent_unowned");
          const heldAuthority = {
            ...authority,
            attempt: { ...authority.attempt, torrent },
            observation: MovieTorrentObservationSchema.parse(
              torrent.observation,
            ),
          };
          await assertMovieFilePlanV4(tx, context, heldAuthority, plan);
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
          locked.set(tx, {
            authority: heldAuthority,
            assertActive: freshness.assertActive,
          });
          return freshness.assertActive;
        },
        authorizeEntry: async (tx) => {
          await assertHeldAuthority(tx);
        },
        authorizeLockedPlan: async (tx) => {
          const held = await assertHeldAuthority(tx);
          await assertMovieFilePlanV4(tx, context, held.authority, plan);
          held.assertActive();
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
