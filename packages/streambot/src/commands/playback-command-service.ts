import {
  classifyPlayError,
  isHttpUrl,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  BlockedSourceError,
  isBlockedSource,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { findBestMatch } from "@shepherdjerred/streambot/sources/library.ts";
import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";
import {
  sourceLabel,
  withMode,
  withSpoken,
  type Source,
  type SubtitlePref,
  withSubtitles,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  inferMediaIntent,
  type MediaIntent,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type {
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  PlaybackCommandBlockedError,
  PlaybackCommandBoundaryError,
} from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { PlaybackControls } from "@shepherdjerred/streambot/commands/playback-controls.ts";
import type { PlaybackCommandResult } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { SportsProvider } from "@shepherdjerred/streambot/sports/types.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import {
  assertSportsSubtitleOptions,
  selectDirectRequestUrl,
  selectSportsForRequest,
  selectSportsSourceOverride,
} from "@shepherdjerred/streambot/sports/playback-selection.ts";
import { sportsListingText } from "@shepherdjerred/streambot/sports/listing-text.ts";
import {
  markReplacedRequest,
  recordFailed,
  recordRequest,
  toRecordMedia,
} from "@shepherdjerred/streambot/commands/playback-recording.ts";
import { searchMediaText } from "@shepherdjerred/streambot/discovery/search-media-text.ts";
import { playbackTransport } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { assertNumberedPlayback } from "@shepherdjerred/streambot/commands/numbered-playback.ts";
import { requestedPlayMode } from "@shepherdjerred/streambot/commands/play-mode.ts";

const RESOLVE_TIMEOUT_MS = 30_000;

export type VoicePlaySource = "auto" | "history" | "local" | "youtube";
export type VoicePlayPlacement = "queue" | "next" | "now";

type PlayInput = {
  readonly query: string;
  readonly source: VoicePlaySource;
  readonly placement: VoicePlayPlacement;
  readonly userId: UserId;
  readonly sourceOverride?: Source;
  readonly signal?: AbortSignal;
  /** Slash commands may still supply supported URLs; spoken commands never may. */
  readonly spoken?: boolean;
  /** Full spoken command after the wake prefix, used to honour “watch” over a model `mode: video`. */
  readonly utterance?: string;
  readonly subtitles?: SubtitlePref;
  /** Per-request transport override; `undefined` and `"auto"` both mean "let the classifier decide". */
  readonly mode?: MediaMode;
  readonly provider?: SportsProvider | "auto";
};

type SelectedMedia = {
  readonly source: Source;
  readonly candidate?: MediaCandidate;
  readonly sports: boolean;
  readonly preResolved?: ResolvedSource;
};

type ResolvePlayableInput = {
  readonly source: Source;
  readonly preResolved?: ResolvedSource;
  readonly play: PlayInput;
  readonly query: string;
  readonly intent: MediaIntent;
  readonly scope: DiscoveryScope | null;
};

export function normalizeVoicePlayQuery(query: string): string {
  const normalized = query.trim();
  if (normalized.length === 0)
    throw new PlaybackCommandBoundaryError("Say what you want me to play.");
  if (isHttpUrl(normalized)) {
    throw new PlaybackCommandBoundaryError("Say a title instead of a URL.");
  }
  return normalized;
}

/**
 * Explicit music/video beats a spoken verb; `"auto"` is the slash default, so it defers.
 * Spoken listen/watch comes from the full utterance, not the title-only search query.
 * A spoken listen/watch verb wins over a conflicting model mode. A spoken model
 * `mode: video` is ignored unless the utterance asked to watch.
 */

/** Permission-checked operations shared by slash commands and the voice agent. */
export class PlaybackCommandService extends PlaybackControls {
  private clarificationGeneration = 0;
  private assertCurrent(): void {
    this.deps.assertCurrent?.();
  }

  async isAssistantV2Enabled(userId: UserId): Promise<boolean> {
    const scope = this.scope(userId);
    return (
      scope === null ||
      this.deps.featureGate === undefined ||
      (await this.deps.featureGate.assistantV2(scope))
    );
  }

  clarificationVersion(): number {
    return this.clarificationGeneration;
  }

  assertCanPlayNow(userId: UserId): void {
    const current = this.deps.view().current;
    if (current !== null && !this.canControl(userId, current.requesterId)) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can replace the current video.",
      );
    }
  }

  /**
   * The transport mode actually stamped onto a request.
   *
   * When `streambot-music-over-voice-enabled` is off for this scope, every item is forced to
   * `video`, which is exactly the behaviour that shipped before the transport split — so turning
   * the feature off is a flag flip rather than a deploy. The mode is stamped onto the `Source` here
   * rather than consulted at play time, so an item already sitting in the queue keeps the transport
   * it was queued with instead of changing under a flag flip mid-queue.
   *
   * An explicit `video` request short-circuits: it needs no flag lookup, because it asks for the
   * behaviour the flag falls back to anyway.
   */
  async resolveMediaMode(
    userId: UserId,
    requested: MediaMode | undefined,
  ): Promise<MediaMode | undefined> {
    if (this.deps.playbackChannel !== undefined)
      return playbackTransport(this.deps.playbackChannel);
    if (requested === "video") return "video";
    // `"auto"` is the slash command's default, not a choice: normalize it away so an untouched
    // option does not write a redundant `"mode":"auto"` into every persisted source and history
    // row. `undefined` and `"auto"` are already indistinguishable to the classifier.
    const explicit = requested === "auto" ? undefined : requested;
    const scope = this.scope(userId);
    if (scope === null || this.deps.featureGate === undefined) return explicit;
    return (await this.deps.featureGate.musicOverVoice(scope))
      ? explicit
      : "video";
  }

  async play(input: PlayInput): Promise<PlaybackCommandResult> {
    input.signal?.throwIfAborted();
    const query = this.normalizePlayQuery(input);
    const intent = inferMediaIntent({
      query,
      source: input.source,
      placement: input.placement,
    });
    const scope = this.scope(input.userId);
    const selected = await this.selectMedia(input, query, intent, scope);
    assertNumberedPlayback(
      this.deps.playbackChannel,
      input.spoken === true ? undefined : input.mode,
      selected.sports,
    );
    assertSportsSubtitleOptions(selected.sports, input.subtitles);
    const source = withSpoken(
      withMode(
        withSubtitles(selected.source, input.subtitles),
        await this.resolveMediaMode(
          input.userId,
          selected.sports ? "video" : requestedPlayMode(input, intent, query),
        ),
      ),
      input.spoken === true,
    );
    if (isBlockedSource(source)) {
      await this.announceBlocked(input.userId);
    }
    const preResolved = await this.resolvePlayable({
      source,
      play: input,
      query,
      intent,
      scope,
      ...(selected.preResolved === undefined
        ? {}
        : { preResolved: selected.preResolved }),
    });
    input.signal?.throwIfAborted();
    if (input.placement === "now") this.assertCanPlayNow(input.userId);
    this.assertCurrent();
    const requestId = selected.sports
      ? undefined
      : await recordRequest({
          deps: this.deps,
          scope,
          query,
          intent,
          media: toRecordMedia(source, preResolved, selected.candidate),
        });
    this.assertCurrent();
    if (input.placement === "now") markReplacedRequest(this.deps);
    this.deps.dispatch({
      type:
        input.placement === "now"
          ? "PLAY_NOW"
          : input.placement === "next"
            ? "ADD_NEXT"
            : "ADD",
      source,
      requesterId: input.userId,
      ...(requestId === undefined ? {} : { requestId }),
      // Resolve queued sports from the stable page when playback starts, after signed URLs may expire.
      ...(preResolved === undefined ||
      (selected.sports && input.placement !== "now")
        ? {}
        : { preResolved }),
    });
    const label =
      selected.candidate?.title ?? preResolved?.title ?? sourceLabel(source);
    return this.playResult(input.placement, label);
  }

  private normalizePlayQuery(input: PlayInput): string {
    const query =
      input.spoken === false
        ? input.query.trim()
        : normalizeVoicePlayQuery(input.query);
    if (query.length === 0) {
      throw new PlaybackCommandBoundaryError("Say what you want me to play.");
    }
    return query;
  }

  private async selectMedia(
    input: PlayInput,
    query: string,
    intent: MediaIntent,
    scope: DiscoveryScope | null,
  ): Promise<SelectedMedia> {
    if (input.sourceOverride !== undefined) {
      const sportsOverride = await selectSportsSourceOverride({
        source: input.sourceOverride,
        scope,
        enabled: this.deps.featureGate?.sportsStreaming,
        signal: this.boundedSignal(input.signal),
        resolve: this.deps.resolvePlaySource,
      });
      if (sportsOverride !== null) return sportsOverride;
      return {
        source: input.sourceOverride,
        sports: false,
      };
    }
    const signal = this.boundedSignal(input.signal);
    const direct = await selectDirectRequestUrl({
      query,
      spoken: input.spoken,
      source: input.source,
      scope,
      enabled: this.deps.featureGate?.sportsStreaming,
      signal,
      resolve: this.deps.resolvePlaySource,
    });
    if (direct !== null) return direct;
    const sports = await selectSportsForRequest({
      query,
      ...(input.utterance === undefined ? {} : { utterance: input.utterance }),
      source: input.source,
      provider: input.provider,
      scope,
      enabled: this.deps.featureGate?.sportsStreaming,
      signal,
      catalog: this.deps.sports,
      resolve: this.deps.resolvePlaySource,
      onAmbiguous: () => {
        this.clarificationGeneration += 1;
      },
    });
    if (sports !== null) return { ...sports, sports: true };
    const discoveryEnabled = await this.discoveryEnabled(scope);
    if (
      !discoveryEnabled ||
      scope === null ||
      this.deps.discovery === undefined
    ) {
      return { source: this.selectSource(query, input.source), sports: false };
    }
    const result = await this.deps.discovery.resolve(
      intent,
      scope,
      this.boundedSignal(input.signal),
    );
    if (result.kind === "not-found") {
      await recordFailed({
        deps: this.deps,
        scope,
        query,
        intent,
        errorCode: "not-found",
      });
      throw new PlaybackCommandBoundaryError(
        `I couldn't find ${query} in history, the library, or YouTube.`,
      );
    }
    if (result.kind === "ambiguous") {
      this.clarificationGeneration += 1;
      await recordFailed({
        deps: this.deps,
        scope,
        query,
        intent,
        errorCode: "ambiguous",
      });
      const choices = result.candidates
        .slice(0, 3)
        .map((item, index) => `${String(index + 1)}, ${item.title}`)
        .join("; ");
      throw new PlaybackCommandBoundaryError(
        `I found a few matches: ${choices}. Say the title, or first, second, or third.`,
      );
    }
    return {
      source: result.candidate.source,
      candidate: result.candidate,
      sports: false,
    };
  }

  private async resolvePlayable(
    input: ResolvePlayableInput,
  ): Promise<ResolvedSource | undefined> {
    const { source, play, query, intent, scope } = input;
    if (input.preResolved !== undefined) return input.preResolved;
    if (source.kind === "file") return undefined;
    const signal = this.boundedSignal(play.signal);
    try {
      const resolved = await this.deps.resolvePlaySource(source, signal);
      signal.throwIfAborted();
      return resolved;
    } catch (error) {
      if (error instanceof BlockedSourceError) {
        await this.announceBlocked(play.userId);
      }
      if (scope !== null) {
        await recordFailed({
          deps: this.deps,
          scope,
          query,
          intent,
          errorCode: "resolve-failed",
        });
      }
      throw new PlaybackCommandBoundaryError(
        classifyPlayError(error, source.kind),
      );
    }
  }

  private boundedSignal(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
    return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  }

  private async discoveryEnabled(
    scope: DiscoveryScope | null,
  ): Promise<boolean> {
    return scope !== null && this.deps.featureGate !== undefined
      ? await this.deps.featureGate.assistantV2(scope)
      : this.deps.discovery !== undefined;
  }

  private playResult(
    placement: VoicePlayPlacement,
    label: string,
  ): PlaybackCommandResult {
    if (placement === "now") {
      return { outcome: "playing-now", message: `Playing ${label} now.` };
    }
    return placement === "next"
      ? { outcome: "queued-next", message: `Playing ${label} next.` }
      : { outcome: "queued", message: `Queued ${label}.` };
  }

  async previous(
    userId: UserId,
    signal?: AbortSignal,
    options?: {
      readonly spoken?: boolean;
      readonly utterance?: string;
    },
  ): Promise<PlaybackCommandResult> {
    const currentSource = this.deps.view().current?.source;
    if (
      currentSource?.kind === "url" &&
      sportsEventForSource(currentSource.url) !== null
    ) {
      throw new PlaybackCommandBoundaryError(
        "Live sports support play, skip/stop, and volume only.",
      );
    }
    const scope = this.scope(userId);
    if (scope === null || this.deps.history === undefined) {
      throw new PlaybackCommandBoundaryError(
        "Playback history is not available.",
      );
    }
    if (
      this.deps.featureGate !== undefined &&
      !(await this.deps.featureGate.history(scope))
    ) {
      throw new PlaybackCommandBoundaryError(
        "Playback history is not available.",
      );
    }
    const current = this.deps.view().current;
    const candidate = this.deps.history.previous(scope, current?.sourceId);
    if (candidate === null) {
      throw new PlaybackCommandBoundaryError("There is no previous item yet.");
    }
    return await this.play({
      query: candidate.title,
      source: "history",
      placement: "now",
      userId,
      sourceOverride: candidate.source,
      ...(signal === undefined ? {} : { signal }),
      ...(options?.spoken === true ? { spoken: true } : {}),
      ...(options?.utterance === undefined
        ? {}
        : { utterance: options.utterance }),
    });
  }

  /**
   * Same public shaming as the slash path, then a terse denial: the assistant reads boundary
   * messages aloud, and the block reason must not be spoken over voice.
   */
  private async announceBlocked(userId: UserId): Promise<never> {
    await this.deps.announce(shameMessage(userId));
    throw new PlaybackCommandBlockedError("Nope. That's not allowed.");
  }

  async searchMediaTitles(
    query: string,
    userId: UserId,
    source: VoicePlaySource,
    signal: AbortSignal,
  ): Promise<string> {
    return await searchMediaText({
      query,
      source,
      scope: this.scope(userId),
      discovery: this.deps.discovery,
      signal,
      libraryFallback: () => this.searchLibraryTitles(query, 5),
      onAmbiguous: () => {
        this.clarificationGeneration += 1;
      },
    });
  }

  async listSports(userId: UserId, signal: AbortSignal): Promise<string> {
    return await sportsListingText({
      scope: this.scope(userId),
      catalog: this.deps.sports,
      enabled: this.deps.featureGate?.sportsStreaming,
      signal: this.boundedSignal(signal),
    });
  }

  private selectSource(query: string, requested: VoicePlaySource): Source {
    if (requested !== "youtube" && requested !== "history") {
      const match = findBestMatch(this.deps.library(), query);
      if (match !== null)
        return { kind: "file", path: match.path, title: match.title };
      if (requested === "local") {
        throw new PlaybackCommandBoundaryError(
          `I couldn't find ${query} locally.`,
        );
      }
    }
    if (requested === "history") {
      throw new PlaybackCommandBoundaryError(
        `I couldn't find ${query} in your history.`,
      );
    }
    return { kind: "search", query };
  }

  private scope(userId: UserId): DiscoveryScope | null {
    return this.deps.guildId === undefined || this.deps.channelId === undefined
      ? null
      : {
          guildId: this.deps.guildId,
          channelId: this.deps.channelId,
          userId,
        };
  }
}
