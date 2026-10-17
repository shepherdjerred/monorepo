import { z } from "zod";
import type { Delivery } from "./message.ts";
import type { NotificationContext } from "./types.ts";
import { deliveryRuntimeActive, lockDelivery } from "./locks.ts";

/** Receipt reads never authorize another send, including missing/deleted provider records. */
export async function reconcileDelivery(
  context: NotificationContext,
  delivery: Delivery,
  force = false,
) {
  if (
    !force &&
    delivery.state === "accepted" &&
    ["delivered", "bounced"].includes(delivery.providerStatus ?? "")
  )
    return { status: "accepted" as const, reason: null };
  const attempt = await context.db.notificationDeliveryAttempt.findFirst({
    where: { deliveryId: delivery.id },
    orderBy: { attemptNumber: "desc" },
  });
  if (
    attempt?.providerReceipt == null ||
    context.reconcileNotification === undefined
  )
    return {
      status:
        delivery.state === "accepted"
          ? ("accepted" as const)
          : ("unknown" as const),
      reason:
        delivery.state === "accepted" ? null : "delivery_receipt_required",
    };
  return await context.db.$transaction(
    async (tx) => {
      const current = await lockDelivery(tx, delivery.id);
      const latest = await tx.notificationDeliveryAttempt.findFirst({
        where: { deliveryId: current.id },
        orderBy: { attemptNumber: "desc" },
      });
      if (
        latest?.id !== attempt.id ||
        !["sending", "unknown", "accepted"].includes(current.state)
      )
        return {
          status: "unknown" as const,
          reason: "receipt_authority_changed",
        };
      if (!(await deliveryRuntimeActive(tx, current.recoveryEpoch)))
        return {
          status: "unknown" as const,
          reason: "notification_runtime_protected",
        };
      const observed = await context.reconcileNotification?.({
        channel: z
          .enum(["email", "discord", "discord_shared"])
          .parse(delivery.channel),
        receipt: attempt.providerReceipt ?? "",
        idempotencyKey: attempt.id,
      });
      if (observed === undefined) throw new Error("Receipt transport missing");
      const matches =
        observed.recipient !== null &&
        context.cipher.fingerprint(
          `${delivery.channel}:${observed.recipient}`,
          "notification-recipient",
        ) === attempt.recipientFingerprint;
      if (!matches || observed.status === "unknown")
        return {
          status: "unknown" as const,
          reason: "provider_receipt_unproven",
        };
      await tx.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { state: "accepted", finishedAt: new Date() },
      });
      await tx.notificationDelivery.update({
        where: { id: current.id },
        data: {
          state: "accepted",
          providerReceipt: attempt.providerReceipt,
          acceptedAt: current.acceptedAt ?? new Date(),
          reconciledAt: new Date(),
          providerStatus: observed.status,
          version: { increment: 1 },
        },
      });
      return {
        status: "accepted" as const,
        reason: observed.status === "bounced" ? "provider_bounced" : null,
      };
    },
    { timeout: 45_000 },
  );
}
