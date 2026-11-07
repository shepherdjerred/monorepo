import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

/** Actual verification delivery, token consumption and opt-in; only the email transport is synthetic. */
export async function enableMovieFixtureEmail(
  initial: MediaAutomationContext,
  actor: MediaActor,
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Synthetic Media personal notification target"),
  });
  const messages: Parameters<MediaAutomationContext["notify"]>[0][] = [];
  const context: MediaAutomationContext = {
    ...initial,
    publicOrigin: server.url.origin,
    notify: (message, mutation) => {
      if (mutation === undefined)
        throw new Error("Actual personal notification mutation guard missing");
      mutation.beforeMutation();
      messages.push(message);
      return Promise.resolve({
        receipt: `synthetic-caption-email-${String(messages.length)}`,
      });
    },
  };
  try {
    const service = new PrismaNotificationApplication(
      context.db,
      context.cipher,
      null,
      { publicOrigin: context.publicOrigin },
    );
    const queued = await service.requestEmailVerification(
      actor,
      crypto.randomUUID(),
      "caption-owner@example.test",
    );
    const delivery = await context.db.notificationDelivery.findFirstOrThrow({
      where: { userId: actor.id, event: { kind: "email_verification" } },
    });
    const sent = await createNotificationActivities(
      context,
    ).deliverMediaNotification({
      operationId: z.uuid().parse(queued.operationId),
      notificationId: delivery.id,
    });
    if (sent.status !== "accepted")
      throw new Error(
        `Actual verification delivery protected: ${JSON.stringify(sent)}`,
      );
    const message = messages[0];
    if (message === undefined)
      throw new Error("Actual verification delivery omitted its message");
    const url = new URL(
      z.string().parse(/http:\/\/\S+/u.exec(message.text)?.[0]),
    );
    const page = await fetch(url);
    if (page.status !== 200)
      throw new Error("Actual notification target must return HTTP200");
    await service.verifyEmail(
      actor,
      z
        .string()
        .min(1)
        .parse(new URLSearchParams(url.hash.slice(1)).get("verify")),
    );
    const preferences = await service.preferences(actor);
    await service.updatePreferences(actor, crypto.randomUUID(), {
      expectedVersion: preferences.version,
      emailEnabled: true,
      discordEnabled: false,
      upgrades: false,
      removalCompleted: false,
    });
    messages.length = 0;
    return { context, messages, close: () => server.stop(true) };
  } catch (error) {
    await server.stop(true);
    throw error;
  }
}
