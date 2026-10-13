import type { NotificationIntentKey } from "@scout-for-lol/domain/identity/brands.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import type { Db } from "#src/database/index.ts";
import { productAnnouncementOf } from "#src/temporal/notification/product/announcement.ts";

/** Re-read under the intent fence; a stale Activity answer cannot release a live send. */
export async function settleProductAnnouncementBudget(
  db: Db,
  intentKey: NotificationIntentKey,
): Promise<void> {
  await db.$queryRaw`SELECT "intentKey" FROM "MatchNotificationIntent" WHERE "intentKey" = ${intentKey} FOR UPDATE`;
  const row = await db.matchNotificationIntent.findUniqueOrThrow({
    where: { intentKey },
  });
  if (row.kind !== "product-announcement") return;
  const record = notificationIntentRowToRecord(row);
  if (!("announcementId" in record))
    throw new Error("Product announcement has another subject");
  const { effect } = productAnnouncementOf(record);
  if (effect.kind !== "outreach") return;
  switch (record.intent.state.kind) {
    case "delivered":
      await db.dmAuditLog.update({
        where: { id: effect.auditId },
        data: { deliveryStatus: "sent" },
      });
      break;
    case "ready":
      // Only an operator's confirmed-unsent resolution returns an ambiguous
      // attempt to ready. The intent lock prevents racing the next send claim.
      await db.dmAuditLog.updateMany({
        where: { id: effect.auditId, deliveryStatus: "unknown" },
        data: { deliveryStatus: "reserved" },
      });
      break;
    case "expired":
    case "suppressed":
    case "permission-denied":
      await db.dmAuditLog.updateMany({
        where: {
          id: effect.auditId,
          deliveryStatus: { in: ["reserved", "unknown"] },
        },
        data: { deliveryStatus: "failed" },
      });
      break;
    case "pending":
    case "sending":
    case "unknown-delivery":
      break;
  }
}
