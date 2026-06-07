import { z } from "zod";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";

/** Loop mode: off (drop finished), track (replay current), queue (cycle the whole queue). */
export const LoopModeSchema = z.enum(["off", "track", "queue"]);
export type LoopMode = z.infer<typeof LoopModeSchema>;

/** What kind of failure last occurred — used to drive the public "blocked" shaming message. */
export type ErrorKind = "blocked" | "generic";

/**
 * Opaque handle to an active voice connection, produced by the `joinVoice` actor and consumed by
 * `runStream` / `leaveVoice`. The machine only passes it around.
 */
export type VoiceHandle = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
};

/** A subtitle track staged to a safe temp file, ready to burn into the video. */
export type ResolvedSubtitle = {
  /** Safe temp file the ffmpeg `subtitles` filter reads. */
  readonly path: string;
  /** Temp file to unlink once the stream ends (always the staged copy — never a user file). */
  readonly cleanupPath: string;
};

/** A source resolved to something ffmpeg can read (a local path or a direct stream URL). */
export type ResolvedSource = {
  readonly title: string;
  readonly ffmpegInput: string;
  /** Burnable subtitle for this source, if one was found and subtitles are enabled. */
  readonly subtitle?: ResolvedSubtitle;
};

/** A queue entry: a requested source plus who asked for it. */
export type QueuedSource = {
  readonly source: Source;
  readonly requesterId: UserId;
};

export type PlaybackContext = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly idleTimeoutMs: number;
  queue: QueuedSource[];
  current: QueuedSource | null;
  voice: VoiceHandle | null;
  resolved: ResolvedSource | null;
  loop: LoopMode;
  /** Desired volume in percent (0-200); applied to each stream and changeable live. */
  volume: number;
  lastError: string | null;
  lastErrorKind: ErrorKind | null;
  /** Increments each time a blocked (adult) source is rejected — lets the reporter shame once. */
  blockedNonce: number;
  /** Who requested the most recently blocked source (for the public shaming message). */
  lastBlockedRequester: UserId | null;
};

export type PlaybackEvent =
  | { type: "ADD"; source: Source; requesterId: UserId }
  | { type: "ADD_NEXT"; source: Source; requesterId: UserId }
  | { type: "SKIP" }
  | { type: "STOP" }
  | { type: "REMOVE"; index: number }
  | { type: "CLEAR" }
  | { type: "MOVE"; from: number; to: number }
  | { type: "SHUFFLE" }
  | { type: "SET_LOOP"; mode: LoopMode }
  | { type: "SET_VOLUME"; volume: number };

export type PlaybackInput = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly idleTimeoutMs: number;
};

export type JoinVoiceInput = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
};
export type ResolveSourceInput = { readonly source: Source };
export type RunStreamInput = {
  readonly voice: VoiceHandle;
  readonly resolved: ResolvedSource;
  readonly volume: number;
};
export type LeaveVoiceInput = { readonly voice: VoiceHandle };
