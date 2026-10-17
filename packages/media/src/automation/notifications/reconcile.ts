import { z } from "zod";
import type { Delivery } from "./message.ts";
import type { NotificationContext } from "./types.ts";
import { lockDelivery } from "./locks.ts";
import { deliveryAuthority } from "./authority.ts";
import { composeMessage } from "./message.ts";
import type { Prisma } from "#generated/prisma/client.ts";

async function recipientMatches(
  tx: Prisma.TransactionClient,
  context: NotificationContext,
  current: Delivery,
  fingerprint: string,
) {
  if (!["owner_health", "email_verification"].includes(current.event.kind))
    return true;
  const message = await composeMessage(tx, context, current);
  return (
    message !== null &&
    context.cipher.fingerprint(
      `${message.channel}:${message.recipient}`,
      "notification-recipient",
    ) === fingerprint
  );
}

function noReceiptResult(state: string) {
  return state === "accepted"
    ? { status: "accepted" as const, reason: null }
    : { status: "unknown" as const, reason: "delivery_receipt_required" };
}

/** Receipt reads never authorize another send, including missing/deleted provider records. */
export async function reconcileDelivery(
  context: NotificationContext,
  delivery: Delivery,
  force = false,
) {
  const special = ["owner_health", "email_verification"].includes(
    delivery.event.kind,
  );
  if (
    !special &&
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
    !special &&
    (attempt?.providerReceipt == null ||
      context.reconcileNotification === undefined)
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
      const protectedReason = await deliveryAuthority(tx, current);
      if (protectedReason !== null)
        return { status: "unknown" as const, reason: protectedReason };
      const latest = await tx.notificationDeliveryAttempt.findFirst({
        where: { deliveryId: current.id },
        orderBy: { attemptNumber: "desc" },
      });
      if (
        latest?.id !== attempt?.id ||
        !["sending", "unknown", "accepted"].includes(current.state)
      )
        return {
          status: "unknown" as const,
          reason: "receipt_authority_changed",
        };
      if (attempt === null)
        return {
          status: "unknown" as const,
          reason: "delivery_receipt_required",
        };
      if (attempt.recoveryEpoch !== current.recoveryEpoch)
        return {
          status: "unknown" as const,
          reason: "notification_attempt_epoch_changed",
        };
      if (
        !(await recipientMatches(
          tx,
          context,
          current,
          attempt.recipientFingerprint,
        ))
      )
        return {
          status: "unknown" as const,
          reason: "receipt_recipient_changed",
        };
      if (
        attempt.providerReceipt === null ||
        context.reconcileNotification === undefined
      )
        return noReceiptResult(current.state);
      const observed = await context.reconcileNotification({
        channel: z
          .enum(["email", "discord", "discord_shared"])
          .parse(delivery.channel),
        receipt: attempt.providerReceipt,
        idempotencyKey: attempt.id,
      });
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
