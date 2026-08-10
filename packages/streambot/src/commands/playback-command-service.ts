import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import {
  classifyPlayError,
  isHttpUrl,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import {
  nowPlayingText,
  queueText,
  type PlaybackView,
} from "@shepherdjerred/streambot/discord/queue-text.ts";
import type {
  LoopMode,
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  findBestMatch,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

const RESOLVE_TIMEOUT_MS = 30_000;

export type VoicePlaySource = "auto" | "local" | "youtube";
export type VoicePlayPlacement = "queue" | "next";

export type PlaybackCommandServiceDeps = {
  readonly config: Pick<Config, "discord">;
  readonly dispatch: (event: PlaybackEvent) => void;
  readonly view: () => PlaybackView;
  readonly library: () => readonly LibraryEntry[];
  readonly setVolume: (percent: number) => Promise<boolean>;
  readonly seek: (seconds: number) => Promise<boolean>;
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
};

export class PlaybackCommandBoundaryError extends Error {}

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
export class PlaybackCommandService {
  constructor(private readonly deps: PlaybackCommandServiceDeps) {}

  async play(input: {
    query: string;
    source: VoicePlaySource;
    placement: VoicePlayPlacement;
    userId: UserId;
    signal?: AbortSignal;
  }): Promise<string> {
    input.signal?.throwIfAborted();
    const query = normalizeVoicePlayQuery(input.query);
    const source = this.selectSource(query, input.source);
    let preResolved: ResolvedSource | undefined;
    if (source.kind !== "file") {
      try {
        const signal =
          input.signal === undefined
            ? AbortSignal.timeout(RESOLVE_TIMEOUT_MS)
            : AbortSignal.any([
                input.signal,
                AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
              ]);
        preResolved = await this.deps.resolvePlaySource(source, signal);
        signal.throwIfAborted();
      } catch (error) {
        throw new PlaybackCommandBoundaryError(
          classifyPlayError(error, source.kind),
        );
      }
    }
    input.signal?.throwIfAborted();
    this.deps.dispatch({
      type: input.placement === "next" ? "ADD_NEXT" : "ADD",
      source,
      requesterId: input.userId,
      ...(preResolved === undefined ? {} : { preResolved }),
    });
    return input.placement === "next"
      ? `Playing ${sourceLabel(source)} next.`
      : `Queued ${sourceLabel(source)}.`;
  }

  skip(userId: UserId): string {
    const current = this.deps.view().current;
    if (
      !canControlItem(
        userId,
        current?.requesterId ?? null,
        this.deps.config.discord.adminIds,
      )
    ) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can skip this.",
      );
    }
    this.deps.dispatch({ type: "SKIP" });
    return "Skipped.";
  }

  stop(userId: UserId): string {
    if (!isAdmin(userId, this.deps.config.discord.adminIds)) {
      throw new PlaybackCommandBoundaryError(
        "Only an admin can stop playback.",
      );
    }
    this.deps.dispatch({ type: "STOP" });
    return "Stopped and cleared the queue.";
  }

  async seek(
    userId: UserId,
    seconds: number,
    relative: boolean,
  ): Promise<string> {
    const view = this.deps.view();
    if (view.current === null)
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    if (
      !canControlItem(
        userId,
        view.current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can seek this.",
      );
    }
    if (relative && view.positionSeconds === null) {
      throw new PlaybackCommandBoundaryError(
        "The current position is unavailable.",
      );
    }
    const target = Math.max(
      0,
      relative ? (view.positionSeconds ?? 0) + seconds : seconds,
    );
    if (!(await this.deps.seek(target)))
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    return `Seeked to ${formatTimecode(target)}.`;
  }

  async setVolume(percent: number): Promise<string> {
    this.deps.dispatch({ type: "SET_VOLUME", volume: percent });
    const applied = await this.deps.setVolume(percent);
    return applied
      ? `Volume set to ${String(percent)} percent.`
      : `Volume set to ${String(percent)} percent for the next video.`;
  }

  setLoop(mode: LoopMode): string {
    this.deps.dispatch({ type: "SET_LOOP", mode });
    return `Loop set to ${mode}.`;
  }

  shuffle(): string {
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "SHUFFLE" });
    return `Shuffled ${String(count)} items.`;
  }

  getQueue(): string {
    return queueText(this.deps.view());
  }

  getNowPlaying(): string {
    return nowPlayingText(this.deps.view());
  }

  private selectSource(query: string, requested: VoicePlaySource): Source {
    if (requested !== "youtube") {
      const match = findBestMatch(this.deps.library(), query);
      if (match !== null)
        return { kind: "file", path: match.path, title: match.title };
      if (requested === "local") {
        throw new PlaybackCommandBoundaryError(
          `I couldn't find ${query} locally.`,
        );
      }
    }
    return { kind: "search", query };
  }
}
