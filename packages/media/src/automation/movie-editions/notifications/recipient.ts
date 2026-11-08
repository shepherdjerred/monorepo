import type { NotificationContext } from "#automation/notifications/types.ts";
import type { MovieNoticeDelivery } from "./authority.ts";

/** Event preferences and recipient authority remain with the composing caller. */
export async function movieNoticeRecipient(
  context: Pick<NotificationContext, "personalDiscordAvailable">,
  delivery: MovieNoticeDelivery,
  preference: NonNullable<
    MovieNoticeDelivery["user"]["notificationPreference"]
  >,
): Promise<{ channel: "email" | "discord"; recipient: string } | null> {
  if (delivery.channel === "email")
    return preference.emailEnabled &&
      delivery.user.emailVerifiedAt !== null &&
      delivery.user.email !== null
      ? { channel: "email", recipient: delivery.user.email }
      : null;
  if (delivery.channel === "discord")
    return preference.discordEnabled &&
      delivery.user.discordId !== null &&
      (await context.personalDiscordAvailable?.()) === true
      ? { channel: "discord", recipient: delivery.user.discordId }
      : null;
  return null;
}
