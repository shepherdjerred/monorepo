import type { MediaAutomationContext } from "#automation/context.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import {
  runtimeAuthority,
  lockRuntimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import {
  hasPendingLegacyClaims,
  LEGACY_CLAIM_PROTECTION,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  prepareBoundMediaCohort,
  assertBoundMediaCohort,
  lockBoundCohortRows,
} from "#automation/retention/binding.ts";
import {
  evaluateRetentionItem,
  RetentionEvidenceSchema,
  type RetentionResult,
} from "#automation/retention/evaluation.ts";
import { reconcileRetentionProjection } from "#automation/retention/projection.ts";
import { retentionDeadline } from "#automation/retention/deadline.ts";
import { retentionPlayback } from "#automation/retention/sessions.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { refreshRetentionReceipts } from "#automation/notifications/retention-receipts.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { serializable } from "#automation/store.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { readMovieRetentionCommand, readMovieRetentionItem } from "./scope.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

const protectedResult = (reason: string): RetentionResult => ({
  status: "protected",
  reason,
  decisionId: null,
  wakeAt: null,
});

/** The same policy and original watch/serving fences apply to one explicit movie cut. */
export async function evaluateMovieRetentionV4(
  base: MediaAutomationContext,
  raw: MovieOperationV4,
  execution: PlexBindingExecution,
): Promise<RetentionResult> {
  execution.assertActive();
  const input = MovieOperationV4Schema.parse(raw);
  const policyTime = z.date().parse(base.now?.() ?? new Date());
  const context = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  try {
    return await evaluateMovieRetention(context, input, execution, policyTime);
  } catch (error) {
    execution.assertActive();
    if (error instanceof PlexBindingProtection)
      return protectedResult(error.reason);
    if (error instanceof MovieChoiceProtection || error instanceof MediaError)
      return protectedResult(error.code);
    throw error;
  }
}

async function evaluateMovieRetention(
  context: ReturnType<typeof movieManagementContext>,
  input: MovieOperationV4,
  execution: PlexBindingExecution,
  policyTime: Date,
): Promise<RetentionResult> {
  const { scope } = input;
  const command = await readMovieRetentionCommand(
    context.db,
    input,
    context.movieManagement.budget,
  );
  const runtime = await runtimeAuthority(context.db);
  execution.assertActive();
  if (!runtime.active || command.epoch !== runtime.epoch)
    return protectedResult("runtime_protected");
  const original = await readMovieRetentionItem(context.db, scope);
  if (original.target.generation !== input.generation)
    return {
      status: "obsolete",
      decisionId: null,
      wakeAt: null,
      reason: "intent_obsolete",
    };
  const gate =
    original.target.availability === "quarantined"
      ? context.gates.purge
      : context.gates.quarantine;
  if (!(await gate())) return protectedResult("retention_disabled");
  const historyHolds = await context.db.recoveryHold.count({
    where: { mediaId: scope.mediaId, edition: scope.edition, releasedAt: null },
  });
  execution.assertActive();
  if (historyHolds > 0) return protectedResult("recovery_hold");
  const cohort = await prepareBoundMediaCohort(
    context,
    [scope.mediaId],
    { ...execution, budget: context.movieManagement.budget },
    scope,
  );
  let freshness = await retentionDeadline(context.db, cohort.access, execution);
  const watches: PlexBindingFreshness[] = [];
  const watch = await observeRequesterWatch(
    context,
    scope.mediaId,
    { edition: scope.edition },
    (guard) => watches.push(guard),
  );
  if (!watch.complete) return protectedResult(watch.reason ?? "watch_unknown");
  freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      freshness.expiresAtMs,
      ...watches.map((guard) => guard.expiresAtMs),
    ),
    guards: [freshness, ...watches],
  });
  if (
    !(await refreshRetentionReceipts(context, [scope.mediaId], scope.edition))
  )
    return protectedResult("warning_receipt_reconciliation_required");
  freshness.assertActive();
  if (await retentionPlayback(context, cohort, execution, freshness))
    return protectedResult("active_playback");
  const access = await networkMovieAccess(context, [scope.mediaId]);
  freshness.assertActive();
  const observedAt = new Date();
  return serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, scope);
    if (!(await lockRuntimeAuthority(tx, runtime.epoch)))
      return protectedResult("runtime_protected");
    await lockMovieChoiceIdentities(tx, { mediaIds: [scope.mediaId] });
    await lockBoundCohortRows(tx, cohort, freshness);
    const binding = await assertBoundMediaCohort(tx, cohort, freshness);
    await bindPlexTransactionDeadline(tx, freshness);
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR SHARE`;
    const currentCommand = await readMovieRetentionCommand(
      tx,
      input,
      context.movieManagement.budget,
    );
    if (
      currentCommand.epoch !== command.epoch ||
      identityHash(currentCommand.operation.payload) !==
        identityHash(command.operation.payload)
    )
      throw new Error("Movie retention command changed during observation");
    if (await hasPendingLegacyClaims(tx, [scope.mediaId]))
      return protectedResult(LEGACY_CLAIM_PROTECTION);
    if (
      await tx.recoveryHold.count({
        where: {
          mediaId: scope.mediaId,
          edition: scope.edition,
          releasedAt: null,
        },
      })
    )
      return protectedResult("recovery_hold");
    const current = await readMovieRetentionItem(tx, scope);
    if (current.target.generation !== input.generation)
      return {
        status: "obsolete",
        decisionId: null,
        wakeAt: null,
        reason: "intent_obsolete",
      };
    if (current.media.version !== original.media.version)
      return protectedResult("media_changed_during_observation");
    if (
      current.target.automationEpoch !== runtime.epoch ||
      current.media.assets.some(
        ({ asset }) => asset.ownershipEpoch !== runtime.epoch,
      )
    )
      return protectedResult("ownership_epoch_unconfirmed");
    if (Date.now() - observedAt.getTime() > 30_000)
      return protectedResult("playback_observation_stale");
    await reconcileRetentionProjection(
      tx,
      {
        mediaIds: [scope.mediaId],
        edition: scope.edition,
        binding,
        budget: context.movieManagement.budget,
      },
      freshness,
    );
    const choices: { expiresAtMs: number; assertActive: () => void }[] = [];
    const result = await evaluateRetentionItem(tx, current.media, {
      epoch: runtime.epoch,
      timestamp: observedAt,
      policyTime,
      movieAccess: access,
      binding,
      scope,
      budget: context.movieManagement.budget,
      captureFreshness: (guard) => choices.push(guard),
    });
    for (const guard of choices) {
      guard.assertActive();
      await bindPlexTransactionDeadline(tx, guard);
    }
    freshness.assertActive();
    if (result.decisionId !== null && result.status !== "warning") {
      const decision = await tx.retentionDecision.findUniqueOrThrow({
        where: { id: result.decisionId },
      });
      const evidence = RetentionEvidenceSchema.parse(decision.evidence);
      await tx.retentionDecision.update({
        where: { id: decision.id },
        data: {
          evidence: {
            ...evidence,
            plexExpiresAtMs: Math.floor(
              Math.min(
                freshness.expiresAtMs,
                ...choices.map((guard) => guard.expiresAtMs),
              ),
            ),
          },
        },
      });
    }
    for (const guard of choices) guard.assertActive();
    freshness.assertActive();
    return result;
  });
}
