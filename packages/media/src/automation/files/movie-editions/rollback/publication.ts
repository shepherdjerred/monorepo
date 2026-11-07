import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { recordedSubtitleDependencies } from "#automation/publication-proof/subtitle-lineage.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  readMovieRollbackIntentV1,
  movieRollbackPhysicalFromIntentV1,
} from "#infrastructure/movie-editions/rollback/records.ts";
import { captureAutomaticMovieRollbackAuthorityV1 } from "#infrastructure/movie-editions/rollback/authority.ts";
import { captureMovieRollbackBindingV1 } from "#infrastructure/movie-editions/rollback/binding.ts";
import { commitMovieRollbackPhysicalV1 } from "#infrastructure/movie-editions/rollback/commit.ts";
import { prepareMovieRollbackEffectsV1 } from "./effects.ts";
import { reserveMovieRollbackPhysicalSqlV1 } from "#infrastructure/movie-editions/rollback/read-budget.ts";
import {
  captureMovieRollbackHandoffExecutionV1,
  movieRollbackExecutionFreshnessV1,
  type MovieRollbackHandoffExecutionV1,
} from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

type Outcome = {
  status: "physically_rolled_back" | "blocked";
  reason: string | null;
};

/** Failed Plex upgrade only: restore actual A and retain rejected B. A successful
 * B serving receipt requires a different explicit manual command. */
export async function rollbackMoviePublicationV4(
  base: FileContext,
  raw: MovieAttemptOperationV4,
  takeover?: MovieRollbackHandoffExecutionV1,
): Promise<Outcome> {
  const execution = requirePublicationExecution(base.publicationExecution?.());
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const invocation = base.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const request = { mode: "automatic_failed_plex" as const, source: input };
  const initial = publicationInvocation(base, execution);
  const parent = await readMovieRollbackIntentV1(
    base.db,
    request,
    invocation.budget,
  );
  execution.assertActive();
  if (parent !== null && movieRollbackPhysicalFromIntentV1(parent) !== null)
    return { status: "physically_rolled_back", reason: null };
  try {
    if (parent === null)
      throw new FileGuardError("movie_rollback_admission_required");
    if (!(await base.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const access = requireMovieChoiceAccess(
      (await fileMovieAccess(base, [input.scope.mediaId])) ?? {},
    );
    const owner = base.movieRollbackExecution;
    const expectedOwner = takeover?.owner ?? parent.intent.owner;
    if (
      expectedOwner.workflowId !== owner?.workflowId ||
      expectedOwner.runId !== owner.runId
    )
      throw new FileGuardError("movie_rollback_previous_workflow_not_closed");
    const entry = parent.intent.source.reference.intent.entries[0].entry;
    const dependencies = recordedSubtitleDependencies(
      parent.intent.source.reference.intent,
    );
    const prepared = await prepareContentProof(initial, [
      ...publicationReferences([entry]),
      ...dependencies.references,
    ]);
    const context = {
      ...publicationInvocation(prepared, execution),
      publicationDependencies: dependencies,
    };
    const inverse = await prepareMovieRollbackEffectsV1(context, parent.intent);
    await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, input.scope);
        if (
          !(await lockRuntimeAuthority(
            tx,
            parent.intent.authority.recoveryEpoch,
          ))
        )
          throw new FileGuardError("runtime_protected");
        await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
        const current = await readMovieRollbackIntentV1(
          tx,
          request,
          invocation.budget,
        );
        if (current?.intentHash !== parent.intentHash)
          throw new FileGuardError("movie_rollback_admission_changed");
        if (movieRollbackPhysicalFromIntentV1(current) !== null) return;
        const authority = await captureAutomaticMovieRollbackAuthorityV1(tx, {
          context,
          source: input,
          access,
          assetIds: [parent.intent.predecessor.id, parent.intent.successor.id],
          birthEpoch: parent.intent.authority.recoveryEpoch,
          intent: parent.intent,
        });
        const handoff = await captureMovieRollbackHandoffExecutionV1(
          tx,
          current,
          {
            ...(takeover === undefined ? {} : { handoff: takeover }),
            invocation,
            access,
            phase: "physical",
          },
        );
        const freshness = movieRollbackExecutionFreshnessV1(
          invocation,
          authority.freshness,
          handoff,
        );
        if (handoff !== null) await bindPlexTransactionDeadline(tx, freshness);
        const binding = await captureMovieRollbackBindingV1(
          tx,
          parent.intent,
          invocation.budget,
        );
        if (handoff !== null)
          invocation.budget.consume(4 + (handoff.playback === null ? 0 : 1));
        reserveMovieRollbackPhysicalSqlV1(
          invocation.budget,
          authority.authority.identity.schemaVersion,
          parent.intent,
          handoff !== null,
        );
        const authorize = async () => {
          await context.checkpoint("movie-rollback-authorization");
          if (!(await context.enabled.acquisition()))
            throw new FileGuardError("acquisition_disabled");
          const configured = requireMovieChoiceAccess(
            (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
          );
          if (identityHash(configured) !== identityHash(access))
            throw new FileGuardError("wrong_section");
          freshness.assertActive();
        };
        await inverse.execute({
          authorize,
          assertActive: freshness.assertActive,
          commit: async (evidence) => {
            await authorize();
            await commitMovieRollbackPhysicalV1(tx, {
              context,
              intent: parent.intent,
              evidence,
              freshness,
              binding,
            });
          },
        });
        freshness.assertActive();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "physically_rolled_back", reason: null };
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof FileGuardError)) throw error;
    return { status: "blocked", reason: error.reason };
  }
}
