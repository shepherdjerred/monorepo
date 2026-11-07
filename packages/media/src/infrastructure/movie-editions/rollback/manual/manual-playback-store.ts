import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieRollbackPlaybackV1Schema } from "#shared/movie-editions/rollback/playback.ts";
import { MovieServingPlexV2Schema } from "#shared/movie-editions/plex-v2.ts";
import type { VerifiedMovieServingPlexV2 } from "#shared/movie-editions/plex-v2.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { movieRollbackTransactionId } from "#infrastructure/movie-editions/rollback/transaction.ts";
import type { captureRequestedMovieRollbackPlaybackV1 } from "./manual-playback-context.ts";

type Captured = Extract<
  Awaited<ReturnType<typeof captureRequestedMovieRollbackPlaybackV1>>,
  { status: "captured" }
>;

/** The commit transaction freshly recaptures the same current facts. Its
 * immutable event remains available after the mutable next-phase pointer moves. */
export async function commitRequestedMovieRollbackPlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    prepared: Captured;
    current: Captured;
    verified: VerifiedMovieServingPlexV2 | null;
    sessions: { active: boolean; checkedAt: string | null };
    invocation: MovieManagementInvocation;
  },
) {
  const { prepared, current, invocation, sessions } = input;
  prepared.freshness.assertActive();
  current.freshness.assertActive();
  if (sessions.active || sessions.checkedAt === null)
    throw new FileGuardError("active_playback");
  if (
    identityHash(playbackCapture(prepared)) !==
    identityHash(playbackCapture(current))
  )
    throw new FileGuardError("movie_rollback_review_changed");
  const observation = playbackObservation(input.verified);
  if (current.phase === "admission") {
    if (
      observation === null ||
      identityHash(observation.associations[0]) !==
        identityHash(current.association)
    )
      throw new FileGuardError("movie_rollback_binding_changed");
    input.verified?.freshness.assertActive();
  } else if (observation !== null)
    throw new Error(
      "Admitted rollback playback cannot claim unobserved current bytes",
    );
  const expiresAtMs = Math.min(
    prepared.freshness.expiresAtMs,
    current.freshness.expiresAtMs,
    input.verified?.freshness.expiresAtMs ?? Number.POSITIVE_INFINITY,
  );
  const guard = MovieRollbackPlaybackV1Schema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    transactionId: await movieRollbackTransactionId(tx),
    input: {
      schemaVersion: 1,
      operationId: current.command.operation.id,
      sourceAttemptId: current.command.source.attemptId,
      scope: current.command.source.scope,
    },
    command: {
      actorId: current.command.payload.actorId,
      payloadHash: identityHash(current.command.operation.payload),
      payloadRaw: canonicalJson(
        z.json().parse(current.command.operation.payload),
      ),
    },
    phase: current.phase,
    admission: current.admission,
    review: current.command.expected,
    reviewHash: identityHash(current.command.expected),
    reviewRaw: canonicalJson(z.json().parse(current.command.expected)),
    successorPublicationHash:
      current.command.expected.successor.publicationHash,
    expected: current.expected,
    serving: observation,
    association: current.association,
    binding: current.binding,
    paths: current.paths,
    pathsHash: identityHash(current.paths),
    pathsRaw: canonicalJson(current.paths),
    sessions: {
      state: "clear",
      pathsHash: identityHash(current.paths),
      checkedAt: sessions.checkedAt,
    },
    sdk: {
      observedAt: new Date(invocation.execution.observed.wall).toISOString(),
      expiresAt: new Date(invocation.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(current.writerExpiresAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    completedAt: new Date().toISOString(),
  });
  const guardHash = identityHash(guard);
  // SQL birth validates the actual command, target, runtime, owner, writer,
  // exact pair/coverage, pointer/evidence and original cleanup or admission.
  // Complete caption inventories remain private Files-admission authority.
  if (current.handoff !== null) invocation.budget.consume(4);
  invocation.budget.consume(
    (current.phase === "admission" ? 18 : 14) + current.captionCount,
  );
  await bindPlexTransactionDeadline(tx, {
    expiresAtMs,
    assertActive: () => {
      prepared.freshness.assertActive();
      current.freshness.assertActive();
      input.verified?.freshness.assertActive();
    },
  });
  await tx.applicationEvent.create({
    data: {
      id: guard.id,
      kind: "movie_rollback_playback_v1",
      dedupeKey: `movie-rollback-playback-v1:${guard.id}`,
      mediaId: current.command.source.scope.mediaId,
      actorId: current.command.payload.actorId,
      payload: {
        guard: z.json().parse(guard),
        guardHash,
        raw: canonicalJson(z.json().parse(guard)),
      },
    },
  });
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackPlaybackV1',${JSON.stringify({ eventId: guard.id, guardHash })}::jsonb)
    WHERE id=${current.command.operation.id} AND payload=${JSON.stringify(current.command.operation.payload)}::jsonb
      AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackPhysicalV1')`;
  if (updated !== 1)
    throw new FileGuardError("movie_rollback_admission_changed");
  prepared.freshness.assertActive();
  current.freshness.assertActive();
  return { eventId: guard.id, guardHash };
}

function playbackCapture(current: Captured) {
  return {
    commandId: current.command.operation.id,
    payload: current.command.operation.payload,
    phase: current.phase,
    admission: current.admission,
    expected: current.expected,
    association: current.association,
    binding: current.binding,
    paths: current.paths,
  };
}

function playbackObservation(verified: VerifiedMovieServingPlexV2 | null) {
  if (verified === null) return null;
  const { freshness, ...body } = verified;
  freshness.assertActive();
  return MovieServingPlexV2Schema.parse(body);
}
