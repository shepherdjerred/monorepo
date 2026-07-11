import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type { UserbotEntry } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";

/**
 * Immutable per-session record handed to the GameDriver on start and looked up by the
 * SessionManager for the duration of the session. `textChannelId` is the canonical
 * "where to post messages for this game" — the channel `/play` was invoked in.
 */
export type Session<TUserbot extends PooledUserbot> = {
  readonly guildId: string;
  readonly voiceChannelId: string;
  /** Channel `/play` was invoked in — bot uses it for notifications, commands, screenshots, etc. */
  readonly textChannelId: string;
  readonly startedByUserId: string;
  readonly startedAt: Date;
  readonly userbotEntry: UserbotEntry<TUserbot>;
  /** Per-guild persistence directory: `<rootDir>/<guildId>/`. Already exists on disk. */
  readonly sessionDir: string;
};

/**
 * Why a session stopped — passed to `GameDriver.onSessionStop` so drivers can choose
 * how to flush state (e.g., a `userStop` flushes saves immediately; a `gatewayDisconnect`
 * may skip writes).
 */
export type SessionStopReason =
  | "userStop"
  | "aloneInVoice"
  | "idleTimeout"
  | "shutdown"
  | "error";
