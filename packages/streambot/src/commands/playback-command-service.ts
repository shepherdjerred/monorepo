import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import {
  classifyPlayError,
  isHttpUrl,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  BlockedSourceError,
  isBlockedSource,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import {
  chaptersText,
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
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import { findChapterAt } from "@shepherdjerred/streambot/sources/chapters.ts";
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
  /** Public status-channel announcement, used for blocked-source shaming parity with slash. */
  readonly announce: (message: string) => Promise<void>;
};

export class PlaybackCommandBoundaryError extends Error {}

/**
 * A blocked-source denial. Unlike ordinary boundary errors it fires a public side effect (the
 * shame announce) before throwing, so the voice mutation gate must NOT be released for it — a
 * retry in the same wake could repeat the announce or slip a second mutation in.
 */
export class PlaybackCommandBlockedError extends PlaybackCommandBoundaryError {}

/**
 * What a mutating command actually did, alongside its speakable message. Callers branch on the
 * outcome — never on the English text, which the voice assistant paraphrases and this service is
 * free to reword.
 */
export type PlaybackCommandResult = {
  readonly outcome:
    | "queued"
    | "queued-next"
    | "skipped"
    | "stopped"
    | "seeked"
    | "volume-set"
    | "volume-deferred"
    | "loop-set"
    | "shuffled"
    | "removed"
    | "cleared"
    | "moved"
    | "chapter-jumped"
    | "subtitles-off";
  readonly message: string;
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
export class PlaybackCommandService {
  constructor(private readonly deps: PlaybackCommandServiceDeps) {}

  async play(input: {
    query: string;
    source: VoicePlaySource;
    placement: VoicePlayPlacement;
    userId: UserId;
    signal?: AbortSignal;
  }): Promise<PlaybackCommandResult> {
    input.signal?.throwIfAborted();
    const query = normalizeVoicePlayQuery(input.query);
    const source = this.selectSource(query, input.source);
    if (isBlockedSource(source)) {
      await this.announceBlocked(input.userId);
    }
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
        if (error instanceof BlockedSourceError) {
          await this.announceBlocked(input.userId);
        }
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
      ? {
          outcome: "queued-next",
          message: `Playing ${sourceLabel(source)} next.`,
        }
      : { outcome: "queued", message: `Queued ${sourceLabel(source)}.` };
  }

  skip(userId: UserId): PlaybackCommandResult {
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
    return { outcome: "skipped", message: "Skipped." };
  }

  stop(userId: UserId): PlaybackCommandResult {
    if (!isAdmin(userId, this.deps.config.discord.adminIds)) {
      throw new PlaybackCommandBoundaryError(
        "Only an admin can stop playback.",
      );
    }
    this.deps.dispatch({ type: "STOP" });
    return { outcome: "stopped", message: "Stopped and cleared the queue." };
  }

  async seek(
    userId: UserId,
    seconds: number,
    relative: boolean,
  ): Promise<PlaybackCommandResult> {
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
    return {
      outcome: "seeked",
      message: `Seeked to ${formatTimecode(target)}.`,
    };
  }

  async setVolume(percent: number): Promise<PlaybackCommandResult> {
    this.deps.dispatch({ type: "SET_VOLUME", volume: percent });
    const applied = await this.deps.setVolume(percent);
    return applied
      ? {
          outcome: "volume-set",
          message: `Volume set to ${String(percent)} percent.`,
        }
      : {
          outcome: "volume-deferred",
          message: `Volume set to ${String(percent)} percent for the next video.`,
        };
  }

  setLoop(mode: LoopMode): PlaybackCommandResult {
    this.deps.dispatch({ type: "SET_LOOP", mode });
    return { outcome: "loop-set", message: `Loop set to ${mode}.` };
  }

  shuffle(): PlaybackCommandResult {
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "SHUFFLE" });
    return {
      outcome: "shuffled",
      message: `Shuffled ${String(count)} items.`,
    };
  }

  getQueue(): string {
    return queueText(this.deps.view(), { mentions: false });
  }

  getNowPlaying(): string {
    return nowPlayingText(this.deps.view(), { mentions: false });
  }

  /**
   * Same public shaming as the slash path, then a terse denial: the assistant reads boundary
   * messages aloud, and the block reason must not be spoken over voice.
   */
  private async announceBlocked(userId: UserId): Promise<never> {
    await this.deps.announce(shameMessage(userId));
    throw new PlaybackCommandBlockedError("Nope. That's not allowed.");
  }

  remove(userId: UserId, position: number): PlaybackCommandResult {
    const item = this.deps.view().queue[position - 1];
    if (item === undefined) {
      throw new PlaybackCommandBoundaryError(
        `There's no queue item ${String(position)}.`,
      );
    }
    if (
      !canControlItem(
        userId,
        item.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can remove this.",
      );
    }
    this.deps.dispatch({ type: "REMOVE", index: position });
    return { outcome: "removed", message: `Removed ${item.title}.` };
  }

  clear(userId: UserId): PlaybackCommandResult {
    if (!isAdmin(userId, this.deps.config.discord.adminIds)) {
      throw new PlaybackCommandBoundaryError(
        "Only an admin can clear the queue.",
      );
    }
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "CLEAR" });
    return {
      outcome: "cleared",
      message: `Cleared ${String(count)} queued items.`,
    };
  }

  // Mirrors /stream move, which has no permission gate; voice adds bounds checks only so a
  // misheard position gets a spoken correction instead of a silent no-op.
  move(from: number, to: number): PlaybackCommandResult {
    const queue = this.deps.view().queue;
    const item = queue[from - 1];
    if (item === undefined || to < 1 || to > queue.length) {
      throw new PlaybackCommandBoundaryError(
        `Those queue positions don't exist. The queue has ${String(queue.length)} items.`,
      );
    }
    this.deps.dispatch({ type: "MOVE", from, to });
    return {
      outcome: "moved",
      message: `Moved ${item.title} to position ${String(to)}.`,
    };
  }

  async jumpToChapter(
    userId: UserId,
    target: number | "next" | "previous",
  ): Promise<PlaybackCommandResult> {
    const view = this.deps.view();
    const current = view.current;
    if (current === null)
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    if (
      !canControlItem(
        userId,
        current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can seek this.",
      );
    }
    if (current.chapters.length === 0) {
      throw new PlaybackCommandBoundaryError(
        "No chapters for the current video.",
      );
    }
    let chapter;
    if (typeof target === "number") {
      chapter = current.chapters[target - 1];
      if (chapter === undefined) {
        throw new PlaybackCommandBoundaryError(
          `There's no chapter ${String(target)}. This video has ${String(current.chapters.length)}.`,
        );
      }
    } else {
      const at = findChapterAt(current.chapters, view.positionSeconds ?? 0);
      const currentIndex = at?.index ?? 0;
      const nextIndex = target === "next" ? currentIndex + 1 : currentIndex - 1;
      chapter = current.chapters[nextIndex - 1];
      if (chapter === undefined) {
        throw new PlaybackCommandBoundaryError(
          target === "next"
            ? "There's no next chapter."
            : "There's no previous chapter.",
        );
      }
    }
    if (!(await this.deps.seek(chapter.startSeconds)))
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    return {
      outcome: "chapter-jumped",
      message: `Chapter ${String(chapter.index)}: ${chapter.title}.`,
    };
  }

  subtitlesOff(userId: UserId): PlaybackCommandResult {
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
        "Only the requester or an admin can change subtitles for this.",
      );
    }
    this.deps.dispatch({
      type: "CHANGE_SUBTITLES",
      subtitles: { trackRef: { kind: "off" } },
      positionSeconds: view.positionSeconds ?? 0,
    });
    return {
      outcome: "subtitles-off",
      message: "Subtitles turned off; the video restarts at the same spot.",
    };
  }

  /** Bounded library search so the model can ground a title before its one play. */
  searchLibraryTitles(query: string, limit: number): string {
    const matches = searchLibrary(this.deps.library(), query, limit);
    if (matches.length === 0) return `Nothing in the library matches ${query}.`;
    return matches.map((entry) => entry.title).join("; ");
  }

  listChapters(): string {
    return chaptersText(this.deps.view());
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
