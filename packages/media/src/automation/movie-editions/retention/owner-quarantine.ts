import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { readMovieRetentionCommand } from "./scope.ts";
import { captureMovieOwnerRemovalAuthorityV1 } from "#infrastructure/movie-editions/lifecycle/owner-removal-authority.ts";
import {
  assertMovieQuarantineLegacyClaims,
  assertMovieQuarantineState,
  movieRetentionInclude,
} from "./quarantine-scope.ts";
import type { captureMovieQuarantineAuthorization } from "./quarantine-authorization.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";

/** Purpose-specific branch before automatic requester/warning policy. It never admits permanent purge. */
export async function captureOwnerMovieQuarantineAuthorizationV1(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof captureMovieQuarantineAuthorization>[1],
  execution: PlexBindingExecution,
  operationId: string,
) {
  const { movie } = input;
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  movie.budget.consume(1);
  const header = z
    .object({ ownerRemovalV1: z.unknown().optional() })
    .parse(decision.evidence);
  if (header.ownerRemovalV1 === undefined) return null;
  if (input.purge === true)
    throw new FileGuardError("owner_removal_requires_retention_consent");
  const evidence = z
    .object({
      authorizedAt: z.iso.datetime(),
      activePlayback: z.literal(false),
      recoveryEpoch: z.int().nonnegative(),
      ownerRemovalV1: z.strictObject({
        operationId: z.uuid(),
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    })
    .parse(decision.evidence);
  if (evidence.ownerRemovalV1.operationId !== operationId)
    throw new FileGuardError("movie_owner_action_changed");
  const commandInput = MovieOperationV4Schema.parse({
    schemaVersion: 4,
    operationId: evidence.ownerRemovalV1.operationId,
    scope: movie.scope,
    mediaId: movie.scope.mediaId,
    generation: input.entry.generations[movie.scope.mediaId],
  });
  const command = await readMovieRetentionCommand(
    tx,
    commandInput,
    movie.budget,
  );
  await assertPublicationUnfenced(
    tx,
    [movie.scope.mediaId],
    [input.entry.assetId],
  );
  await assertNoMediaSubtitleReplacement(tx, [movie.scope.mediaId]);
  await assertMovieQuarantineLegacyClaims(
    tx,
    { scope: movie.scope, epoch: evidence.recoveryEpoch },
    movie.budget,
  );
  const item = await tx.mediaItem.findUniqueOrThrow({
    where: { id: movie.scope.mediaId },
    include: movieRetentionInclude(movie.scope.edition),
  });
  assertMovieQuarantineState({
    decision,
    scope: movie.scope,
    item,
    generation: commandInput.generation,
    epoch: evidence.recoveryEpoch,
  });
  const authority = await captureMovieOwnerRemovalAuthorityV1(
    tx,
    commandInput,
    command.operation,
    {
      access: input.movieAccess,
      invocation: { budget: movie.budget, execution },
    },
  );
  if (
    identityHash(authority.source) !== evidence.ownerRemovalV1.sourceHash ||
    authority.snapshot.id !== input.entry.assetId ||
    authority.snapshot.version !== input.entry.assetVersion
  )
    throw new FileGuardError("movie_owner_action_changed");
  const observedAt = Date.parse(evidence.authorizedAt);
  const age = Date.now() - observedAt;
  if (age < 0 || age > 60_000) throw new FileGuardError("evidence_stale");
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      observedAt + 60_000,
      input.plex.freshness.expiresAtMs,
      authority.freshness.expiresAtMs,
    ),
    guards: [execution, input.plex.freshness, authority.freshness],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  return freshness;
}
