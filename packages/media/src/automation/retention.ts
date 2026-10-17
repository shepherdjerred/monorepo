import { z } from "zod";
import {
  defaultIntent,
  defaultScope,
  assertDefaultEdition,
} from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import { evaluateRetention, RETENTION_DEFAULTS } from "#domain/retention.ts";
import type { MediaAutomationContext } from "./context.ts";
import { observeRequesterWatch, PlexIdentitySchema } from "./watch.ts";
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
const mediaInclude = {
  intents: { where: { edition: "default" } },
  requests: {
    where: { ...effectiveRequestWhere, edition: "default" },
    include: { user: { include: { notificationPreference: true } } },
  },
  holds: { where: { edition: "default" } },
  watchStates: { where: { edition: "default" } },
  assets: {
    where: { current: true, edition: "default" },
    include: { asset: true },
  },
} satisfies Prisma.MediaItemInclude;
type Media = Prisma.MediaItemGetPayload<{ include: typeof mediaInclude }>;
function lineageResolved(item: Media): boolean {
  const root = defaultIntent(item.intents)?.editionRootId;
  return (
    root != null &&
    item.assets.every(({ asset }) => asset.editionRootId === root)
  );
}

async function coveredMedia(
  context: MediaAutomationContext,
  mediaId: string,
): Promise<string[]> {
  const assets = await context.db.assetCoverage.findMany({
    where: { mediaId, current: true, edition: "default" },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  for (const { asset } of assets) {
    assertDefaultEdition(asset.edition);
    for (const coverage of asset.coverage)
      assertDefaultEdition(coverage.edition);
  }
  return [
    ...new Set([
      mediaId,
      ...assets.flatMap((coverage) =>
        coverage.asset.coverage.map((item) => item.mediaId),
      ),
    ]),
  ].sort();
}

async function currentPlayback(
  context: MediaAutomationContext,
  items: Media[],
): Promise<boolean> {
  const keys = new Set(
    items.map(
      (item) => PlexIdentitySchema.parse(item.externalIds).plexRatingKey,
    ),
  );
  const paths = new Set(
    items.flatMap((item) => item.assets.map((coverage) => coverage.asset.path)),
  );
  const sessions = await context.plex.activeSessions();
  return sessions.some(
    (session) =>
      keys.has(session.ratingKey) ||
      session.Media?.some((media) =>
        media.Part.some((part) => paths.has(part.file)),
      ) === true,
  );
}

async function evaluateItem(
  tx: Transaction,
  item: Media,
  epoch: number,
  timestamp: Date,
): Promise<Result> {
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
    requesters: item.requests.map((claim) => {
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
    for (const item of items)
      results.set(
        item.id,
        await evaluateItem(tx, item, runtime.recoveryEpoch, observedAt),
      );
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
      const watch = await groupWatch(
        context,
        ids,
        target.availability === "quarantined",
      );
      if (watch !== null) return watch;
      if (!(await refreshRetentionReceipts(context, ids)))
        return protect("warning_receipt_reconciliation_required");
      return (await currentPlayback(context, snapshots))
        ? protect("active_playback")
        : await evaluateGroup(context, input, {
            ids,
            snapshots,
            observedAt: new Date(),
          });
    },
  };
}
