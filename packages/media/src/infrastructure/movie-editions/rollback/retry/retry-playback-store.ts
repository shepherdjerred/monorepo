import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { MovieRollbackRetryPlaybackV1Schema } from "#shared/movie-editions/rollback/retry-playback.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { movieRollbackTransactionId } from "#infrastructure/movie-editions/rollback/transaction.ts";
import type { captureMovieRollbackRetryPlaybackV1 } from "./retry-playback-capture.ts";

type Captured = Extract<
  Awaited<ReturnType<typeof captureMovieRollbackRetryPlaybackV1>>,
  { status: "captured" }
>;
const stable = (capture: Captured) => ({
  intentHash: capture.parent.intentHash,
  handoff: capture.handoff.reference,
  association: capture.originalAssociation,
  paths: capture.paths,
});

export async function commitMovieRollbackRetryPlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    prepared: Captured;
    current: Captured;
    sessions: { active: boolean; checkedAt: string | null };
    invocation: MovieManagementInvocation;
  },
) {
  const { prepared, current, sessions, invocation } = input;
  if (
    sessions.active ||
    sessions.checkedAt === null ||
    identityHash(stable(prepared)) !== identityHash(stable(current))
  )
    throw new FileGuardError("active_playback");
  prepared.freshness.assertActive();
  current.freshness.assertActive();
  const expiresAtMs = Math.min(
    prepared.freshness.expiresAtMs,
    current.freshness.expiresAtMs,
  );
  const raw = (value: unknown) => canonicalJson(z.json().parse(value));
  const guard = MovieRollbackRetryPlaybackV1Schema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    transactionId: await movieRollbackTransactionId(tx),
    operationId: current.parent.operation.id,
    intentId: current.parent.intent.id,
    intentHash: current.parent.intentHash,
    input: current.handoff.handoff.input,
    handoff: current.handoff.reference,
    commandRaw: raw(current.handoff.command.operation.payload),
    commandHash: identityHash(current.handoff.command.operation.payload),
    originalAssociation: current.originalAssociation,
    paths: current.paths,
    pathsRaw: raw(current.paths),
    pathsHash: identityHash(current.paths),
    sessions: {
      state: "clear",
      checkedAt: sessions.checkedAt,
      pathsHash: identityHash(current.paths),
    },
    sdk: {
      observedAt: new Date(invocation.execution.observed.wall).toISOString(),
      expiresAt: new Date(invocation.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(current.writerExpiresAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    completedAt: new Date().toISOString(),
  });
  // Original Op, target/runtime/profile/writer/pointer/original association;
  // A/B+coverage/full captions; the four exact execution-fence parents and
  // one same-transaction playback pointer event validation.
  invocation.budget.consume(16 + current.captionCount);
  await bindPlexTransactionDeadline(tx, {
    expiresAtMs,
    assertActive: () => {
      prepared.freshness.assertActive();
      current.freshness.assertActive();
    },
  });
  const guardHash = identityHash(guard);
  const reference = { eventId: guard.id, guardHash };
  await tx.applicationEvent.create({
    data: {
      id: guard.id,
      kind: "movie_rollback_retry_playback_v1",
      mediaId: current.parent.intent.scope.mediaId,
      actorId: current.handoff.command.operation.userId,
      dedupeKey: `movie-rollback-retry-playback-v1:${guard.id}`,
      createdAt: new Date(),
      payload: { guard: z.json().parse(guard), guardHash, raw: raw(guard) },
    },
  });
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackRetryPlaybackV1',${JSON.stringify(reference)}::jsonb)
    WHERE id=${current.parent.operation.id} AND result#>>'{movieRollbackIntentV1,intentHash}'=${current.parent.intentHash}
      AND result->'movieRollbackOwnerV1'=${JSON.stringify(current.handoff.reference)}::jsonb AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackPhysicalV1')`;
  if (changed !== 1)
    throw new FileGuardError("movie_rollback_execution_owner_changed");
  prepared.freshness.assertActive();
  current.freshness.assertActive();
  return reference;
}
