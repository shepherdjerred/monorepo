import { z } from "zod";
import {
  MovieDecisionOperationV4Schema,
  type MovieDecisionOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import {
  FileGuardError,
  type FileContext,
  type Transaction,
} from "#automation/files/types.ts";
import {
  assertMovieRemovalDecision,
  type MovieRemovalScope,
} from "#automation/files/movie-editions/removal-scope.ts";
import {
  removalPlan,
  assertOwnedAsset,
} from "#automation/files/removal-plan.ts";
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
  RetentionEpochSchema,
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
import {
  captureMovieQuarantineCommit,
  recordMovieQuarantineCommit,
} from "#infrastructure/movie-editions/retention/quarantine-commit.ts";
import { retireMovieQuarantineBinding } from "#infrastructure/movie-editions/retention/quarantine-invalidation.ts";
import { captureMovieQuarantineAuthorization } from "./quarantine-authorization.ts";

/** Scoped Files entrypoint; request/receipt history is independent of the ordinary default engine. */
export async function quarantineMovieFilesV4(
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
  if (await completedMovieQuarantine(base.db, input, movie)) return;
  const policyTime = z.date().parse(base.now?.() ?? new Date());
  // Policy time may simulate elapsed grace; every authority and physical receipt uses the real clock.
  const invocation = publicationInvocation(
    { ...base, now: () => new Date() },
    execution,
  );
  if (!(await invocation.enabled.quarantine()))
    throw new FileGuardError("retention_disabled");
  const snapshot = await invocation.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, input.scope);
    const decision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    });
    movie.budget.consume(1);
    assertMovieRemovalDecision(decision, input.scope);
    if (decision.state !== "grace_period")
      throw new FileGuardError("decision_obsolete");
    requireFreshRetentionStart(invocation, decision.evidence);
    return {
      plan: await removalPlan(tx, invocation, decision.id, movie),
      evidence: decision.evidence,
      epoch: RetentionEpochSchema.parse(decision.evidence).recoveryEpoch,
    };
  });
  const original = retentionPlexFreshness({
    context: invocation,
    observed: execution.observed,
    evidence: snapshot.evidence,
  });
  const access = await removalPlexAccess(invocation, snapshot.plan);
  const movieAccess = requireMovieChoiceAccess(
    (await fileMovieAccess(invocation, [input.scope.mediaId])) ?? {},
  );
  original.assertActive();
  const prepared = await prepareRemovalProof(invocation, snapshot.plan);
  original.assertActive();
  await awaitRetentionFreshness(prepared, {
    decisionId: input.decisionId,
    plan: snapshot.plan,
    epoch: snapshot.epoch,
    purge: false,
    assertOriginal: original.assertActive,
    movie,
  });
  await prepared.db.$transaction(
    async (tx) => {
      await lockRemovalAuthority(tx, {
        plan: snapshot.plan,
        epoch: snapshot.epoch,
        access,
        evidence: snapshot.evidence,
        movieScope: input.scope,
      });
      await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
      if (await completedMovieQuarantine(tx, input, movie)) return;
      const context = { ...prepared, execution };
      const freshness = await removalEffectFreshness(tx, {
        context,
        plan: snapshot.plan,
        epoch: snapshot.epoch,
        observed: execution.observed,
        original,
      });
      const plex = await readRetentionPlexAuthority(tx, {
        plan: snapshot.plan,
        purge: false,
        access,
        freshness,
        movie,
      });
      const entry = snapshot.plan[0];
      if (entry === undefined || snapshot.plan.length !== 1)
        throw new FileGuardError("coverage_changed");
      const authority = await captureMovieQuarantineAuthorization(tx, {
        movie,
        decisionId: input.decisionId,
        entry,
        policyTime,
        movieAccess,
        plex,
      });
      const receipt = await captureMovieQuarantineCommit(
        tx,
        { ...input, plan: snapshot.plan, access, budget: movie.budget },
        freshness,
      );
      const authorize = async () => {
        await context.checkpoint("retention-authorization");
        if (!(await context.enabled.quarantine()))
          throw new FileGuardError("retention_disabled");
        const configured = requireMovieChoiceAccess(
          (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
        );
        if (identityHash(configured) !== identityHash(movieAccess))
          throw new FileGuardError("wrong_section");
        await assertOwnedAsset(tx, entry, "published", movie);
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
      await removeEntry(operations, entry, input.operationId, false);
      await commitRemovalEntries(tx, {
        plan: snapshot.plan,
        epoch: snapshot.epoch,
        purge: false,
        completeState: "quarantined",
        previousSubtitleState: "installed",
      });
      const timestamp = new Date();
      await tx.retentionDecision.update({
        where: { id: input.decisionId },
        data: {
          state: "quarantined",
          version: { increment: 1 },
          manifest: { assets: snapshot.plan },
          quarantinedAt: timestamp,
          purgeAfter: new Date(timestamp.getTime() + 7 * 86_400_000),
        },
      });
      const committed = await recordMovieQuarantineCommit(
        tx,
        receipt,
        freshness,
      );
      await retireMovieQuarantineBinding(
        tx,
        { receipt: committed, budget: movie.budget },
        freshness,
      );
      await mirrorMovieQuarantine(tx, input);
      authority.assertActive();
      freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function completedMovieQuarantine(
  tx: Transaction,
  input: MovieDecisionOperationV4,
  movie: MovieRemovalScope,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  movie.budget.consume(1);
  const raw = z
    .object({ movieQuarantinePlexReceiptV2: z.json().optional() })
    .nullable()
    .parse(operation.result)?.movieQuarantinePlexReceiptV2;
  const command = z
    .object({
      kind: z.literal("retain_movie_edition_v4"),
      schemaVersion: z.literal(4),
      operationId: z.uuid(),
      mediaId: z.uuid(),
      scope: MovieDecisionOperationV4Schema.shape.scope,
      recoveryEpoch: z.int().nonnegative(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.targetId !== input.scope.mediaId ||
    operation.id !== command.operationId ||
    command.mediaId !== input.scope.mediaId ||
    identityHash(command.scope) !== identityHash(input.scope)
  )
    throw new FileGuardError("scope_changed");
  if (raw === undefined) return false;
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(raw);
  if (
    receipt.operationId !== input.operationId ||
    receipt.decisionId !== input.decisionId ||
    receipt.recoveryEpoch !== command.recoveryEpoch ||
    identityHash(receipt.scope) !== identityHash(input.scope)
  )
    throw new FileGuardError("scope_changed");
  return true;
}

async function mirrorMovieQuarantine(
  tx: Transaction,
  input: MovieDecisionOperationV4,
) {
  await tx.mediaIntent.update({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
    data: { availability: "quarantined" },
  });
  await tx.mediaItem.update({
    where: { id: input.scope.mediaId },
    data: {
      version: { increment: 1 },
      ...(input.scope.edition === "default"
        ? { availability: "quarantined" as const }
        : {}),
    },
  });
}
