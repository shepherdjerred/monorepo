import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import type { PaginatedPages } from "@shepherdjerred/streambot/discord/help-text.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import type {
  VoiceDebugCaptureStatus,
  VoiceDebugStartResult,
  VoiceDebugStopResult,
} from "@shepherdjerred/streambot/voice/capture-manager.ts";

/**
 * The command layer's contract types.
 *
 * `play-command.ts` and `voice-debug-command.ts` were split out of
 * `command-handler.ts` to keep it under the max-lines cap, and both consume
 * these types while the handler imports their entry points back. Declaring the
 * contract in its own module is what stops that being an import cycle.
 */

/**
 * The minimal slash-interaction surface the handler needs — decoupled from discord.js so the
 * command logic can be unit-tested with a fake. `command-bot.ts` adapts a real
 * `ChatInputCommandInteraction` to this. Every reply is ephemeral (acks to the invoker); public
 * output is posted separately by the status reporter.
 */
export type CommandInteraction = {
  readonly userId: UserId;
  subcommand: () => string;
  subcommandGroup: () => string | null;
  getString: (name: string) => string | null;
  getInteger: (name: string) => number | null;
  getStringRequired: (name: string) => string;
  getIntegerRequired: (name: string) => number;
  /** Ephemeral ack to the invoker. */
  reply: (content: string) => Promise<void>;
  /** Defer (ephemeral) for a slow op, then `editReply`. */
  defer: () => Promise<void>;
  editReply: (content: string) => Promise<void>;
  /**
   * Edit the deferred reply to show page 1 and attach Prev/Next/First/Last buttons (when
   * `pages.length > 1`); the adapter drives the collector so handlers stay discord.js-free.
   * For a single-page result, this just edits in the one message with no buttons.
   */
  replyPaginated: (payload: PaginatedPages) => Promise<void>;
  /**
   * Edit the deferred reply to show a subtitle-track picker built from `candidates`, and resolve
   * with the user's pick (an opaque encoded track ref) once they choose, or `null` on timeout.
   */
  replySelectMenu: (
    candidates: readonly SubtitleCandidate[],
  ) => Promise<string | null>;
};

export type CommandHandlerDeps = {
  readonly config: Config;
  readonly dispatch: (event: PlaybackEvent) => void;
  readonly view: () => PlaybackView;
  readonly library: () => readonly LibraryEntry[];
  /** Apply volume to the live stream; resolves false when nothing is playing. */
  readonly setVolume: (percent: number) => Promise<boolean>;
  /** Seek the live stream to an absolute offset (seconds); resolves false when nothing is playing. */
  readonly seek: (seconds: number) => Promise<boolean>;
  /** Expand a playlist URL into items (yt-dlp), adult-filtered. */
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PlaylistItem[]>;
  /** List the source/site names yt-dlp supports (cached); backs `/stream sources`. */
  readonly listSources: (signal: AbortSignal) => Promise<readonly string[]>;
  /**
   * Synchronously resolve a url/search `/stream play` source (yt-dlp) before acking, so bad input
   * gets a specific error instead of a silent "Queued". The result is threaded onto the queued item
   * so the machine's `resolving` state reuses it instead of re-fetching.
   */
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Post a world-readable message to the status channel (shaming, etc.). */
  readonly announce: (message: string) => Promise<void>;
  /** Enumerate burnable subtitle candidates for the currently-playing item; `/stream subtitles`'s picker. */
  readonly listSubtitleCandidates: (
    signal: AbortSignal,
  ) => Promise<SubtitleCandidate[]>;
  /**
   * A stable identity (`file:<path>` / `url:<url>` / `search:<query>`) of the currently-playing
   * source, or `null` if nothing is playing. Captured when the picker opens and re-checked right
   * before dispatching `CHANGE_SUBTITLES`, so a pick built for one item is never applied to a
   * *different* item that playback advanced to during the picker's wait — even one sharing the same
   * display title. The `kind:` prefix also detects a source-kind change (which would throw in the
   * exact subtitle resolver).
   */
  readonly currentSourceId: () => string | null;
  /** True while a subtitle picker is already open for this session (single-flight guard). */
  readonly hasPendingSubtitleMenu: () => boolean;
  /** Claim the single-flight slot; returns false if one was already claimed. */
  readonly claimSubtitleMenu: () => boolean;
  /** Release the single-flight slot (call on pick, timeout, or error). */
  readonly releaseSubtitleMenu: () => void;
  readonly startVoiceDebugCapture: (
    durationSeconds: number,
  ) => VoiceDebugStartResult;
  readonly stopVoiceDebugCapture: () => VoiceDebugStopResult;
  readonly voiceDebugCaptureStatus: () => VoiceDebugCaptureStatus | null;
};
