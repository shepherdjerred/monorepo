import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { readMovieOwnerLifecycleSourceV1 } from "#infrastructure/movie-editions/lifecycle/owner-source.ts";
import { captureMovieOwnerRemovalAuthorityV1 } from "#infrastructure/movie-editions/lifecycle/owner-removal-authority.ts";
import type { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { readMovieRetentionCommand } from "./scope.ts";
import {
  prepareBoundMediaCohort,
  assertBoundMediaCohort,
  lockBoundCohortRows,
} from "#automation/retention/binding.ts";
import { retentionDeadline } from "#automation/retention/deadline.ts";
import { retentionPlayback } from "#automation/retention/sessions.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { captureRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { serializable } from "#automation/store.ts";
import { assertMovieQuarantineLegacyClaims } from "./quarantine-scope.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { RetentionResult } from "#automation/retention/evaluation.ts";
import { readMovieRemovalSourceV4 } from "#automation/movie-editions/notifications/removal-source.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";

const protect = (reason: string): RetentionResult => ({
  status: "protected",
  reason,
  decisionId: null,
  wakeAt: null,
});

/** An explicit owner action authorizes reversible quarantine only, independently of requester watch consent. */
export async function evaluateOwnerMovieRemovalV1(
  context: ReturnType<typeof movieManagementContext>,
  input: MovieOperationV4,
  execution: PlexBindingExecution,
  command: Awaited<ReturnType<typeof readMovieRetentionCommand>>,
): Promise<RetentionResult | null> {
  const source = readMovieOwnerLifecycleSourceV1(
    command.operation,
    input,
    "remove",
  );
  if (source === null) return null;
  try {
    if (
      z
        .object({ movieQuarantinePlexReceiptV2: z.unknown().optional() })
        .parse(command.operation.result ?? {}).movieQuarantinePlexReceiptV2 !==
      undefined
    ) {
      const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
        z
          .object({ movieQuarantinePlexReceiptV2: z.json() })
          .parse(command.operation.result).movieQuarantinePlexReceiptV2,
      );
      await readMovieRemovalSourceV4(
        context.db,
        {
          schemaVersion: 4,
          operationId: input.operationId,
          scope: input.scope,
          decisionId: receipt.decisionId,
          stage: "quarantined",
        },
        context.movieManagement.budget,
      );
      execution.assertActive();
      return {
        status: "complete",
        reason: "owner_confirmed_quarantine",
        decisionId: null,
        wakeAt: null,
      };
    }
    if (!(await context.gates.quarantine()))
      return protect("retention_disabled");
    const budget = context.movieManagement.budget;
    const cohort = await prepareBoundMediaCohort(
      context,
      [input.scope.mediaId],
      { ...execution, budget },
      input.scope,
    );
    const deadline = await retentionDeadline(
      context.db,
      cohort.access,
      execution,
    );
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (await retentionPlayback(context, cohort, execution, deadline))
      return protect("active_playback");
    const observedAt = new Date();
    return await serializable(context.db, async (tx) => {
      await lockMovieCommand(tx, input.scope);
      if (!(await lockRuntimeAuthority(tx, command.epoch)))
        return protect("runtime_protected");
      await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR SHARE`;
      const current = await readMovieRetentionCommand(tx, input, budget);
      if (
        identityHash(current.operation.payload) !==
        identityHash(command.operation.payload)
      )
        throw new Error("Owner removal source changed during observation");
      await lockBoundCohortRows(tx, cohort, deadline);
      const binding = await assertBoundMediaCohort(tx, cohort, deadline);
      await assertMovieQuarantineLegacyClaims(
        tx,
        { scope: input.scope, epoch: command.epoch },
        budget,
      );
      const authority = await captureMovieOwnerRemovalAuthorityV1(
        tx,
        input,
        current.operation,
        { access, invocation: context.movieManagement },
      );
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          deadline.expiresAtMs,
          authority.freshness.expiresAtMs,
        ),
        guards: [deadline, authority.freshness],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      if (Date.now() - observedAt.getTime() > 30_000)
        return protect("playback_observation_stale");
      const configured = requireMovieChoiceAccess(
        (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
      );
      if (identityHash(configured) !== identityHash(access))
        return protect("wrong_section");
      const decision = await ownerDecisionV1(
        tx,
        {
          input,
          sourceHash: identityHash(authority.source),
          epoch: command.epoch,
          timestamp: observedAt,
          expiresAtMs: freshness.expiresAtMs,
        },
        binding,
        budget,
      );
      freshness.assertActive();
      return {
        status: "quarantine",
        reason: "owner_confirmed_removal",
        decisionId: decision.id,
        wakeAt: observedAt.toISOString(),
      };
    });
  } catch (error) {
    execution.assertActive();
    if (error instanceof FileGuardError) return protect(error.reason);
    throw error;
  }
}

async function ownerDecisionV1(
  tx: Prisma.TransactionClient,
  input: {
    input: MovieOperationV4;
    sourceHash: string;
    epoch: number;
    timestamp: Date;
    expiresAtMs: number;
  },
  binding: Awaited<ReturnType<typeof assertBoundMediaCohort>>,
  budget: ReturnType<
    typeof movieManagementContext
  >["movieManagement"]["budget"],
) {
  const evidence = {
    authorizedAt: input.timestamp.toISOString(),
    activePlayback: false,
    recoveryEpoch: input.epoch,
    ownerRemovalV1: {
      operationId: input.input.operationId,
      sourceHash: input.sourceHash,
    },
    plexExpiresAtMs: input.expiresAtMs,
  };
  const existing = await tx.retentionDecision.findMany({
    where: {
      mediaId: input.input.scope.mediaId,
      edition: input.input.scope.edition,
      generation: input.input.generation,
      state: "grace_period",
    },
    take: 2,
  });
  budget.consume(existing.length);
  if (existing.length > 1)
    throw new Error("Owner removal has ambiguous current decisions");
  const previous = existing[0];
  if (previous !== undefined) {
    const original = z
      .object({
        ownerRemovalV1: z.object({
          operationId: z.uuid(),
          sourceHash: z.string(),
        }),
      })
      .parse(previous.evidence).ownerRemovalV1;
    if (identityHash(original) !== identityHash(evidence.ownerRemovalV1))
      throw new FileGuardError("decision_obsolete");
    return tx.retentionDecision.update({
      where: { id: previous.id },
      data: { evidence },
    });
  }
  const decision = await tx.retentionDecision.create({
    data: {
      mediaId: input.input.scope.mediaId,
      edition: input.input.scope.edition,
      generation: input.input.generation,
      state: "eligible",
      evidence,
    },
  });
  await captureRetentionPlexProjection(
    tx,
    {
      decisionId: decision.id,
      groups: binding.groups,
      bindings: binding.bindings,
    },
    budget,
  );
  return tx.retentionDecision.update({
    where: { id: decision.id },
    data: {
      state: "grace_period",
      version: { increment: 1 },
      graceUntil: input.timestamp,
    },
  });
}
