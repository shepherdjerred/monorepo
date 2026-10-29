import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import { networkMovieAccess } from "./editions/access.ts";
import { currentFulfillmentAsset } from "./editions/fulfillment.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { readMovieDemandFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { defaultIntent, defaultScope } from "#shared/editions/scope.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { observeRequesterWatch } from "./watch.ts";
import {
  prepareBoundMediaCohort,
  assertBoundMediaCohort,
  lockBoundCohortRows,
  type BoundMediaCohort,
} from "./retention/binding.ts";
import {
  evaluateRetentionItem,
  RetentionEvidenceSchema as EvidenceSchema,
} from "./retention/evaluation.ts";
import { reconcileRetentionProjection } from "./retention/projection.ts";
import { retentionDeadline } from "./retention/deadline.ts";
import { retentionPlayback } from "./retention/sessions.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  mediaInclude,
  lineageResolved,
  coveredMedia,
  currentPlayback,
  type Media,
} from "./retention/scope.ts";
import { serializable } from "./store.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { evaluateOwnerOverride, readOwnerOverride } from "./retention-owner.ts";
import { refreshRetentionReceipts } from "./notifications/retention-receipts.ts";
import {
  hasPendingLegacyClaims,
  persistLegacyClaimProtection,
  reopenLegacyClaimProtection,
  LEGACY_CLAIM_PROTECTION,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

type Result = Awaited<
  ReturnType<MediaNetworkActivities["evaluateMediaRetention"]>
>;
const protect = (reason: string): Result => ({
  status: "protected",
  reason,
  decisionId: null,
  wakeAt: null,
});
async function legacyProtection(
  context: MediaAutomationContext,
  ids: string[],
) {
  if (ids.length > 500) return protect("coverage_requires_review");
  return (await reopenLegacyClaimProtection(context.db, ids))
    ? protect(LEGACY_CLAIM_PROTECTION)
    : null;
}
function incompleteWatchReason(observation: {
  quarantined: boolean;
  reason: string | null;
}): string {
  return observation.quarantined
    ? "quarantine_watch_reconciliation_required"
    : (observation.reason ?? "watch_unknown");
}
type BoundObservation = {
  ids: string[];
  snapshots: Media[];
  observedAt: Date;
  cohort: BoundMediaCohort;
  freshness: PlexBindingFreshness;
};
async function pendingMovieDemand(
  context: MediaAutomationContext,
  ids: string[],
) {
  try {
    const access = await networkMovieAccess(context, ids);
    if (access === undefined) return null;
    for (const mediaId of ids) {
      const demands = await readMovieDemandFulfillment(context.db, {
        mediaId,
        access,
        currentAsset: await currentFulfillmentAsset(context.db, mediaId),
      });
      const pending = demands.find(
        (row) => row.fulfillment.status !== "fulfilled",
      );
      if (pending !== undefined) return pending.fulfillment.reason;
    }
    return null;
  } catch (error) {
    if (error instanceof MediaError && error.code === "plex_scope_unconfigured")
      return error.code;
    throw error;
  }
}
async function evaluateGroup(
  context: MediaAutomationContext,
  input: MediaOperation,
  observation: BoundObservation,
): Promise<Result> {
  const { ids, snapshots, observedAt } = observation;
  const movieAccess = await networkMovieAccess(context, ids);
  observation.freshness.assertActive();
  return await serializable(context.db, async (tx) => {
    await lockDefaultScopes(
      tx,
      ids.map((id) => defaultScope(id)),
      {
        createMissing: false,
      },
    );
    await lockEffectiveRequests(tx, ids);
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (!(await lockRuntimeAuthority(tx, runtime.recoveryEpoch)))
      return protect("runtime_protected");
    await lockMovieChoiceIdentities(tx, { mediaIds: ids });
    await lockBoundCohortRows(tx, observation.cohort, observation.freshness);
    const binding = await assertBoundMediaCohort(
      tx,
      observation.cohort,
      observation.freshness,
    );
    await bindPlexTransactionDeadline(tx, observation.freshness);
    if (await hasPendingLegacyClaims(tx, ids)) {
      await persistLegacyClaimProtection(tx, ids);
      return protect(LEGACY_CLAIM_PROTECTION);
    }
    const items = await tx.mediaItem.findMany({
      where: { id: { in: ids } },
      include: mediaInclude,
    });
    if (
      items.some(
        (item) =>
          defaultIntent(item.intents)?.automationEpoch !==
            runtime.recoveryEpoch ||
          item.assets.some(
            (coverage) =>
              coverage.asset.ownershipEpoch !== runtime.recoveryEpoch,
          ),
      )
    )
      return protect("ownership_epoch_unconfirmed");
    if (
      (await tx.recoveryHold.count({
        where: { mediaId: { in: ids }, edition: "default", releasedAt: null },
      })) > 0
    )
      return protect("recovery_hold");
    if (
      items.some(
        (item) =>
          item.version !==
          snapshots.find((snapshot) => snapshot.id === item.id)?.version,
      )
    )
      return protect("media_changed_during_observation");
    const target = items.find((item) => item.id === input.mediaId);
    if (
      target === undefined ||
      defaultIntent(target.intents)?.generation !== input.generation
    )
      return {
        status: "obsolete",
        decisionId: null,
        wakeAt: null,
        reason: "intent_obsolete",
      };
    if (Date.now() - observedAt.getTime() > 30_000)
      return protect("playback_observation_stale");
    await reconcileRetentionProjection(
      tx,
      { mediaIds: ids, binding },
      observation.freshness,
    );
    const results = new Map<string, Result>();
    const freshness: MovieChoiceFreshness[] = [];
    for (const item of items)
      results.set(
        item.id,
        await evaluateRetentionItem(tx, item, {
          epoch: runtime.recoveryEpoch,
          timestamp: observedAt,
          movieAccess,
          captureFreshness: (guard) => freshness.push(guard),
          binding,
        }),
      );
    for (const guard of freshness) {
      guard.assertActive();
      await bindPlexTransactionDeadline(tx, guard);
    }
    observation.freshness.assertActive();
    const result = results.get(input.mediaId);
    if (result === undefined) throw new Error("Retention target missing");
    const protectedResult = [...results.values()].find(
      (value) => value.status === "protected",
    );
    if (protectedResult !== undefined) return protectedResult;
    const plexExpiresAtMs = z
      .int()
      .nonnegative()
      .parse(
        Math.floor(
          Math.min(
            observation.freshness.expiresAtMs,
            ...freshness.map((guard) => guard.expiresAtMs),
          ),
        ),
      );
    await persistDecisionDeadlines(tx, results, plexExpiresAtMs);
    for (const guard of freshness) guard.assertActive();
    observation.freshness.assertActive();
    const pending = [...results.values()].find(
      (value) => value.status === "warning",
    );
    if (pending !== undefined)
      return { ...pending, decisionId: result.decisionId };
    const grace = [...results.values()].filter(
      (value) => value.status === "grace",
    );
    if (grace.length > 0)
      return {
        status: "grace",
        decisionId: result.decisionId,
        wakeAt: new Date(
          Math.max(
            ...grace.map((value) =>
              Date.parse(value.wakeAt ?? observedAt.toISOString()),
            ),
          ),
        ).toISOString(),
        reason: "covered_media_grace",
      };
    return [...results.values()].some((value) => value.status !== result.status)
      ? protect("covered_media_state_mismatch")
      : result;
  });
}

async function groupWatch(
  context: MediaAutomationContext,
  ids: string[],
  quarantined: boolean,
  captureFreshness: (freshness: PlexBindingFreshness) => void,
): Promise<Result | null> {
  for (const id of ids) {
    const watch = await observeRequesterWatch(
      context,
      id,
      {},
      captureFreshness,
    );
    if (!watch.complete)
      return protect(
        incompleteWatchReason({ quarantined, reason: watch.reason }),
      );
  }
  return null;
}

async function evaluateObservedGroup(
  context: MediaAutomationContext,
  input: MediaOperation,
  observation: BoundObservation,
): Promise<Result> {
  try {
    return await evaluateGroup(context, input, observation);
  } catch (error) {
    if (error instanceof PlexBindingProtection) return protect(error.reason);
    if (
      error instanceof MovieChoiceProtection ||
      (error instanceof MediaError && error.code === "plex_scope_unconfigured")
    )
      return protect(error.code);
    throw error;
  }
}

export function createRetentionActivities(
  base: MediaAutomationContext,
): Pick<MediaNetworkActivities, "evaluateMediaRetention"> {
  return {
    async evaluateMediaRetention(input) {
      const execution = base.plexBindingExecution();
      execution.assertActive();
      const context = {
        ...base,
        plexBindingExecution: () => execution,
        watchExecution: () => execution,
      };
      const authority = await runtimeAuthority(context.db);
      if (!authority.active) return protect("runtime_protected");
      const ownerOverride = await readOwnerOverride(context, input);
      const ids =
        ownerOverride === null
          ? await coveredMedia(context, input.mediaId)
          : ownerOverride.media.map((item) => item.id);
      const legacy = await legacyProtection(context, ids);
      if (legacy !== null) return legacy;
      const snapshots = await context.db.mediaItem.findMany({
        where: { id: { in: ids } },
        include: mediaInclude,
      });
      const target = snapshots.find((item) => item.id === input.mediaId);
      if (
        target === undefined ||
        defaultIntent(target.intents)?.generation !== input.generation
      )
        return {
          status: "obsolete",
          decisionId: null,
          wakeAt: null,
          reason: "intent_obsolete",
        };
      if (snapshots.some((item) => !lineageResolved(item)))
        return protect("lineage_unresolved");
      if (target.availability === "removed")
        return {
          status: "complete",
          decisionId: null,
          wakeAt: null,
          reason: null,
        };
      const gate =
        target.availability === "quarantined"
          ? context.gates.purge
          : context.gates.quarantine;
      if (!(await gate())) return protect("retention_disabled");
      if (ownerOverride !== null)
        return await evaluateOwnerPlayback(context, input, {
          snapshots,
          ownerOverride,
        });
      const pending = await pendingMovieDemand(context, ids);
      if (pending !== null) return protect(pending);
      const prepared = await prepareRetentionCohort(context, ids, execution);
      if (prepared.status === "protected") return protect(prepared.reason);
      const { cohort } = prepared;
      let { freshness } = prepared;
      const completeSnapshots = await context.db.mediaItem.findMany({
        where: { id: { in: cohort.mediaIds } },
        include: mediaInclude,
      });
      freshness.assertActive();
      const watchFreshness: PlexBindingFreshness[] = [];
      const watch = await groupWatch(
        context,
        cohort.mediaIds,
        target.availability === "quarantined",
        (guard) => watchFreshness.push(guard),
      );
      if (watch !== null) return watch;
      freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          freshness.expiresAtMs,
          ...watchFreshness.map((guard) => guard.expiresAtMs),
        ),
        guards: [freshness, ...watchFreshness],
      });
      freshness.assertActive();
      if (!(await refreshRetentionReceipts(context, cohort.mediaIds)))
        return protect("warning_receipt_reconciliation_required");
      freshness.assertActive();
      if (await retentionPlayback(context, cohort, execution, freshness))
        return protect("active_playback");
      freshness.assertActive();
      return await evaluateObservedGroup(context, input, {
        ids: cohort.mediaIds,
        snapshots: completeSnapshots,
        observedAt: new Date(),
        cohort,
        freshness,
      });
    },
  };
}

async function persistDecisionDeadlines(
  tx: Prisma.TransactionClient,
  results: ReadonlyMap<string, Result>,
  plexExpiresAtMs: number,
) {
  for (const value of results.values()) {
    if (value.decisionId === null || value.status === "warning") continue;
    const decision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: value.decisionId },
    });
    await tx.retentionDecision.update({
      where: { id: decision.id },
      data: {
        evidence: {
          ...EvidenceSchema.parse(decision.evidence),
          plexExpiresAtMs,
        },
      },
    });
  }
}

async function prepareRetentionCohort(
  context: MediaAutomationContext,
  ids: string[],
  execution: PlexBindingExecution,
): Promise<
  | {
      status: "ready";
      cohort: BoundMediaCohort;
      freshness: PlexBindingFreshness;
    }
  | { status: "protected"; reason: string }
> {
  try {
    const initialFreshness = plexBindingFreshness({
      ...execution,
      guards: [execution],
    });
    const cohort = await prepareBoundMediaCohort(
      context,
      ids,
      initialFreshness,
    );
    const freshness = await retentionDeadline(
      context.db,
      cohort.access,
      execution,
    );
    return { status: "ready", cohort, freshness };
  } catch (error) {
    if (error instanceof PlexBindingProtection)
      return { status: "protected", reason: error.reason };
    throw error;
  }
}

async function evaluateOwnerPlayback(
  context: MediaAutomationContext,
  input: MediaOperation,
  scope: {
    snapshots: Media[];
    ownerOverride: NonNullable<Awaited<ReturnType<typeof readOwnerOverride>>>;
  },
): Promise<Result> {
  return (await currentPlayback(context, scope.snapshots))
    ? protect("active_playback")
    : await evaluateOwnerOverride(
        context,
        input,
        scope.ownerOverride,
        new Date(),
      );
}
