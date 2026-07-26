import { z } from "zod";
import type {
  DiscordTopologyEvent,
  GatewayHealthEvent,
  ProducerHealthEvent,
} from "@shepherdjerred/discord-stream-lifecycle/types";
import type {
  Source,
  SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { Chapter } from "@shepherdjerred/streambot/sources/chapters.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";

/** Loop mode: off (drop finished), track (replay current), queue (cycle the whole queue). */
export const LoopModeSchema = z.enum(["off", "track", "queue"]);
export type LoopMode = z.infer<typeof LoopModeSchema>;

/** What kind of failure last occurred — used to drive the public "blocked" shaming message. */
export type ErrorKind = "blocked" | "generic" | "crash" | "stall" | "timeout";

/**
 * Which ffmpeg pipeline a stream segment runs on. The recovery ladder walks these in order of
 * quality: `hw` (full-GPU: decode/scale/tonemap/encode on device surfaces, ~6x realtime headroom
 * on 4K HDR) → `hw-upload` (GPU decode to system memory + `hwupload` back for GPU filters/encode
 * — immune to ffmpeg's mid-stream hwaccel-flip renegotiation crash, ~1.3x realtime) → `sw`
 * (software decode/scale/tonemap, GPU encode via outFilters hwupload — the last resort).
 */
export type PipelineMode = "hw" | "hw-upload" | "sw";

/** Why a crash-recovery retry (or give-up) happened — drives the user-facing announcement. */
export type CrashReason = "crash" | "ended-short" | "stall";

/**
 * One-shot notice that a stream segment died and what the machine did about it. The status
 * reporter announces each distinct `nonce` exactly once (same pattern as `blockedNonce`).
 */
export type CrashNotice = {
  readonly nonce: number;
  readonly kind: "retry" | "gave-up";
  readonly reason: CrashReason;
  readonly title: string;
  /** Position (seconds) playback had reached when the segment died. */
  readonly positionSeconds: number;
  /** 1-based retry attempt this notice announces (for `retry`) or the total attempts spent. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Pipeline the retry will use (for `retry`) or the last one tried (for `gave-up`). */
  readonly pipelineMode: PipelineMode;
};

/**
 * Opaque handle to an active voice connection, produced by the `joinVoice` actor and consumed by
 * `runStream` / `leaveVoice`. The machine only passes it around.
 */
export type VoiceHandle = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
};

/** A subtitle track staged to a safe file, ready to burn into the video. */
export type ResolvedSubtitle = {
  /** Safe file the ffmpeg `subtitles` filter reads — a staged temp copy or a persistent cache entry. */
  readonly path: string;
  /**
   * Temp file to unlink once the stream ends — set only for one-shot staged copies (sidecars, yt-dlp
   * downloads, uncached embedded extracts; never a user file). Absent for a persistent subtitle-cache
   * entry, which must survive for the next play.
   */
  readonly cleanupPath?: string;
};

/** A source resolved to something ffmpeg can read (a local path or a direct stream URL). */
export type ResolvedSource = {
  readonly title: string;
  readonly ffmpegInput: string;
  /** Chapter markers (ffprobe for files, yt-dlp for URLs); empty when none are available. */
  readonly chapters: readonly Chapter[];
  /** Burnable subtitle for this source, if one was found and subtitles are enabled. */
  readonly subtitle?: ResolvedSubtitle;
  /**
   * Input is HDR (PQ/HLG transfer, from the resolve-time ffprobe). Drives the HDR→SDR tonemap in
   * the stream pipeline; absent (probe failed or SDR) → no tonemap.
   */
  readonly hdr?: boolean;
  /**
   * Media duration (seconds, from the resolve-time ffprobe). Lets the streamer distinguish a real
   * end of media from a premature exit-0 truncation (network URL expiry, container short-read).
   * Absent when the probe failed or the source has no known duration (live streams).
   */
  readonly durationSeconds?: number;
};

/** A queue entry: a requested source plus who asked for it. */
export type QueuedSource = {
  readonly source: Source;
  readonly requesterId: UserId;
  /**
   * Already-resolved result from synchronous pre-validation at queue time (`/stream play`'s
   * yt-dlp call before acking). When present, the `resolving` state's actor returns it directly
   * instead of re-fetching — cleared after its first use so a later loop/requeue of the same item
   * re-resolves (a signed yt-dlp URL can expire by then).
   */
  readonly preResolved?: ResolvedSource;
};

export type PlaybackContext = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly idleTimeoutMs: number;
  /** Wedge guards for the invoked actors — no state may hold a hung actor forever. */
  readonly wedgeTimeoutsMs: {
    readonly join: number;
    readonly resolve: number;
    readonly leave: number;
  };
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
  /**
   * One-shot seek offset (seconds) applied to the first stream after a resume. Set from persisted
   * state at boot, consumed when the first item starts streaming, then zeroed so loops/replays start
   * from 0.
   */
  resumeSeekSeconds: number;
  /**
   * In-process recovery attempts spent on the CURRENT item (0 = first play). Drives the pipeline
   * ladder for the next attempt and bounds the retry loop; reset when the item ends, is skipped,
   * or playback stops. Orthogonal to the per-boot resume counter (MAX_RESUME_ATTEMPTS).
   */
  crashRetries: number;
  /** One-shot crash/retry notice for the status reporter; null until the first crash. */
  crashNotice: CrashNotice | null;
};

export type PlaybackEvent =
  | {
      type: "ADD";
      source: Source;
      requesterId: UserId;
      preResolved?: ResolvedSource;
    }
  | {
      type: "ADD_NEXT";
      source: Source;
      requesterId: UserId;
      preResolved?: ResolvedSource;
    }
  | { type: "SKIP" }
  | { type: "STOP" }
  | { type: "REMOVE"; index: number }
  | { type: "CLEAR" }
  | { type: "MOVE"; from: number; to: number }
  | { type: "SHUFFLE" }
  | { type: "SET_LOOP"; mode: LoopMode }
  | { type: "SET_VOLUME"; volume: number }
  | {
      type: "CHANGE_SUBTITLES";
      subtitles: SubtitlePref | undefined;
      positionSeconds: number;
    }
  | DiscordTopologyEvent
  | GatewayHealthEvent
  | ProducerHealthEvent
  | { type: "SHUTDOWN" };

export type PlaybackInput = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly idleTimeoutMs: number;
  /** Queue to start with (resume) — the in-progress item, if any, goes at index 0. */
  readonly initialQueue?: QueuedSource[];
  /** Loop mode to start with (resume). */
  readonly initialLoop?: LoopMode;
  /** Volume to start with (resume). */
  readonly initialVolume?: number;
  /** One-shot seek (seconds) for the first streamed item (resume position). */
  readonly initialSeekSeconds?: number;
  /** Wedge-timeout overrides (tests use small values; production takes the defaults). */
  readonly wedgeTimeoutsMs?: {
    readonly join?: number;
    readonly resolve?: number;
    readonly leave?: number;
  };
};

export type JoinVoiceInput = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
};
export type ResolveSourceInput = {
  readonly source: Source;
  readonly preResolved?: ResolvedSource;
};
export type RunStreamInput = {
  readonly voice: VoiceHandle;
  readonly resolved: ResolvedSource;
  readonly volume: number;
  /** Offset (seconds) to start playback at — >0 only for the first item after a resume. */
  readonly seekSeconds: number;
  /** Pipeline for this attempt (the machine walks hw → hw-upload → sw across crash retries). */
  readonly pipelineMode: PipelineMode;
};
export type LeaveVoiceInput = { readonly voice: VoiceHandle };
