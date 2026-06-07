import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

/**
 * Opaque handle to an active voice connection, produced by the `joinVoice` actor and consumed by
 * `runStream` / `leaveVoice`. The real implementation (PR: streamer) wraps the selfbot streamer;
 * the machine only passes it around.
 */
export type VoiceHandle = {
  readonly guildId: string;
  readonly channelId: string;
};

/** A source resolved to something ffmpeg can read (a local path or a direct stream URL). */
export type ResolvedSource = {
  readonly title: string;
  readonly ffmpegInput: string;
};

/** A queue entry: a requested source plus who asked for it. */
export type QueuedSource = {
  readonly source: Source;
  readonly requesterId: string;
};

export type PlaybackContext = {
  readonly guildId: string;
  readonly channelId: string;
  queue: QueuedSource[];
  current: QueuedSource | null;
  voice: VoiceHandle | null;
  resolved: ResolvedSource | null;
  lastError: string | null;
};

export type PlaybackEvent =
  | { type: "ADD"; source: Source; requesterId: string }
  | { type: "SKIP" }
  | { type: "STOP" };

export type PlaybackInput = {
  readonly guildId: string;
  readonly channelId: string;
};

export type JoinVoiceInput = {
  readonly guildId: string;
  readonly channelId: string;
};
export type ResolveSourceInput = { readonly source: Source };
export type RunStreamInput = {
  readonly voice: VoiceHandle;
  readonly resolved: ResolvedSource;
};
export type LeaveVoiceInput = { readonly voice: VoiceHandle };
