import { z } from "zod";
import type { Operation } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import type { MovieNetworkActivitiesV4 } from "#shared/movie-editions/activities-v4.ts";
import {
  MovieRetryCaptureV1Schema,
  MovieRetryRenewalV1Schema,
  type MovieRetryCaptureV1,
} from "#shared/movie-editions/retry/v1.ts";
import { MediaError } from "#application/errors.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { serializable } from "#automation/store.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import {
  readMovieRetrySourceV4,
  captureMovieRetryV1,
  movieRetryBirthHash,
} from "#infrastructure/movie-editions/lifecycle/retry-source.ts";
import { movieRetryAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/retry-authority.ts";
import {
  commitMovieRetryRenewalV1,
  readMovieRetryRenewalV1,
} from "#infrastructure/movie-editions/lifecycle/retry-commit.ts";
import { movieRetryTerminalV1 } from "./terminal.ts";
import { movieRetryTorrentV1 } from "./torrent.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
import { resumeMovieAttempt } from "./resume.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

export function readMovieRetryCaptureV1(raw: unknown) {
  const header = z.object({ movieRetryV1: z.unknown().optional() }).parse(raw);
  return header.movieRetryV1 === undefined
    ? null
    : MovieRetryCaptureV1Schema.parse(header.movieRetryV1);
}

type Input = {
  command: MovieOperationV4;
  operation: Operation;
  capture: MovieRetryCaptureV1;
};

/** A new coordinator can only continue its exact original acquisition after both actual predecessors are closed. */
export async function reconcileMovieRetryV4(
  context: MediaAutomationContext,
  input: Input,
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie retry requires its original invocation capability and budget",
    );
  const execution = invocation.execution;
  execution.assertActive();
  assertRetryCommand(input);
  const completed = readMovieRetryRenewalV1(
    input.operation.result,
    input.command,
  );
  if (completed !== null) {
    if (
      completed.commandHash !== identityHash(input.operation.payload) ||
      identityHash(completed.capture) !== identityHash(input.capture)
    )
      throw new Error(
        "Movie retry renewal lost its immutable coordinator selection",
      );
    const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.capture.attemptId },
    });
    invocation.budget.consume(1);
    if (movieRetryBirthHash(attempt) !== input.capture.birthHash)
      throw new Error(
        "Movie retry renewal changed its original acquisition birth",
      );
    return resumeMovieAttempt(
      context,
      input.command,
      attempt,
      invocation.budget,
    );
  }
  try {
    let source = await readMovieRetrySourceV4(
      context.db,
      { attemptId: input.capture.attemptId, scope: input.command.scope },
      invocation.budget,
    );
    assertRetryCapture(source, input.capture);
    const terminal = await movieRetryTerminalV1(
      context,
      {
        attemptId: source.attempt.id,
        previousCoordinatorOperationId: source.operation.id,
        reservedWithoutTorrent:
          source.state === "reserved" && source.attempt.torrent === null,
      },
      execution,
    );
    if (terminal === null)
      return {
        status: "waiting",
        attemptId: null,
        reason: "movie_retry_previous_workflow_not_closed",
      };
    if (["submitting", "submission_unknown"].includes(source.state)) {
      const observed = await submitMovieTorrentV4(context, {
        schemaVersion: 4,
        operationId: source.operation.id,
        attemptId: source.attempt.id,
        scope: input.command.scope,
      });
      execution.assertActive();
      if (observed.status !== "submitted")
        return { status: "blocked", attemptId: null, reason: observed.reason };
      source = await readMovieRetrySourceV4(
        context.db,
        { attemptId: source.attempt.id, scope: input.command.scope },
        invocation.budget,
      );
      assertRetryCapture(source, input.capture);
    }
    const torrent = await movieRetryTorrentV1(context, source);
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.command.mediaId])) ?? {},
    );
    execution.assertActive();
    await serializable(context.db, async (tx) => {
      await lockMovieCommand(tx, input.command.scope);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: [input.command.mediaId],
      });
      if (!(await lockRuntimeAuthority(tx, source.attempt.recoveryEpoch)))
        throw new MediaError(
          "intent_ownership_unconfirmed",
          "Movie retry recovery epoch is no longer active",
          409,
        );
      await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${source.attempt.id} FOR UPDATE`;
      const current = await readMovieRetrySourceV4(
        tx,
        { attemptId: source.attempt.id, scope: input.command.scope },
        invocation.budget,
      );
      assertRetryCapture(current, input.capture);
      if (
        identityHash(nativeJson(current.attempt.torrent)) !==
        identityHash(nativeJson(source.attempt.torrent))
      )
        throw new MediaError(
          "movie_retry_torrent_unconfirmed",
          "Movie retry transfer changed during observation",
          409,
        );
      const authority = await movieRetryAuthorityV4(tx, {
        scope: input.command.scope,
        source: current,
        access,
        invocation,
        budget: invocation.budget,
      });
      const lease = await tx.legacyWriterLease.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          execution.expiresAtMs,
          lease.expiresAt.getTime(),
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
      const receipt = MovieRetryRenewalV1Schema.parse({
        schemaVersion: 1,
        scope: input.command.scope,
        input: input.command,
        capture: input.capture,
        commandHash: identityHash(input.operation.payload),
        previousCommandHash: identityHash(current.operation.payload),
        ...terminal,
        previousState: current.state,
        torrent,
        observedAt: new Date(execution.observed.wall).toISOString(),
        sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        committedAt: new Date().toISOString(),
      });
      await commitMovieRetryRenewalV1(tx, receipt, freshness);
    });
    execution.assertActive();
    return {
      status: "acquire",
      attemptId: source.attempt.id,
      reason: "resume_existing_acquisition",
    };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (!(error instanceof MediaError)) throw error;
    return { status: "blocked", attemptId: null, reason: error.code };
  }
}

function assertRetryCommand(input: Input) {
  const selected = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(input.operation.payload),
  );
  const { recoveryEpoch: epoch, kind } = z
    .object({ recoveryEpoch: z.int().nonnegative(), kind: z.string() })
    .parse(input.operation.payload);
  if (
    input.operation.id !== selected.operationId ||
    input.operation.kind !== "reconcile_movie_edition_v4" ||
    kind !== input.operation.kind ||
    input.operation.targetId !== selected.mediaId ||
    input.capture.generation !== selected.generation ||
    epoch !== input.capture.recoveryEpoch
  )
    throw new Error(
      "Movie retry command differs from its captured exact coordinator scope",
    );
  if (identityHash(selected) !== identityHash(input.command))
    throw new MediaError(
      "identity_scope_changed",
      "Movie retry input differs from its actual recorded coordinator",
      409,
    );
}

function assertRetryCapture(
  source: Awaited<ReturnType<typeof readMovieRetrySourceV4>>,
  capture: MovieRetryCaptureV1,
) {
  if (
    identityHash(captureMovieRetryV1(source, capture.mode)) !==
    identityHash(capture)
  )
    throw new MediaError(
      "movie_retry_authority_changed",
      "Original movie retry acquisition or coordinator changed",
      409,
    );
}
