import type { MediaAutomationContext } from "#automation/context.ts";
import { deliveryInclude } from "./message.ts";
import { reconcileDelivery } from "./reconcile.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";
import { IntegrationError } from "#integrations/http.ts";

/** Rotate one private receipt observation per page. Existing notification
 * reconciliation owns its own locks; interest-policy locks are acquired later. */
export async function refreshInterestNoticeReceipts(
  context: MediaAutomationContext,
  eventId: string,
): Promise<boolean> {
  const event = await context.db.applicationEvent.findUnique({
    where: { id: eventId },
  });
  if (event?.kind !== "interest_check") return false;
  const notice = InterestCheckNoticeSchema.parse(event.payload);
  const deliveries = await context.db.notificationDelivery.findMany({
    where: {
      eventId,
      userId: notice.userId,
      state: "accepted",
      channel: { in: ["email", "discord"] },
    },
    include: deliveryInclude,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 1,
  });
  if (context.reconcileNotification === undefined) return false;
  const delivery = deliveries[0];
  if (delivery === undefined) return false;
  try {
    const result = await reconcileDelivery(context, delivery, true);
    if (result.status === "accepted") {
      const current = await context.db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      const timestamp = Date.now();
      if (
        current.reconciledAt !== null &&
        current.reconciledAt.getTime() <= timestamp &&
        timestamp - current.reconciledAt.getTime() <= 60_000 &&
        current.providerStatus !== "bounced"
      )
        return true;
    }
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
  }
  // Unknown receipt or an expected external outage cannot retain old acceptance
  // freshness. This does not resend or rewrite a newer concurrent observation.
  await context.db.notificationDelivery.updateMany({
    where: { id: delivery.id, version: delivery.version },
    data: {
      reconciledAt: null,
      failureReason: "private_notice_receipt_unconfirmed",
      version: { increment: 1 },
    },
  });
  return false;
}
