import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import { networkMovieAccess } from "./editions/access.ts";
import {
  requestFulfillment,
  currentFulfillmentAsset,
} from "./editions/fulfillment.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import {
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { readMovieDemandFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { defaultIntent, defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import { evaluateRetention, RETENTION_DEFAULTS } from "#domain/retention.ts";
import type { MediaAutomationContext } from "./context.ts";
import { observeRequesterWatch, PlexIdentitySchema } from "./watch.ts";
import {
  mediaInclude,
  lineageResolved,
  coveredMedia,
  currentPlayback,
  type Media,
} from "./retention/scope.ts";
import { serializable } from "./store.ts";
import { createWarning } from "./notifications/retention-warning.ts";
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
type Transaction = Prisma.TransactionClient;
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
const EvidenceSchema = z.object({ warningEventId: z.string() });
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
async function evaluateItem(
  tx: Transaction,
  item: Media,
  authority: {
    epoch: number;
    timestamp: Date;
    movieAccess: MovieChoiceAccess | undefined;
    captureFreshness: (freshness: MovieChoiceFreshness) => void;
  },
): Promise<Result> {
  const { epoch, timestamp } = authority;
  const generation = defaultIntent(item.intents)?.generation;
  if (generation === undefined) return protect("intent_missing");
  if (!lineageResolved(item)) return protect("lineage_unresolved");
  let decision = await tx.retentionDecision.findFirst({
    where: {
      mediaId: item.id,
      edition: "default",
      generation,
      state: { in: ["warning_pending", "grace_period", "quarantined"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const warning =
    decision === null
      ? null
      : EvidenceSchema.parse(decision.evidence).warningEventId;
  const deliveries =
    warning === null
      ? []
      : await tx.notificationDelivery.findMany({
          where: {
            eventId: warning,
            state: "accepted",
            channel: { in: ["email", "discord"] },
            OR: [
              { providerStatus: null },
              { providerStatus: { not: "bounced" } },
            ],
            acceptedAt: { not: null },
            reconciledAt: {
              gte: new Date(timestamp.getTime() - 60_000),
              lte: timestamp,
            },
          },
          orderBy: { acceptedAt: "asc" },
        });
  const reserved = await tx.acquisitionReservation.findUnique({
    where: targetWhere(defaultScope(item.id)),
  });
  const currentAsset = await currentFulfillmentAsset(tx, item.id);
  const fulfillment = new Map<
    string,
    Awaited<ReturnType<typeof requestFulfillment>>
  >();
  for (const request of item.requests)
    fulfillment.set(
      request.id,
      await requestFulfillment(tx, {
        kind: item.kind,
        requestId: request.id,
        currentAsset,
        access: authority.movieAccess,
        captureFreshness: authority.captureFreshness,
      }),
    );
  const evaluation = evaluateRetention({
    now: timestamp.getTime(),
    generation,
    decisionGeneration: decision?.generation ?? generation,
    owned:
      item.assets.length > 0 &&
      item.assets.every(
        ({ asset }) =>
          asset.owned &&
          asset.edition === "default" &&
          asset.checksum !== null &&
          ["published", "quarantined"].includes(asset.state),
      ),
    identityConfirmed:
      PlexIdentitySchema.parse(item.externalIds).plexRatingKey !== undefined,
    activePlayback: false,
    operationInProgress: reserved !== null,
    holds: item.holds.map((hold) => ({
      until: hold.until?.getTime() ?? null,
      isPin: hold.isPin,
    })),
    requesters: item.requests
      .filter((claim) => item.kind === "movie" || claim.edition === "default")
      .map((claim) => {
        const fulfilled = fulfillment.get(claim.id);
        if (fulfilled === undefined)
          throw new Error("Retention request fulfillment missing");
        const watch = item.watchStates.find(
          (state) => state.userId === claim.userId,
        );
        const accepted = deliveries.find(
          (delivery) => delivery.userId === claim.userId,
        );
        return {
          userId: claim.userId,
          owner: claim.user.role === "owner",
          watched: watch?.watched ?? null,
          observedAt: watch?.observedAt.getTime() ?? null,
          warningAcceptedAt: accepted?.acceptedAt?.getTime() ?? null,
          warningFailed: accepted === undefined,
          fulfillment: fulfilled,
        };
      }),
  });
  if (evaluation.state === "protected") return protect(evaluation.reason);
  decision ??= await createWarning(tx, item, generation, epoch);
  if (evaluation.state === "warning_pending")
    return {
      status: "warning",
      decisionId: decision.id,
      wakeAt: new Date(timestamp.getTime() + 60_000).toISOString(),
      reason: "warning_acceptance_pending",
    };
  const proof = EvidenceSchema.parse(decision.evidence);
  const evidence = {
    ...proof,
    authorizedAt: timestamp.toISOString(),
    activePlayback: false,
    recoveryEpoch: epoch,
  };
  const graceUntil = new Date(evaluation.graceUntil);
  const warningAcceptedAt = new Date(
    evaluation.graceUntil - RETENTION_DEFAULTS.graceMs,
  );
  if (decision.state === "quarantined") {
    if (
      decision.quarantinedAt === null ||
      decision.purgeAfter === null ||
      decision.manifest === null
    )
      return protect("quarantine_manifest_missing");
    const purgeAt = Math.max(
      decision.purgeAfter.getTime(),
      decision.quarantinedAt.getTime() + RETENTION_DEFAULTS.quarantineMs,
    );
    await tx.retentionDecision.update({
      where: { id: decision.id },
      data: { evidence },
    });
    return {
      status: timestamp.getTime() < purgeAt ? "grace" : "purge",
      decisionId: decision.id,
      wakeAt: new Date(purgeAt).toISOString(),
      reason: null,
    };
  }
  await tx.retentionDecision.update({
    where: { id: decision.id },
    data: {
      state: "grace_period",
      evidence,
      graceUntil,
      warningAcceptedAt,
      version: { increment: 1 },
    },
  });
  return {
    status: evaluation.state === "grace_period" ? "grace" : "quarantine",
    decisionId: decision.id,
    wakeAt: graceUntil.toISOString(),
    reason: null,
  };
}

async function evaluateGroup(
  context: MediaAutomationContext,
  input: MediaOperation,
  observation: { ids: string[]; snapshots: Media[]; observedAt: Date },
): Promise<Result> {
  const { ids, snapshots, observedAt } = observation;
  const movieAccess = await networkMovieAccess(context, ids);
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
    const results = new Map<string, Result>();
    const freshness: MovieChoiceFreshness[] = [];
    for (const item of items)
      results.set(
        item.id,
        await evaluateItem(tx, item, {
          epoch: runtime.recoveryEpoch,
          timestamp: observedAt,
          movieAccess,
          captureFreshness: (guard) => freshness.push(guard),
        }),
      );
    for (const guard of freshness) guard.assertActive();
    const result = results.get(input.mediaId);
    if (result === undefined) throw new Error("Retention target missing");
    const protectedResult = [...results.values()].find(
      (value) => value.status === "protected",
    );
    if (protectedResult !== undefined) return protectedResult;
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
): Promise<Result | null> {
  for (const id of ids) {
    const watch = await observeRequesterWatch(context, id);
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
  observation: { ids: string[]; snapshots: Media[]; observedAt: Date },
): Promise<Result> {
  try {
    return await evaluateGroup(context, input, observation);
  } catch (error) {
    if (
      error instanceof MovieChoiceProtection ||
      (error instanceof MediaError && error.code === "plex_scope_unconfigured")
    )
      return protect(error.code);
    throw error;
  }
}

export function createRetentionActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "evaluateMediaRetention"> {
  return {
    async evaluateMediaRetention(input) {
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
        return (await currentPlayback(context, snapshots))
          ? protect("active_playback")
          : await evaluateOwnerOverride(
              context,
              input,
              ownerOverride,
              new Date(),
            );
      const pending = await pendingMovieDemand(context, ids);
      if (pending !== null) return protect(pending);
      const watch = await groupWatch(
        context,
        ids,
        target.availability === "quarantined",
      );
      if (watch !== null) return watch;
      if (!(await refreshRetentionReceipts(context, ids)))
        return protect("warning_receipt_reconciliation_required");
      if (await currentPlayback(context, snapshots))
        return protect("active_playback");
      return await evaluateObservedGroup(context, input, {
        ids,
        snapshots,
        observedAt: new Date(),
      });
    },
  };
}
