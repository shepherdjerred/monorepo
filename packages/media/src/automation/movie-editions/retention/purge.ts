import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieDecisionOperationV4Schema,
  type MovieDecisionOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import type { MovieRemovalScope } from "#automation/files/movie-editions/removal-scope.ts";
import { assertOwnedAsset } from "#automation/files/removal-plan.ts";
import { prepareRemovalProof } from "#automation/files/content-proof.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import {
  commitRemovalEntries,
  removeEntry,
} from "#automation/files/removal.ts";
import { lockRemovalAuthority } from "#automation/files/plex-binding/locks.ts";
import {
  removalPlexAccess,
  readRetentionPlexAuthority,
} from "#automation/files/plex-binding/retention.ts";
import {
  retentionPlexFreshness,
  removalEffectFreshness,
} from "#automation/files/plex-binding/freshness.ts";
import {
  requireFreshRetentionStart,
  awaitRetentionFreshness,
} from "#automation/files/retention-freshness.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { captureMovieQuarantineAuthorization } from "./quarantine-authorization.ts";
import { readMoviePurgeParent, acknowledgeMoviePurge } from "./purge-parent.ts";
import { assertMoviePurgeSources } from "./purge-sources.ts";

/** Purge retains its original committed quarantine; terminal state names the actual journal owner. */
export async function purgeMovieFilesV4(
  base: FileContext,
  raw: MovieDecisionOperationV4,
): Promise<void> {
  const execution = requirePublicationExecution(base.publicationExecution?.());
  const input = MovieDecisionOperationV4Schema.parse(raw);
  const management = base.movieManagement;
  if (management === undefined)
    throw new FileGuardError("movie_management_context_missing");
  management.execution.assertActive();
  const movie = { scope: input.scope, budget: management.budget };
  const prior = await readMoviePurgeParent(base.db, input, movie);
  if (
    await acknowledgeMoviePurge(base, base.db, {
      command: input,
      parent: prior,
      movie,
    })
  )
    return;
  const policyTime = z.date().parse(base.now?.() ?? new Date());
  const invocation = publicationInvocation(
    { ...base, now: () => new Date() },
    execution,
  );
  if (!(await invocation.enabled.purge()))
    throw new FileGuardError("retention_disabled");
  const snapshot = await invocation.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, input.scope);
    const current = await readMoviePurgeParent(tx, input, movie);
    if (
      current.decision.state !== "quarantined" &&
      current.decision.state !== "purged"
    )
      throw new FileGuardError("decision_obsolete");
    if (current.decision.state === "quarantined")
      requireFreshRetentionStart(invocation, current.decision.evidence);
    return current;
  });
  if (
    await acknowledgeMoviePurge(invocation, invocation.db, {
      command: input,
      parent: snapshot,
      movie,
    })
  )
    return;
  const plan = snapshot.manifest.assets;
  const original = retentionPlexFreshness({
    context: invocation,
    observed: execution.observed,
    evidence: snapshot.decision.evidence,
  });
  const access = await removalPlexAccess(invocation, plan);
  const movieAccess = requireMovieChoiceAccess(
    (await fileMovieAccess(invocation, [input.scope.mediaId])) ?? {},
  );
  original.assertActive();
  const prepared = await prepareRemovalProof(invocation, plan);
  original.assertActive();
  await awaitRetentionFreshness(prepared, {
    decisionId: input.decisionId,
    plan,
    epoch: snapshot.epoch,
    purge: true,
    assertOriginal: original.assertActive,
    movie,
  });
  await prepared.db.$transaction(
    async (tx) => {
      await lockRemovalAuthority(tx, {
        plan,
        epoch: snapshot.epoch,
        access,
        evidence: snapshot.decision.evidence,
        movieScope: input.scope,
      });
      await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
      const current = await readMoviePurgeParent(tx, input, movie);
      if (
        identityHash(current.manifest) !== identityHash(snapshot.manifest) ||
        identityHash(current.receipt) !== identityHash(snapshot.receipt)
      )
        throw new FileGuardError("scope_changed");
      if (
        await acknowledgeMoviePurge(prepared, tx, {
          command: input,
          parent: current,
          movie,
        })
      )
        return;
      const context = { ...prepared, execution };
      const freshness = await removalEffectFreshness(tx, {
        context,
        plan,
        epoch: snapshot.epoch,
        observed: execution.observed,
        original,
      });
      const plex = await readRetentionPlexAuthority(tx, {
        plan,
        purge: true,
        access,
        freshness,
        movie,
      });
      const authority = await captureMovieQuarantineAuthorization(tx, {
        movie,
        decisionId: input.decisionId,
        entry: snapshot.entry,
        policyTime,
        movieAccess,
        plex,
        purge: true,
      });
      const authorize = async () => {
        await context.checkpoint("retention-authorization");
        if (!(await context.enabled.purge()))
          throw new FileGuardError("retention_disabled");
        const configured = requireMovieChoiceAccess(
          (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
        );
        if (identityHash(configured) !== identityHash(movieAccess))
          throw new FileGuardError("wrong_section");
        await assertOwnedAsset(tx, snapshot.entry, "quarantined", movie);
        authority.assertActive();
        freshness.assertActive();
      };
      await authorize();
      const operations = fileOperations(
        context,
        context.roots.movies,
        authorize,
        () => {
          authority.assertActive();
          freshness.assertActive();
        },
      );
      await assertMoviePurgeSources(
        context,
        operations,
        snapshot.entry,
        input.operationId,
      );
      await removeEntry(operations, snapshot.entry, input.operationId, true);
      await commitRemovalEntries(tx, {
        plan,
        epoch: snapshot.epoch,
        purge: true,
        completeState: "purged",
        previousSubtitleState: "quarantined",
      });
      await commitMoviePurge(tx, { input, parent: current, movie });
      authority.assertActive();
      freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function commitMoviePurge(
  tx: Prisma.TransactionClient,
  {
    input,
    parent,
  }: {
    input: MovieDecisionOperationV4;
    parent: Awaited<ReturnType<typeof readMoviePurgeParent>>;
    movie: MovieRemovalScope;
  },
) {
  const evidence = z
    .record(z.string(), z.json())
    .parse(parent.decision.evidence);
  await tx.retentionDecision.update({
    where: { id: input.decisionId },
    data: {
      state: "purged",
      version: { increment: 1 },
      evidence: { ...evidence, purgeOperationId: input.operationId },
    },
  });
  await tx.mediaIntent.update({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
    data: { availability: "removed" },
  });
  await tx.mediaItem.update({
    where: { id: input.scope.mediaId },
    data: {
      version: { increment: 1 },
      ...(input.scope.edition === "default"
        ? { availability: "removed" as const }
        : {}),
    },
  });
}
