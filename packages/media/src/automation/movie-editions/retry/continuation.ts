import type { Operation } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieRetryRenewalV2Schema,
  type MovieRetryCaptureV2,
} from "#shared/movie-editions/retry/v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { readMoviePreparedRetrySourceV2 } from "#infrastructure/movie-editions/lifecycle/retry/retry-continuation-source.ts";
import { movieRetryAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/retry/retry-authority.ts";
import {
  commitMovieRetryRenewalV2,
  readMovieRetryRenewalV2,
} from "#infrastructure/movie-editions/lifecycle/retry/retry-continuation-commit.ts";
import { readMovieContinuationHistoryV2 } from "#infrastructure/movie-editions/lifecycle/retry/retry-continuation-history.ts";
import { resumeMovieAttempt } from "./resume.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { serializable } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { movieRetryTerminalV1 } from "#automation/movie-editions/retry/terminal.ts";
import { movieRetryTorrentV1 } from "#automation/movie-editions/retry/torrent.ts";
import { MediaError } from "#application/errors.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";

/** Explicit prepared/imported continuation preserves its actual plan and original physical publication history. */
export async function reconcileMovieContinuationV2(
  context: MediaAutomationContext,
  input: {
    command: MovieOperationV4;
    operation: Operation;
    capture: MovieRetryCaptureV2;
  },
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie continuation requires its original invocation capability",
    );
  const { budget, execution } = invocation;
  execution.assertActive();
  const completed = readMovieRetryRenewalV2(
    input.operation.result,
    input.command,
  );
  if (completed !== null) {
    if (identityHash(completed.capture) !== identityHash(input.capture))
      throw new Error(
        "Movie continuation renewal changed its original phase selection",
      );
    const attempt = await readMovieContinuationHistoryV2(
      context.db,
      { receipt: completed, operation: input.operation },
      budget,
    );
    return resumeMovieAttempt(context, input.command, attempt, budget);
  }
  const observed = await readMoviePreparedRetrySourceV2(
    context.db,
    {
      attemptId: input.capture.attemptId,
      scope: input.command.scope,
      mode: input.capture.mode,
    },
    budget,
  );
  if (
    observed.kind !== "continuation" ||
    identityHash(observed.capture) !== identityHash(input.capture)
  )
    throw new MediaError(
      "movie_retry_authority_changed",
      "Actual prepared movie phase changed before continuation",
      409,
    );
  const terminal = await movieRetryTerminalV1(
    context,
    {
      attemptId: input.capture.attemptId,
      previousCoordinatorOperationId:
        input.capture.previousCoordinatorOperationId,
      reservedWithoutTorrent: false,
    },
    execution,
  );
  if (terminal === null)
    return {
      status: "waiting" as const,
      attemptId: null,
      reason: "movie_retry_previous_workflow_not_closed",
    };
  const transfer =
    observed.capture.continuation.phase === "prepared"
      ? {
          kind: "live_observation" as const,
          observation: await movieRetryTorrentV1(context, {
            ...observed.source,
            state: observed.source.attempt.state,
          }),
        }
      : recordedTransfer(observed.source);
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.command.mediaId])) ?? {},
  );
  await serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, input.command.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.command.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, input.capture.recoveryEpoch)))
      throw new MediaError(
        "intent_ownership_unconfirmed",
        "Original movie recovery epoch changed",
        409,
      );
    await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${input.capture.attemptId} FOR UPDATE`;
    const current = await readMoviePreparedRetrySourceV2(
      tx,
      {
        attemptId: input.capture.attemptId,
        scope: input.command.scope,
        mode: input.capture.mode,
      },
      budget,
    );
    if (
      current.kind !== "continuation" ||
      identityHash(current.capture) !== identityHash(input.capture) ||
      identityHash(nativeJson(current.source.attempt.torrent)) !==
        identityHash(nativeJson(observed.source.attempt.torrent))
    )
      throw new MediaError(
        "movie_retry_authority_changed",
        "Actual prepared movie parents changed during observation",
        409,
      );
    const authority = await movieRetryAuthorityV4(tx, {
      scope: input.command.scope,
      source: current.source,
      access,
      invocation,
      budget,
    });
    const writer = await tx.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(
        execution.expiresAtMs,
        writer.expiresAt.getTime(),
        authority.expiresAtMs,
      ),
      guards: [execution, authority],
    });
    const configured = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.command.mediaId])) ?? {},
    );
    freshness.assertActive();
    if (identityHash(configured) !== identityHash(access))
      throw new MediaError(
        "plex_scope_unconfigured",
        "Movie retry configured library changed",
        409,
      );
    const receipt = MovieRetryRenewalV2Schema.parse({
      schemaVersion: 2,
      scope: input.command.scope,
      input: input.command,
      capture: input.capture,
      beforeAttempt: nativeAttempt(current.source.attempt),
      commandHash: identityHash(input.operation.payload),
      previousCommandHash: identityHash(current.source.operation.payload),
      ...terminal,
      previousState: current.source.attempt.state,
      transfer,
      observedAt: new Date(execution.observed.wall).toISOString(),
      sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
      expiresAt: new Date(freshness.expiresAtMs).toISOString(),
      committedAt: new Date().toISOString(),
    });
    await commitMovieRetryRenewalV2(
      tx,
      { receipt, attempt: current.source.attempt },
      freshness,
    );
  });
  execution.assertActive();
  return {
    status: "acquire" as const,
    attemptId: input.capture.attemptId,
    reason: "resume_prepared_movie_acquisition",
  };
}

function recordedTransfer(
  source: Awaited<ReturnType<typeof readMoviePreparedRetrySourceV2>>["source"],
) {
  const torrent = source.attempt.torrent;
  const original = CandidateSourceEvidenceSchema.parse(
    source.recorded.release.sourceEvidence,
  );
  if (
    torrent === null ||
    !torrent.owned ||
    torrent.infoHash !== original.infoHash ||
    torrent.ownershipEpoch !== source.attempt.recoveryEpoch ||
    torrent.providerId !== source.recorded.release.providerId
  )
    throw new MediaError(
      "movie_retry_torrent_unconfirmed",
      "Imported movie publication lost its actual Media-created transfer parent",
      409,
    );
  return {
    kind: "physical_publication" as const,
    id: torrent.id,
    infoHash: torrent.infoHash,
    providerId: torrent.providerId,
    ownershipEpoch: torrent.ownershipEpoch,
    policyHash: identityHash(torrent.seedingPolicy),
  };
}
