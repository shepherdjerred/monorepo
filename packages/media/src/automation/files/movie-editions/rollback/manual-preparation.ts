import { Prisma } from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieRollbackOperationV1Schema,
  type MovieRollbackOperationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { readRequestedMovieRollbackCommandV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command-records.ts";
import { captureRequestedMovieRollbackContextV1 } from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";
import { captureRequestedMovieRollbackFilesAuthorityV1 } from "#infrastructure/movie-editions/rollback/manual/manual-authority.ts";
import { admitRequestedMovieRollbackV1 } from "#infrastructure/movie-editions/rollback/manual/manual-admission.ts";
import { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { captureRequestedMovieRollbackCaptionParentV1 } from "#infrastructure/movie-editions/rollback/manual/manual-caption-parents.ts";
import {
  movieRollbackCaptionReferencesV1,
  captureMovieRollbackCaptionManifestV1,
} from "./caption-manifest.ts";

/** Owner admission is durable before the first inverse syscall. Reversible
 * pre-hashing is bounded by this same Activity's original SDK/read capability. */
export async function prepareRequestedMovieRollbackV1(
  base: FileContext,
  raw: MovieRollbackOperationV1,
): Promise<{ status: "prepared" | "blocked"; reason: string | null }> {
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
  const historical = await readMovieRollbackIntentV1(
    base.db,
    { mode: "manual_verified", command: input, source: command.source },
    invocation.budget,
  );
  execution.assertActive();
  if (historical !== null) return { status: "prepared", reason: null };
  try {
    if (!(await base.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const access = requireMovieChoiceAccess(
      (await fileMovieAccess(base, [input.scope.mediaId])) ?? {},
    );
    const successor = await snapshotMoviePublicationAssetV2(
      base.db,
      input.scope,
      command.expected.successor.id,
      invocation.budget,
    );
    if (
      successor.version !== command.expected.successor.version ||
      successor.checksum !== command.expected.successor.checksum
    )
      throw new FileGuardError("movie_rollback_pair_changed");
    const admissionId = crypto.randomUUID();
    const selected = movieRollbackCaptionReferencesV1(
      initial,
      admissionId,
      successor,
    );
    const refs = selected.flatMap((caption) => [
      {
        libraryKind: "movies" as const,
        root: "library" as const,
        path: caption.source,
      },
      {
        libraryKind: "movies" as const,
        root: "control" as const,
        path: caption.target,
      },
    ]);
    const context = publicationInvocation(
      await prepareContentProof(initial, refs),
      execution,
    );
    await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, input.scope);
        await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${input.operationId} FOR UPDATE`;
        const currentCommand = await readRequestedMovieRollbackCommandV1(
          tx,
          input,
          invocation.budget,
        );
        if (
          identityHash(command.payload) !== identityHash(currentCommand.payload)
        )
          throw new FileGuardError("movie_rollback_command_changed");
        const authority = await captureRequestedMovieRollbackFilesAuthorityV1(
          tx,
          { context, command: currentCommand, access },
        );
        const captured = await captureRequestedMovieRollbackContextV1(tx, {
          actorId: command.payload.actorId,
          scope: input.scope,
          sourceAttemptId: input.sourceAttemptId,
          access,
          invocation: { ...invocation, execution },
        });
        if (identityHash(captured.successor) !== identityHash(successor))
          throw new FileGuardError("movie_rollback_pair_changed");
        const baseline = captured.published.outcome?.entries[0].successor;
        if (baseline === null || baseline === undefined)
          throw new Error(
            "Manual rollback lost its literal committed B baseline",
          );
        const parents = new Map<
          string,
          Awaited<
            ReturnType<typeof captureRequestedMovieRollbackCaptionParentV1>
          >
        >();
        for (const caption of selected)
          parents.set(
            caption.snapshot.id,
            await captureRequestedMovieRollbackCaptionParentV1(
              tx,
              {
                scope: input.scope,
                caption: caption.snapshot,
                baseline,
                publication: captured.publication,
              },
              invocation.budget,
            ),
          );
        const proof = context.contentProof;
        if (proof === undefined)
          throw new FileGuardError(
            "movie_rollback_caption_content_proof_missing",
          );
        const files = new FileOperations(context.roots.movies, {
          authorize: () => {
            authority.freshness.assertActive();
            return Promise.resolve();
          },
          contentProof: proof,
          ...(context.verifyPlexExclusion === undefined
            ? {}
            : { verifyPlexExclusion: context.verifyPlexExclusion }),
        });
        await files.withContentPaths(
          refs.map(({ root, path }) => ({ root, path })),
          async () => {
            authority.freshness.assertActive();
            if (!(await context.enabled.acquisition()))
              throw new FileGuardError("acquisition_disabled");
            const configured = requireMovieChoiceAccess(
              (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
            );
            if (identityHash(configured) !== identityHash(access))
              throw new FileGuardError("wrong_section");
            const captions = await captureMovieRollbackCaptionManifestV1(
              context,
              { admissionId, scope: input.scope, successor, parents },
            );
            await admitRequestedMovieRollbackV1(tx, {
              context,
              command: currentCommand,
              captured,
              authority,
              access,
              captions,
            });
          },
          selected.map((caption) => caption.operationId),
        );
        authority.freshness.assertActive();
      },
      {
        timeout: 30_000,
        maxWait: 30_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
    execution.assertActive();
    return { status: "prepared", reason: null };
  } catch (error) {
    execution.assertActive();
    if (error instanceof MediaError)
      return { status: "blocked", reason: error.code };
    if (!(error instanceof FileGuardError)) throw error;
    return { status: "blocked", reason: error.reason };
  }
}
