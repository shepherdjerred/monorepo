import type { MediaAutomationContext } from "#automation/context.ts";

export type NotificationContext = Pick<
  MediaAutomationContext,
  | "db"
  | "cipher"
  | "publicOrigin"
  | "notify"
  | "sharedAnnouncements"
  | "reconcileNotification"
  | "personalDiscordAvailable"
>;
