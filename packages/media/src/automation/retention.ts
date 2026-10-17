import { z } from "zod";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import { evaluateRetention, RETENTION_DEFAULTS } from "#domain/retention.ts";
import type { MediaAutomationContext } from "./context.ts";
import { observeRequesterWatch, PlexIdentitySchema } from "./watch.ts";
import { queueOperation, serializable } from "./store.ts";
import { evaluateOwnerOverride, readOwnerOverride } from "./retention-owner.ts";

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
  intent: true,
  requests: {
    where: effectiveRequestWhere,
    include: { user: { include: { notificationPreference: true } } },
  },
  holds: true,
  watchStates: true,
  assets: { where: { current: true }, include: { asset: true } },
} satisfies Prisma.MediaItemInclude;
type Media = Prisma.MediaItemGetPayload<{ include: typeof mediaInclude }>;

async function coveredMedia(
  context: MediaAutomationContext,
  mediaId: string,
): Promise<string[]> {
  const assets = await context.db.assetCoverage.findMany({
    where: { mediaId, current: true },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
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

async function createWarning(
  tx: Transaction,
  item: Media,
  generation: number,
  epoch: number,
) {
  const decisionId = crypto.randomUUID();
  const event = await tx.applicationEvent.create({
    data: {
      mediaId: item.id,
      kind: "retention_warning",
      payload: { decisionId, generation },
    },
  });
  const decision = await tx.retentionDecision.create({
    data: {
      id: decisionId,
      mediaId: item.id,
      generation,
      state: "warning_pending",
      evidence: { warningEventId: event.id, recoveryEpoch: epoch },
    },
  });
  for (const claim of item.requests.filter(
    (request) => request.user.role !== "owner",
  )) {
    const preference = claim.user.notificationPreference;
    const channels = [
      preference?.emailEnabled === true &&
      claim.user.emailVerifiedAt !== null &&
      claim.user.email !== null
        ? "email"
        : null,
      preference?.discordEnabled === true && claim.user.discordId !== null
        ? "discord"
        : null,
    ].filter((channel) => channel !== null);
    for (const channel of channels) {
      const notification = await tx.notificationDelivery.create({
        data: {
          eventId: event.id,
          userId: claim.userId,
          channel,
          state: "pending",
          recoveryEpoch: epoch,
        },
      });
      await queueOperation(tx, {
        key: `notification:${notification.id}`,
        kind: "deliver_notification",
        targetId: notification.id,
        userId: claim.userId,
        payload: { notificationId: notification.id },
      });
    }
  }
  return decision;
}

async function evaluateItem(
  tx: Transaction,
  item: Media,
  epoch: number,
  timestamp: Date,
): Promise<Result> {
  const generation = item.intent?.generation;
  if (generation === undefined) return protect("intent_missing");
  let decision = await tx.retentionDecision.findFirst({
    where: {
      mediaId: item.id,
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
            acceptedAt: { not: null },
          },
          orderBy: { acceptedAt: "asc" },
        });
  const reserved = await tx.acquisitionReservation.findUnique({
    where: { mediaId: item.id },
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
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (runtime.mode !== "active" || !runtime.ownershipConfirmed)
      return protect("runtime_protected");
    const items = await tx.mediaItem.findMany({
      where: { id: { in: ids } },
      include: mediaInclude,
    });
    if (
      items.some(
        (item) =>
          item.version !==
          snapshots.find((snapshot) => snapshot.id === item.id)?.version,
      )
    )
      return protect("media_changed_during_observation");
    const target = items.find((item) => item.id === input.mediaId);
    if (target?.intent?.generation !== input.generation)
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

export function createRetentionActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "evaluateMediaRetention"> {
  return {
    async evaluateMediaRetention(input) {
      const ownerOverride = await readOwnerOverride(context, input);
      const ids =
        ownerOverride === null
          ? await coveredMedia(context, input.mediaId)
          : ownerOverride.media.map((item) => item.id);
      if (ids.length > 500) return protect("coverage_requires_review");
      const snapshots = await context.db.mediaItem.findMany({
        where: { id: { in: ids } },
        include: mediaInclude,
      });
      const target = snapshots.find((item) => item.id === input.mediaId);
      if (target?.intent?.generation !== input.generation)
        return {
          status: "obsolete",
          decisionId: null,
          wakeAt: null,
          reason: "intent_obsolete",
        };
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
      for (const id of ids) {
        const watch = await observeRequesterWatch(context, id);
        if (!watch.complete)
          return protect(
            incompleteWatchReason({
              quarantined: target.availability === "quarantined",
              reason: watch.reason,
            }),
          );
      }
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
