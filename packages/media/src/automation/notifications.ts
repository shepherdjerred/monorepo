import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { NotificationContext } from "./notifications/types.ts";
import {
  composeMessage,
  deliveryInclude,
  type Message,
} from "./notifications/message.ts";
import { deliveryRuntimeActive, lockDelivery } from "./notifications/locks.ts";
import { reconcileDelivery } from "./notifications/reconcile.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";

const result = (
  status: "accepted" | "failed" | "unknown",
  reason: string | null = null,
) => ({ status, reason });
const fingerprint = (context: NotificationContext, message: Message) =>
  context.cipher.fingerprint(
    `${message.channel}:${message.recipient}`,
    "notification-recipient",
  );

export function createNotificationActivities(
  context: NotificationContext,
): Pick<MediaNetworkActivities, "deliverMediaNotification"> {
  return {
    async deliverMediaNotification(input) {
      const snapshot = await context.db.notificationDelivery.findUniqueOrThrow({
        where: { id: input.notificationId },
        include: deliveryInclude,
      });
      if (["sending", "unknown", "accepted"].includes(snapshot.state))
        return reconcileDelivery(context, snapshot);
      if (snapshot.state === "failed")
        return result("failed", "delivery_requires_explicit_retry");
      if (snapshot.state !== "pending")
        throw new Error("Unknown notification state");
      const authority = await runtimeAuthority(context.db);
      if (!authority.active || authority.epoch !== snapshot.recoveryEpoch)
        return result("failed", "notification_runtime_protected");
      const claim = await context.db.$transaction(async (tx) => {
        const delivery = await lockDelivery(tx, snapshot.id);
        if (delivery.state !== "pending") return null;
        if (!(await deliveryRuntimeActive(tx, delivery.recoveryEpoch)))
          return null;
        const message = await composeMessage(tx, context, delivery);
        if (message === null) {
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              state: "failed",
              failureReason: "recipient_or_event_unavailable",
              version: { increment: 1 },
            },
          });
          return null;
        }
        const recipientFingerprint = fingerprint(context, message);
        const attempt = await tx.notificationDeliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber: delivery.attempts + 1,
            recoveryEpoch: delivery.recoveryEpoch,
            recipientFingerprint,
            state: "sending",
            startedAt: new Date(),
          },
        });
        await tx.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            state: "sending",
            attempts: { increment: 1 },
            recipientFingerprint,
            failureReason: null,
            version: { increment: 1 },
          },
        });
        return { attemptId: attempt.id, recipientFingerprint };
      });
      if (claim === null)
        return result("failed", "notification_runtime_or_event_protected");
      try {
        return await context.db.$transaction(
          async (tx) => {
            const delivery = await lockDelivery(tx, snapshot.id);
            const current = await deliveryRuntimeActive(
              tx,
              delivery.recoveryEpoch,
            );
            const message = current
              ? await composeMessage(tx, context, delivery)
              : null;
            if (
              message === null ||
              delivery.state !== "sending" ||
              fingerprint(context, message) !== claim.recipientFingerprint
            ) {
              await tx.notificationDeliveryAttempt.update({
                where: { id: claim.attemptId },
                data: {
                  state: "rejected",
                  rejectionReason: "authority_changed_before_send",
                  finishedAt: new Date(),
                },
              });
              await tx.notificationDelivery.update({
                where: { id: delivery.id },
                data: {
                  state: "failed",
                  failureReason: "authority_changed_before_send",
                  version: { increment: 1 },
                },
              });
              return result("failed", "authority_changed_before_send");
            }
            const sent = await context.notify({
              ...message,
              idempotencyKey: claim.attemptId,
            });
            const receipt = z.string().min(1).max(1000).parse(sent.receipt);
            // Independent durable receipt survives a subsequent transaction commit failure.
            await context.db.notificationDeliveryAttempt.update({
              where: { id: claim.attemptId },
              data: { providerReceipt: receipt },
            });
            await tx.notificationDeliveryAttempt.update({
              where: { id: claim.attemptId },
              data: { state: "accepted", finishedAt: new Date() },
            });
            await tx.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                state: "accepted",
                providerReceipt: receipt,
                acceptedAt: new Date(),
                version: { increment: 1 },
              },
            });
            return result("accepted");
          },
          { timeout: 45_000 },
        );
      } catch (error) {
        const rejected =
          error instanceof IntegrationError &&
          ["authentication", "rate-limited", "interaction-required"].includes(
            error.kind,
          );
        const preservedAcceptance = await context.db.$transaction(
          async (tx) => {
            const delivery = await lockDelivery(tx, snapshot.id);
            if (delivery.state === "accepted") return true;
            const latest = await tx.notificationDeliveryAttempt.findFirst({
              where: { deliveryId: delivery.id },
              orderBy: { attemptNumber: "desc" },
            });
            if (latest?.id !== claim.attemptId || latest.state !== "sending")
              return false;
            await tx.notificationDeliveryAttempt.updateMany({
              where: { id: claim.attemptId, state: "sending" },
              data: {
                state: rejected ? "rejected" : "unknown",
                rejectionReason: rejected
                  ? "provider_rejected"
                  : "provider_outcome_unknown",
                finishedAt: new Date(),
              },
            });
            await tx.notificationDelivery.updateMany({
              where: { id: snapshot.id, state: "sending" },
              data: {
                state: rejected ? "failed" : "unknown",
                failureReason: rejected
                  ? "provider_rejected"
                  : "provider_outcome_unknown",
                version: { increment: 1 },
              },
            });
            return false;
          },
        );
        if (preservedAcceptance) return result("accepted");
        return result(
          rejected ? "failed" : "unknown",
          rejected ? "delivery_rejected" : "delivery_outcome_unknown",
        );
      }
    },
  };
}
