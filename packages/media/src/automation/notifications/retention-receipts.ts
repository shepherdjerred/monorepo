import type { MediaAutomationContext } from "#automation/context.ts";
import { deliveryInclude } from "./message.ts";
import { reconcileDelivery } from "./reconcile.ts";
import { z } from "zod";
import { defaultIntent } from "#shared/editions/scope.ts";

/** Read provider state again before removal; delivery acceptance can later bounce. */
export async function refreshRetentionReceipts(
  context: MediaAutomationContext,
  mediaIds: string[],
): Promise<boolean> {
  const decisions = await context.db.retentionDecision.findMany({
    where: {
      mediaId: { in: mediaIds },
      edition: "default",
      state: { in: ["warning_pending", "grace_period", "quarantined"] },
    },
    include: {
      media: {
        select: {
          intents: {
            where: { edition: "default" },
            select: { generation: true, edition: true },
          },
        },
      },
    },
  });
  const eventIds = decisions
    .filter(
      (decision) =>
        decision.generation ===
        defaultIntent(decision.media.intents)?.generation,
    )
    .map(
      (decision) =>
        z.object({ warningEventId: z.string() }).parse(decision.evidence)
          .warningEventId,
    );
  const deliveries = await context.db.notificationDelivery.findMany({
    where: {
      eventId: { in: eventIds },
      state: "accepted",
      channel: { in: ["email", "discord"] },
    },
    include: deliveryInclude,
    take: 1001,
  });
  if (deliveries.length > 1000) return false;
  for (const delivery of deliveries) {
    if (delivery.providerStatus === "bounced") continue;
    if (context.reconcileNotification === undefined) return false;
    const result = await reconcileDelivery(context, delivery, true);
    if (result.status !== "accepted") return false;
    const current = await context.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    if (
      current.reconciledAt === null ||
      current.reconciledAt.getTime() > Date.now() ||
      Date.now() - current.reconciledAt.getTime() > 60_000
    )
      return false;
  }
  return true;
}
