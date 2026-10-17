import type { MediaActor } from "./auth.ts";
import type {
  CommandResult,
  NotificationPreferences,
  UpdateNotificationPreferences,
} from "#shared/api.ts";

export type NotificationApplication = {
  preferences: (actor: MediaActor) => Promise<NotificationPreferences>;
  updatePreferences: (
    actor: MediaActor,
    key: string,
    input: UpdateNotificationPreferences,
  ) => Promise<CommandResult>;
  requestEmailVerification: (
    actor: MediaActor,
    key: string,
    email: string,
  ) => Promise<CommandResult>;
  verifyEmail: (actor: MediaActor, token: string) => Promise<CommandResult>;
  startDiscordLink: (
    actor: MediaActor,
  ) => Promise<{ authorizationUrl: string }>;
  completeDiscordLink: (
    actor: MediaActor,
    input: { code: string; state: string; issuer: string },
  ) => Promise<CommandResult>;
  unlinkDiscord: (actor: MediaActor) => Promise<CommandResult>;
  retryDelivery: (
    actor: MediaActor,
    key: string,
    id: string,
    expectedVersion: number,
  ) => Promise<CommandResult>;
  reconcileDelivery: (
    actor: MediaActor,
    key: string,
    id: string,
    input: { expectedVersion: number; receipt?: string },
  ) => Promise<CommandResult>;
};

export type DiscordIdentityProvider = {
  authorizationUrl: (state: string) => string;
  exchangeCode: (code: string) => Promise<{ id: string }>;
};
