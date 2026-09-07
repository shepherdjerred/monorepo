import { canControlItem } from "@shepherdjerred/streambot/discord/permissions.ts";
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
import type { RecordMedia } from "@shepherdjerred/streambot/history/media-history.ts";
import {
  PlaybackCommandBlockedError,
  PlaybackCommandBoundaryError,
} from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { PlaybackControls } from "@shepherdjerred/streambot/commands/playback-controls.ts";
import type { PlaybackCommandResult } from "@shepherdjerred/streambot/commands/playback-command-types.ts";

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
  readonly subtitles?: SubtitlePref;
  /** Per-request transport override; `undefined` and `"auto"` both mean "let the classifier decide". */
  readonly mode?: MediaMode;
};

type SelectedMedia = {
  readonly source: Source;
  readonly candidate?: MediaCandidate;
};

type ResolvePlayableInput = {
  readonly source: Source;
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

/** Permission-checked operations shared by slash commands and the voice agent. */
export class PlaybackCommandService extends PlaybackControls {
  private clarificationGeneration = 0;

  async isAssistantV2Enabled(userId: UserId): Promise<boolean> {
    const scope = this.scope(userId);
    return scope === null || this.deps.featureGate === undefined
      ? true
      : await this.deps.featureGate.assistantV2(scope);
  }

  clarificationVersion(): number {
    return this.clarificationGeneration;
  }

  assertCanPlayNow(userId: UserId): void {
    const current = this.deps.view().current;
    if (
      current !== null &&
      !canControlItem(
        userId,
        current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
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
    // Precedence: an explicit `music`/`video` beats the verb, the verb beats nothing. `"auto"` is
    // the slash command's default rather than a choice anyone made, so it defers to the spoken
    // verb instead of suppressing it — otherwise "watch the trailer" would be overridden by an
    // option the speaker never touched.
    const requestedMode =
      input.mode === undefined || input.mode === "auto"
        ? intent.mode
        : input.mode;
    const source = withMode(
      withSubtitles(selected.source, input.subtitles),
      await this.resolveMediaMode(input.userId, requestedMode),
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
    });
    input.signal?.throwIfAborted();
    if (input.placement === "now") this.assertCanPlayNow(input.userId);
    const media = this.toRecordMedia(source, preResolved, selected.candidate);
    const requestId = await this.recordRequest(scope, query, intent, media);
    if (input.placement === "now") {
      this.markReplacedRequest();
    }
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
      ...(preResolved === undefined ? {} : { preResolved }),
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
      return { source: input.sourceOverride };
    }
    if (input.spoken === false && isHttpUrl(query)) {
      if (input.source === "local" || input.source === "history") {
        throw new PlaybackCommandBoundaryError(
          "A URL cannot use the local or history source.",
        );
      }
      return { source: { kind: "url", url: query } };
    }
    const discoveryEnabled = await this.discoveryEnabled(scope);
    if (
      !discoveryEnabled ||
      scope === null ||
      this.deps.discovery === undefined
    ) {
      return { source: this.selectSource(query, input.source) };
    }
    const result = await this.deps.discovery.resolve(
      intent,
      scope,
      this.boundedSignal(input.signal),
    );
    if (result.kind === "not-found") {
      await this.recordFailed(scope, query, intent, "not-found");
      throw new PlaybackCommandBoundaryError(
        `I couldn't find ${query} in history, the library, or YouTube.`,
      );
    }
    if (result.kind === "ambiguous") {
      this.clarificationGeneration += 1;
      await this.recordFailed(scope, query, intent, "ambiguous");
      const choices = result.candidates
        .slice(0, 3)
        .map((item, index) => `${String(index + 1)}, ${item.title}`)
        .join("; ");
      throw new PlaybackCommandBoundaryError(
        `I found a few matches: ${choices}. Say first, second, or third.`,
      );
    }
    return { source: result.candidate.source, candidate: result.candidate };
  }

  private async resolvePlayable(
    input: ResolvePlayableInput,
  ): Promise<ResolvedSource | undefined> {
    const { source, play, query, intent, scope } = input;
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
        await this.recordFailed(scope, query, intent, "resolve-failed");
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
    if (scope !== null && this.deps.featureGate !== undefined) {
      return await this.deps.featureGate.assistantV2(scope);
    }
    return this.deps.discovery !== undefined;
  }

  private async recordRequest(
    scope: DiscoveryScope | null,
    query: string,
    intent: MediaIntent,
    media: RecordMedia,
  ): Promise<string | undefined> {
    if (scope === null || this.deps.history === undefined) return undefined;
    const enabled =
      this.deps.featureGate === undefined ||
      (await this.deps.featureGate.history(scope));
    return enabled
      ? this.deps.history.recordQueueRequest({
          scope,
          rawQuery: query,
          intent,
          media,
        })
      : undefined;
  }

  private markReplacedRequest(): void {
    const requestId = this.deps.view().current?.requestId;
    if (requestId !== undefined) {
      this.deps.history?.updateRequest(requestId, "skipped");
    }
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
  ): Promise<PlaybackCommandResult> {
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
    const scope = this.scope(userId);
    const discovery = this.deps.discovery;
    if (scope === null || discovery === undefined) {
      return this.searchLibraryTitles(query, 5);
    }
    const matches = await discovery.search(
      inferMediaIntent({ query, source }),
      scope,
      signal,
    );
    if (matches.length === 0) return "I couldn't find any matching media.";
    if (matches.length > 1) {
      this.clarificationGeneration += 1;
      discovery.rememberCandidates(scope, matches);
    }
    return matches
      .map(
        (candidate, index) =>
          `${String(index + 1)}. ${candidate.title}, ${candidate.reason}`,
      )
      .join("; ");
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

  private async recordFailed(
    scope: DiscoveryScope,
    query: string,
    intent: ReturnType<typeof inferMediaIntent>,
    errorCode: string,
  ): Promise<void> {
    if (
      this.deps.history === undefined ||
      (this.deps.featureGate !== undefined &&
        !(await this.deps.featureGate.history(scope)))
    ) {
      return;
    }
    this.deps.history.recordQueueRequest({
      scope,
      rawQuery: query,
      intent,
      status: "failed",
      errorCode,
    });
  }

  private toRecordMedia(
    source: Source,
    resolved: ResolvedSource | undefined,
    candidate: MediaCandidate | undefined,
  ): RecordMedia {
    const provenance = resolved?.provenance;
    return {
      title: candidate?.title ?? resolved?.title ?? sourceLabel(source),
      provider: mediaProvider(source, candidate),
      source,
      canonicalUrl: candidate?.canonicalUrl ?? provenance?.canonicalUrl,
      channel: candidate?.channel ?? provenance?.channel,
      thumbnailUrl: candidate?.thumbnailUrl ?? provenance?.thumbnailUrl,
      durationSeconds: candidate?.durationSeconds ?? resolved?.durationSeconds,
    };
  }
}

function mediaProvider(
  source: Source,
  candidate: MediaCandidate | undefined,
): RecordMedia["provider"] {
  return source.kind === "file" || candidate?.provider === "local"
    ? "local"
    : "youtube";
}
