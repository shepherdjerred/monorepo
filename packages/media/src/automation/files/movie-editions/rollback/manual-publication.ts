import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieRollbackOperationV1Schema,
  type MovieRollbackOperationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import { MovieRollbackCaptionOutcomeV1Schema } from "#shared/movie-editions/rollback/captions.ts";
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
import { readRequestedMovieRollbackCommandV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command-records.ts";
import {
  readMovieRollbackIntentV1,
  movieRollbackPhysicalFromIntentV1,
} from "#infrastructure/movie-editions/rollback/records.ts";
import { captureRequestedMovieRollbackFilesAuthorityV1 } from "#infrastructure/movie-editions/rollback/manual/manual-authority.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { captureMovieRollbackBindingV1 } from "#infrastructure/movie-editions/rollback/binding.ts";
import { commitMovieRollbackPhysicalV1 } from "#infrastructure/movie-editions/rollback/commit.ts";
import { prepareMovieRollbackCaptionEffectsV1 } from "./caption-effects.ts";
import { prepareMovieRollbackEffectsV1 } from "./effects.ts";
import { reserveRequestedMovieRollbackPhysicalSqlV1 } from "#infrastructure/movie-editions/rollback/manual/manual-read-budget.ts";
import {
  captureMovieRollbackHandoffExecutionV1,
  movieRollbackExecutionFreshnessV1,
  type MovieRollbackHandoffExecutionV1,
} from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

/** A separate real owner command executes the original committed inverse only
 * after every admitted B-owned caption has its actual quarantine ACK chain. */
export async function rollbackRequestedMoviePublicationV1(
  base: FileContext,
  raw: MovieRollbackOperationV1,
  takeover?: MovieRollbackHandoffExecutionV1,
): Promise<{
  status: "physically_rolled_back" | "blocked";
  reason: string | null;
}> {
  const execution = requirePublicationExecution(base.publicationExecution?.());
  const input = MovieRollbackOperationV1Schema.parse(raw);
  const initial = publicationInvocation(base, execution);
  const invocation = initial.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const command = await readRequestedMovieRollbackCommandV1(
    base.db,
    input,
    invocation.budget,
  );
  const request = {
    mode: "manual_verified" as const,
    command: input,
    source: command.source,
  };
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
      owner?.workflowId !== expectedOwner.workflowId ||
      owner.runId !== expectedOwner.runId
    )
      throw new FileGuardError("movie_rollback_previous_workflow_not_closed");
    const manifest = parent.intent.captionManifest;
    if (manifest === undefined)
      throw new FileGuardError(
        "movie_rollback_manual_caption_manifest_missing",
      );
    const dependencies = recordedSubtitleDependencies(
      parent.intent.source.reference.intent,
    );
    const captionRefs = manifest.captions.flatMap((caption) => [
      {
        libraryKind: "movies" as const,
        root: "library" as const,
        path: caption.source.path,
      },
      {
        libraryKind: "movies" as const,
        root: "control" as const,
        path: caption.target.path,
      },
    ]);
    const entry = parent.intent.source.reference.intent.entries[0].entry;
    const prepared = await prepareContentProof(initial, [
      ...publicationReferences([entry]),
      ...dependencies.references,
      ...captionRefs,
    ]);
    const context = {
      ...publicationInvocation(prepared, execution),
      publicationDependencies: {
        references: [...dependencies.references, ...captionRefs],
        operations: [
          ...dependencies.operations,
          ...manifest.captions.map((caption) => ({
            kind: "movies" as const,
            id: caption.operationId,
          })),
        ],
      },
    };
    const captions = await prepareMovieRollbackCaptionEffectsV1(
      context,
      parent.intent,
      execution.assertActive,
    );
    const inverse = await prepareMovieRollbackEffectsV1(
      context,
      parent.intent,
      captions ?? undefined,
    );
    await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, input.scope);
        await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${input.operationId} FOR UPDATE`;
        const current = await readMovieRollbackIntentV1(
          tx,
          request,
          invocation.budget,
        );
        if (current?.intentHash !== parent.intentHash)
          throw new FileGuardError("movie_rollback_admission_changed");
        if (movieRollbackPhysicalFromIntentV1(current) !== null) return;
        const currentCommand = await readRequestedMovieRollbackCommandV1(
          tx,
          input,
          invocation.budget,
        );
        const authority = await captureRequestedMovieRollbackFilesAuthorityV1(
          tx,
          { context, command: currentCommand, access, intent: parent.intent },
        );
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
        const predecessor = await snapshotMoviePublicationAssetV2(
          tx,
          input.scope,
          parent.intent.predecessor.id,
          invocation.budget,
        );
        const successor = await snapshotMoviePublicationAssetV2(
          tx,
          input.scope,
          parent.intent.successor.id,
          invocation.budget,
        );
        if (
          identityHash(predecessor) !==
            identityHash(parent.intent.predecessor) ||
          identityHash(successor) !== identityHash(parent.intent.successor)
        )
          throw new FileGuardError("movie_rollback_pair_changed");
        const binding = await captureMovieRollbackBindingV1(
          tx,
          parent.intent,
          invocation.budget,
        );
        if (handoff !== null) invocation.budget.consume(4);
        reserveRequestedMovieRollbackPhysicalSqlV1(
          invocation.budget,
          parent.intent,
        );
        const authorize = async () => {
          await context.checkpoint("requested-movie-rollback-authorization");
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
            let successorCaptions = evidence.successorCaptions;
            if (captions === null) {
              if (manifest.captions.length > 0)
                throw new Error(
                  "Nonempty caption manifest lost its mechanical executor",
                );
              successorCaptions = MovieRollbackCaptionOutcomeV1Schema.parse({
                schemaVersion: 1,
                manifestHash: identityHash(manifest),
                effects: [],
                targets: [],
                closedSources: [],
                journals: [],
              });
            }
            if (successorCaptions === undefined)
              throw new Error(
                "Manual caption executor lost its actual complete outcome",
              );
            await commitMovieRollbackPhysicalV1(tx, {
              context,
              intent: parent.intent,
              evidence: { ...evidence, successorCaptions },
              manualPlayback: authority.playback,
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
    if (error instanceof MediaError)
      return { status: "blocked", reason: error.code };
    if (!(error instanceof FileGuardError)) throw error;
    return { status: "blocked", reason: error.reason };
  }
}
