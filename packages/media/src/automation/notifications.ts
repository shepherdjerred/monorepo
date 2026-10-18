import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { NotificationContext } from "./notifications/types.ts";
import {
  composeMessage,
  deliveryInclude,
  eventMediaIds,
  type Message,
} from "./notifications/message.ts";
import { lockDelivery } from "./notifications/locks.ts";
import { deliveryAuthority } from "./notifications/authority.ts";
import { reconcileDelivery } from "./notifications/reconcile.ts";
import { networkMovieAccess } from "./editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";

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
      const movieAccess = [
        "media_available",
        "media_upgraded",
        "subtitles_ready",
        "retention_warning",
      ].includes(snapshot.event.kind)
        ? await networkMovieAccess(context, eventMediaIds(snapshot))
        : undefined;
      const messageContext = { ...context, movieAccess };
      const claim = await context.db
        .$transaction(async (tx) => {
          const guards: MovieChoiceFreshness[] = [];
          const delivery = await lockDelivery(tx, snapshot.id);
          if (delivery.state !== "pending") return null;
          const protectedReason = await deliveryAuthority(tx, delivery);
          if (protectedReason !== null) {
            await tx.notificationDelivery.update({
              where: { id: delivery.id },
              data: { failureReason: protectedReason },
            });
            return { protectedReason };
          }
          const message = await composeMessage(
            tx,
            {
              ...messageContext,
              captureFreshness: (guard) => guards.push(guard),
            },
            delivery,
          );
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
          for (const guard of guards) guard.assertActive();
          return { attemptId: attempt.id, recipientFingerprint };
        })
        .catch((error: unknown) => {
          if (error instanceof MovieChoiceProtection)
            return { protectedReason: error.code };
          throw error;
        });
      if (claim === null)
        return result("failed", "notification_runtime_or_event_protected");
      if ("protectedReason" in claim)
        return result("failed", claim.protectedReason);
      try {
        await context.checkpoint?.("notification-claimed");
        return await context.db.$transaction(
          async (tx) => {
            const guards: MovieChoiceFreshness[] = [];
            const delivery = await lockDelivery(tx, snapshot.id);
            const current = await deliveryAuthority(tx, delivery);
            const message =
              current === null
                ? await composeMessage(
                    tx,
                    {
                      ...messageContext,
                      captureFreshness: (guard) => guards.push(guard),
                    },
                    delivery,
                  )
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
            for (const guard of guards) guard.assertActive();
            const sent = await context.notify(
              {
                ...message,
                idempotencyKey: claim.attemptId,
              },
              {
                beforeMutation: () => {
                  for (const guard of guards) guard.assertActive();
                },
              },
            );
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
        return settleDeliveryFailure(
          context,
          { deliveryId: snapshot.id, attemptId: claim.attemptId },
          error,
        );
      }
    },
  };
}

async function settleDeliveryFailure(
  context: NotificationContext,
  input: { deliveryId: string; attemptId: string },
  error: unknown,
) {
  const choiceExpired = error instanceof MovieChoiceProtection;
  const rejected =
    choiceExpired ||
    (error instanceof IntegrationError &&
      ["authentication", "rate-limited", "interaction-required"].includes(
        error.kind,
      ));
  const preservedAcceptance = await context.db.$transaction(async (tx) => {
    const delivery = await lockDelivery(tx, input.deliveryId);
    if (delivery.state === "accepted") return true;
    const latest = await tx.notificationDeliveryAttempt.findFirst({
      where: { deliveryId: delivery.id },
      orderBy: { attemptNumber: "desc" },
    });
    if (latest?.id !== input.attemptId || latest.state !== "sending")
      return false;
    await tx.notificationDeliveryAttempt.updateMany({
      where: { id: input.attemptId, state: "sending" },
      data: {
        state: rejected ? "rejected" : "unknown",
        rejectionReason: choiceExpired
          ? "authority_changed_before_send"
          : rejected
            ? "provider_rejected"
            : "provider_outcome_unknown",
        finishedAt: new Date(),
      },
    });
    await tx.notificationDelivery.updateMany({
      where: { id: input.deliveryId, state: "sending" },
      data: {
        state: rejected ? "failed" : "unknown",
        failureReason: choiceExpired
          ? "authority_changed_before_send"
          : rejected
            ? "provider_rejected"
            : "provider_outcome_unknown",
        version: { increment: 1 },
      },
    });
    return false;
  });
  if (preservedAcceptance) return result("accepted");
  return result(
    rejected ? "failed" : "unknown",
    choiceExpired
      ? "authority_changed_before_send"
      : rejected
        ? "delivery_rejected"
        : "delivery_outcome_unknown",
  );
}
