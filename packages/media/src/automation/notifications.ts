import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { MediaAutomationContext } from "./context.ts";

type Context = Pick<
  MediaAutomationContext,
  "db" | "cipher" | "publicOrigin" | "notify"
>;
type Delivery = Awaited<ReturnType<typeof loadDelivery>>;
async function loadDelivery(context: Context, id: string) {
  return await context.db.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: {
      event: true,
      user: { include: { notificationPreference: true } },
    },
  });
}

async function verificationMessage(
  context: Context,
  delivery: Delivery,
): Promise<{
  channel: "email";
  recipient: string;
  subject: string;
  text: string;
} | null> {
  if (delivery.channel !== "email")
    throw new Error("Verification delivery channel is invalid");
  const { verificationId } = z
    .object({ verificationId: z.string() })
    .parse(delivery.event.payload);
  const verification = await context.db.emailVerification.findUnique({
    where: { id: verificationId },
  });
  if (
    verification?.userId !== delivery.userId ||
    verification.expiresAt <= new Date()
  )
    return null;
  const url = new URL("/notifications/email", context.publicOrigin);
  url.hash = new URLSearchParams({
    verify: context.cipher.decrypt(
      verification.encryptedToken,
      `email:${verification.id}`,
    ),
  }).toString();
  return {
    channel: "email",
    recipient: verification.email,
    subject: "Verify your Media email",
    text: `Verify this address while signed in to Media: ${url.toString()}`,
  };
}

async function warningCurrent(
  context: Context,
  delivery: Delivery,
): Promise<boolean> {
  if (delivery.event.kind !== "retention_warning") return true;
  const { decisionId, generation } = z
    .object({ decisionId: z.string(), generation: z.number().int() })
    .parse(delivery.event.payload);
  const decision = await context.db.retentionDecision.findUnique({
    where: { id: decisionId },
    include: { media: { include: { intent: true } } },
  });
  return (
    decision?.mediaId === delivery.event.mediaId &&
    decision.generation === generation &&
    decision.media.intent?.generation === generation &&
    ["warning_pending", "grace_period"].includes(decision.state)
  );
}

async function compose(context: Context, delivery: Delivery) {
  const channel = z.enum(["email", "discord"]).parse(delivery.channel);
  if (delivery.event.kind === "email_verification")
    return await verificationMessage(context, delivery);
  if (delivery.event.mediaId === null)
    throw new Error("Media notification has no media identity");
  const media = await context.db.mediaItem.findUniqueOrThrow({
    where: { id: delivery.event.mediaId },
  });
  const preference = delivery.user.notificationPreference;
  const recipient =
    channel === "email" ? delivery.user.email : delivery.user.discordId;
  const enabled =
    channel === "email"
      ? preference?.emailEnabled === true &&
        delivery.user.emailVerifiedAt !== null
      : preference?.discordEnabled === true;
  if (recipient === null || !enabled) return null;
  if (!(await warningCurrent(context, delivery))) return null;
  const descriptions: Record<string, string> = {
    media_available: "is available in Plex",
    media_upgraded: "has been upgraded in Plex",
    acquisition_failed: "needs attention",
    retention_warning:
      "is eligible for removal after at least seven days. Open Media to Keep it or pin it",
    files_quarantined:
      "has moved to quarantine and can be restored for seven days",
    files_purged: "has been removed",
  };
  const description = descriptions[delivery.event.kind];
  if (description === undefined)
    throw new Error("Unknown media notification event");
  if (delivery.event.kind === "media_upgraded" && preference?.upgrades !== true)
    return null;
  if (
    ["files_quarantined", "files_purged"].includes(delivery.event.kind) &&
    preference?.removalCompleted !== true
  )
    return null;
  const url = new URL(
    `/media/${encodeURIComponent(media.id)}`,
    context.publicOrigin,
  );
  return {
    channel,
    recipient,
    subject: `Media: ${media.title.slice(0, 200)}`,
    text: `${media.title} ${description}.\n${url.toString()}`,
  };
}

export function createNotificationActivities(
  context: Context,
): Pick<MediaNetworkActivities, "deliverMediaNotification"> {
  return {
    async deliverMediaNotification(input) {
      const delivery = await loadDelivery(context, input.notificationId);
      if (delivery.state === "accepted")
        return { status: "accepted", reason: null };
      if (["sending", "unknown"].includes(delivery.state))
        return { status: "unknown", reason: "delivery_outcome_unknown" };
      if (delivery.state === "failed")
        return { status: "failed", reason: "delivery_requires_explicit_retry" };
      if (delivery.state !== "pending")
        throw new Error("Unknown notification delivery state");
      const message = await compose(context, delivery);
      if (message === null) {
        await context.db.notificationDelivery.updateMany({
          where: { id: delivery.id, state: "pending" },
          data: { state: "failed" },
        });
        return { status: "failed", reason: "recipient_or_event_unavailable" };
      }
      // Commit before the external send. A killed worker leaves 'sending', requiring reconciliation.
      const claim = await context.db.notificationDelivery.updateMany({
        where: { id: delivery.id, state: "pending" },
        data: { state: "sending", attempts: { increment: 1 } },
      });
      if (claim.count !== 1)
        return { status: "unknown", reason: "delivery_already_claimed" };
      try {
        const result = await context.notify({
          ...message,
          idempotencyKey: delivery.id,
        });
        const receipt = z.string().min(1).max(1000).parse(result.receipt);
        await context.db.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            state: "accepted",
            providerReceipt: receipt,
            acceptedAt: new Date(),
          },
        });
        return { status: "accepted", reason: null };
      } catch (error) {
        const knownRejection =
          error instanceof IntegrationError &&
          ["authentication", "rate-limited", "interaction-required"].includes(
            error.kind,
          );
        const state = knownRejection ? "failed" : "unknown";
        await context.db.notificationDelivery.updateMany({
          where: { id: delivery.id, state: "sending" },
          data: { state },
        });
        return {
          status: state,
          reason: knownRejection
            ? "delivery_rejected"
            : "delivery_outcome_unknown",
        };
      }
    },
  };
}
