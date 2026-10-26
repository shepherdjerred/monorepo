import { z } from "zod";
import type { Prisma, RetentionDecision } from "#generated/prisma/client.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { defaultIntent, defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { evaluateRetention, RETENTION_DEFAULTS } from "#domain/retention.ts";
import {
  requestFulfillment,
  currentFulfillmentAsset,
} from "#automation/editions/fulfillment.ts";
import { createWarning } from "#automation/notifications/retention-warning.ts";
import { boundRequesterWatch, type assertBoundMediaCohort } from "./binding.ts";
import { lineageResolved, type Media } from "./scope.ts";

export type RetentionResult = Awaited<
  ReturnType<MediaNetworkActivities["evaluateMediaRetention"]>
>;
type Result = RetentionResult;
export const RetentionEvidenceSchema = z
  .object({ warningEventId: z.string() })
  .catchall(z.json());
const EvidenceSchema = RetentionEvidenceSchema;
const protect = (reason: string): Result => ({
  status: "protected",
  reason,
  decisionId: null,
  wakeAt: null,
});

function quarantineDeadline(decision: RetentionDecision): number | null {
  return decision.quarantinedAt === null ||
    decision.purgeAfter === null ||
    decision.manifest === null
    ? null
    : Math.max(
        decision.purgeAfter.getTime(),
        decision.quarantinedAt.getTime() + RETENTION_DEFAULTS.quarantineMs,
      );
}

function ownedRetentionAssets(item: Media): boolean {
  return (
    item.assets.length > 0 &&
    item.assets.every(
      ({ asset }) =>
        asset.owned &&
        asset.edition === "default" &&
        asset.checksum !== null &&
        ["published", "quarantined"].includes(asset.state),
    )
  );
}

export async function evaluateRetentionItem(
  tx: Prisma.TransactionClient,
  item: Media,
  authority: {
    epoch: number;
    timestamp: Date;
    movieAccess: MovieChoiceAccess | undefined;
    captureFreshness: (freshness: MovieChoiceFreshness) => void;
    binding: Awaited<ReturnType<typeof assertBoundMediaCohort>>;
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
  const binding = authority.binding.members.find(
    (value) => value.authority.binding.scope.mediaId === item.id,
  );
  if (binding === undefined)
    throw new Error("Retention omitted a bound cohort member");
  const watches = new Map<
    string,
    Awaited<ReturnType<typeof boundRequesterWatch>>
  >();
  for (const request of item.requests)
    watches.set(
      request.userId,
      await boundRequesterWatch(tx, binding, request.userId),
    );
  const evaluation = evaluateRetention({
    now: timestamp.getTime(),
    generation,
    decisionGeneration: decision?.generation ?? generation,
    owned: ownedRetentionAssets(item),
    identityConfirmed: true,
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
        const watch = watches.get(claim.userId);
        const accepted = deliveries.find(
          (delivery) => delivery.userId === claim.userId,
        );
        return {
          userId: claim.userId,
          owner: claim.user.role === "owner",
          watched: watch?.watched ?? null,
          observedAt:
            watch === null || watch === undefined
              ? null
              : Date.parse(watch.observedAt),
          warningAcceptedAt: accepted?.acceptedAt?.getTime() ?? null,
          warningFailed: accepted === undefined,
          fulfillment: fulfilled,
        };
      }),
  });
  if (evaluation.state === "protected") return protect(evaluation.reason);
  decision ??= await createWarning(tx, item, {
    generation,
    epoch,
    binding: authority.binding,
  });
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
    const purgeAt = quarantineDeadline(decision);
    if (purgeAt === null) return protect("quarantine_manifest_missing");
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
