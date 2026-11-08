import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PlexVerificationProtected } from "#shared/plex-binding/observations.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { MoviePlexRejectionV1Schema } from "#shared/movie-editions/rollback/rejection.ts";
import { captureMoviePlexExpectedV2 } from "#infrastructure/movie-editions/plex/expected.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertRejectionClock } from "./rejection-records.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { movieRollbackTransactionId } from "./transaction.ts";
import { reserveMoviePlexRejectionSqlV1 } from "./read-budget.ts";

/** Called only with the actual verifier's protected result, never from a catch. */
export async function recordMoviePlexRejectionV1(
  tx: Prisma.TransactionClient,
  input: {
    source: MovieAttemptOperationV4;
    expected: PlexBindingExpected;
    observation: PlexVerificationProtected;
    access: MovieChoiceAccess;
    freshness: PlexBindingFreshness;
    invocation: MovieManagementInvocation;
  },
) {
  const current = await captureMoviePlexExpectedV2(
    tx,
    input.source,
    input.access,
    input.invocation,
  );
  input.freshness.assertActive();
  current.authority.freshness.assertActive();
  if (identityHash(current.expected) !== identityHash(input.expected))
    throw new PlexBindingProtection("scope_changed");
  const guarded = plexBindingFreshness({
    observed: input.invocation.execution.observed,
    expiresAtMs: Math.min(
      input.freshness.expiresAtMs,
      current.authority.freshness.expiresAtMs,
      current.leaseExpiresAtMs,
    ),
    guards: [input.freshness, current.authority.freshness],
  });
  await bindPlexTransactionDeadline(tx, guarded);
  const receipt = MoviePlexRejectionV1Schema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    transactionId: await movieRollbackTransactionId(tx),
    commandPayloadRaw: canonicalJson(z.json().parse(current.command.payload)),
    identityRaw: canonicalJson(
      z.json().parse(current.attempt.identityEvidence),
    ),
    birthRaw: canonicalJson({
      choiceId: current.attempt.movieEditionChoiceId,
      choiceRevision: current.attempt.movieEditionChoiceRevision,
      authority: z.json().parse(current.attempt.movieEditionAuthority),
    }),
    generationsRaw: canonicalJson(z.json().parse(current.attempt.generations)),
    input: input.source,
    command: moviePlexCommandParentV2(current.command),
    attempt: moviePlexAttemptParentV2(current.attempt),
    publication: {
      transitionId: current.publication.reference.transitionId,
      intentHash: current.publication.reference.intentHash,
      outcomeHash: current.publication.outcomeHash,
    },
    expected: current.expected,
    observation: input.observation,
    sdk: {
      observedAt: new Date(
        input.invocation.execution.observed.wall,
      ).toISOString(),
      expiresAt: new Date(input.invocation.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(current.leaseExpiresAtMs).toISOString(),
    expiresAt: new Date(guarded.expiresAtMs).toISOString(),
    completedAt: new Date().toISOString(),
  });
  assertRejectionClock(receipt);
  reserveMoviePlexRejectionSqlV1(
    input.invocation.budget,
    current.authority.identity.schemaVersion,
    current.expected,
  );
  await tx.applicationEvent.create({
    data: {
      id: receipt.id,
      dedupeKey: `movie-plex-rejected-v1:${receipt.id}`,
      mediaId: input.source.scope.mediaId,
      actorId: current.command.userId,
      kind: "movie_plex_rejected_v1",
      payload: {
        receipt: z.json().parse(receipt),
        receiptHash: identityHash(receipt),
        raw: canonicalJson(z.json().parse(receipt)),
      },
    },
  });
  input.invocation.budget.consume(1);
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackRejectionV1',${JSON.stringify({ eventId: receipt.id, receiptHash: identityHash(receipt) })}::jsonb) WHERE id=${input.source.operationId}`;
  if (changed !== 1)
    throw new Error(
      "Movie rejected Plex observation lost its actual source operation",
    );
  guarded.assertActive();
  return receipt;
}
