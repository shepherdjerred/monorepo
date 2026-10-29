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
  | "serverMachineId"
  | "permittedSections"
  | "plexAccess"
  | "plexBindingExecution"
  | "movieManagement"
> & {
  /** Activity cancellation/heartbeat boundary after the durable claim, with no authority locks held. */
  checkpoint?: (phase: "notification-claimed") => Promise<void>;
};
