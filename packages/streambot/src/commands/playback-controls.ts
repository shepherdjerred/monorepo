import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import {
  chaptersText,
  nowPlayingText,
  queueText,
} from "@shepherdjerred/streambot/discord/queue-text.ts";
import { findChapterAt } from "@shepherdjerred/streambot/sources/chapters.ts";
import { searchLibrary } from "@shepherdjerred/streambot/sources/library.ts";
import { formatTimecode } from "@shepherdjerred/streambot/util/timecode.ts";
import type { LoopMode } from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type {
  PlaybackCommandResult,
  PlaybackCommandServiceDeps,
} from "@shepherdjerred/streambot/commands/playback-command-types.ts";

/** Permission-checked playback controls shared by slash and voice transports. */
export class PlaybackControls {
  constructor(protected readonly deps: PlaybackCommandServiceDeps) {}

  join(): PlaybackCommandResult {
    this.deps.dispatch({ type: "JOIN" });
    return { outcome: "joined", message: "Joined and listening." };
  }

  leave(): PlaybackCommandResult {
    this.deps.dispatch({ type: "LEAVE" });
    return { outcome: "left", message: "Left the voice channel." };
  }

  pause(userId: UserId): PlaybackCommandResult {
    const view = this.controllableCurrent(userId);
    if (view.state === "resolving") {
      throw new PlaybackCommandBoundaryError(
        "Playback is still loading; try pausing again once it starts.",
      );
    }
    if (view.paused === true) {
      throw new PlaybackCommandBoundaryError("Playback is already paused.");
    }
    this.deps.dispatch({
      type: "PAUSE",
      positionSeconds: view.positionSeconds ?? 0,
    });
    return { outcome: "paused", message: "Paused." };
  }

  resume(userId: UserId): PlaybackCommandResult {
    const view = this.controllableCurrent(userId);
    if (view.paused !== true) {
      throw new PlaybackCommandBoundaryError("Playback is not paused.");
    }
    this.deps.dispatch({ type: "RESUME" });
    return { outcome: "resumed", message: "Resumed." };
  }

  restart(userId: UserId): PlaybackCommandResult {
    this.controllableCurrent(userId);
    this.deps.dispatch({ type: "RESTART" });
    return { outcome: "restarted", message: "Restarted from the beginning." };
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
    if (current?.requestId !== undefined) {
      this.deps.history?.updateRequest(current.requestId, "skipped");
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
    const view = this.deps.view();
    if (view.current?.requestId !== undefined) {
      this.deps.history?.updateRequest(view.current.requestId, "skipped");
    }
    this.markRemoved(view.queue);
    this.deps.dispatch({ type: "STOP" });
    return { outcome: "stopped", message: "Stopped and cleared the queue." };
  }

  async seek(
    userId: UserId,
    seconds: number,
    relative: boolean,
  ): Promise<PlaybackCommandResult> {
    const view = this.controllableCurrent(userId);
    if (relative && view.positionSeconds === null) {
      throw new PlaybackCommandBoundaryError(
        "The current position is unavailable.",
      );
    }
    const target = Math.max(
      0,
      relative ? (view.positionSeconds ?? 0) + seconds : seconds,
    );
    if (!(await this.deps.seek(target))) {
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    }
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

  remove(userId: UserId, position: number): PlaybackCommandResult {
    const item = this.deps.view().queue[position - 1];
    if (item === undefined) {
      throw new PlaybackCommandBoundaryError(
        `There's no item at position ${String(position)}.`,
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
    if (item.requestId !== undefined) {
      this.deps.history?.updateRequest(item.requestId, "removed");
    }
    this.deps.dispatch({ type: "REMOVE", index: position });
    return { outcome: "removed", message: `Removed **${item.title}**.` };
  }

  clear(userId: UserId): PlaybackCommandResult {
    if (!isAdmin(userId, this.deps.config.discord.adminIds)) {
      throw new PlaybackCommandBoundaryError(
        "Only an admin can clear the queue.",
      );
    }
    const queue = this.deps.view().queue;
    this.markRemoved(queue);
    this.deps.dispatch({ type: "CLEAR" });
    return {
      outcome: "cleared",
      message: `Cleared ${String(queue.length)} queued items.`,
    };
  }

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
    const view = this.controllableCurrent(userId);
    const current = view.current;
    if (current === null || current.chapters.length === 0) {
      throw new PlaybackCommandBoundaryError(
        current === null
          ? "Nothing is playing."
          : "No chapters for the current video.",
      );
    }
    const chapter =
      typeof target === "number"
        ? current.chapters[target - 1]
        : this.relativeChapter(view, target);
    if (chapter === undefined) {
      throw new PlaybackCommandBoundaryError(
        typeof target === "number"
          ? `There's no chapter ${String(target)}. This video has ${String(current.chapters.length)}.`
          : `There's no ${target} chapter.`,
      );
    }
    if (!(await this.deps.seek(chapter.startSeconds))) {
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    }
    return {
      outcome: "chapter-jumped",
      message: `Chapter ${String(chapter.index)}: ${chapter.title}.`,
    };
  }

  subtitlesOff(userId: UserId): PlaybackCommandResult {
    return this.subtitles(userId, "off");
  }

  subtitles(
    userId: UserId,
    mode: "off" | "auto" | "language",
    language?: string,
  ): PlaybackCommandResult {
    const view = this.controllableCurrent(userId);
    if (view.paused === true) {
      throw new PlaybackCommandBoundaryError(
        "Resume playback before changing subtitles.",
      );
    }
    this.deps.dispatch({
      type: "CHANGE_SUBTITLES",
      subtitles:
        mode === "off"
          ? { trackRef: { kind: "off" } }
          : mode === "language" && language !== undefined
            ? { enabled: true, language }
            : { enabled: true },
      positionSeconds: view.positionSeconds ?? 0,
    });
    return {
      outcome: "subtitles-off",
      message:
        mode === "off"
          ? "Subtitles turned off; the video restarts at the same spot."
          : `Subtitles set to ${language ?? "automatic"}; the video restarts at the same spot.`,
    };
  }

  searchLibraryTitles(query: string, limit: number): string {
    const matches = searchLibrary(this.deps.library(), query, limit);
    return matches.length === 0
      ? `Nothing in the library matches ${query}.`
      : matches.map((entry) => entry.title).join("; ");
  }

  listChapters(): string {
    return chaptersText(this.deps.view());
  }

  private controllableCurrent(userId: UserId): PlaybackView {
    const view = this.deps.view();
    if (view.current === null) {
      throw new PlaybackCommandBoundaryError("Nothing is playing.");
    }
    if (
      !canControlItem(
        userId,
        view.current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      throw new PlaybackCommandBoundaryError(
        "Only the requester or an admin can control this.",
      );
    }
    return view;
  }

  private relativeChapter(view: PlaybackView, target: "next" | "previous") {
    const current = view.current;
    if (current === null) return;
    const at = findChapterAt(current.chapters, view.positionSeconds ?? 0);
    const currentIndex = at?.index ?? 0;
    const nextIndex = target === "next" ? currentIndex + 1 : currentIndex - 1;
    return current.chapters[nextIndex - 1];
  }

  private markRemoved(items: PlaybackView["queue"]): void {
    for (const item of items) {
      if (item.requestId !== undefined) {
        this.deps.history?.updateRequest(item.requestId, "removed");
      }
    }
  }
}
