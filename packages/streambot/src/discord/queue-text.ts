/**
 * Pure text builders for `/stream queue`, `nowplaying`, and `chapters` — kept out of
 * `command-handler.ts` so that file stays under the max-lines cap and these renderers stay
 * unit-testable without a `CommandHandler` instance.
 */
import {
  findChapterAt,
  type Chapter,
} from "@shepherdjerred/streambot/sources/chapters.ts";
import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** How many queue entries `/stream queue` renders before truncating with a "…and N more" line. */
const MAX_LIST = 20;

export type QueueItemView = {
  readonly title: string;
  readonly requesterId: UserId;
  /** Chapter markers of this item (only populated for the currently-playing item). */
  readonly chapters: readonly Chapter[];
};

export type PlaybackView = {
  readonly state: string;
  readonly current: QueueItemView | null;
  readonly queue: readonly QueueItemView[];
  readonly loop: string;
  readonly volume: number;
  /** Live elapsed seconds since playback began (segment offset + wall-clock). Null when idle/between segments. */
  readonly positionSeconds: number | null;
};

export function chaptersText(view: PlaybackView): string {
  const current = view.current;
  if (current === null) {
    return "Nothing is playing.";
  }
  if (current.chapters.length === 0) {
    return "No chapters for the current video.";
  }
  const lines = current.chapters.map(
    (chapter) =>
      `${String(chapter.index)}. \`${formatTimecode(chapter.startSeconds)}\` — ${chapter.title}`,
  );
  return `**Chapters for ${current.title}:**\n${lines.join("\n")}`;
}

export function nowPlayingText(view: PlaybackView): string {
  if (view.current === null) {
    return "Nothing is playing.";
  }
  const lines = [
    `**Now playing:** ${view.current.title} (requested by <@${view.current.requesterId}>)`,
  ];
  if (view.positionSeconds !== null) {
    const time = formatTimecode(view.positionSeconds);
    const chapter = findChapterAt(view.current.chapters, view.positionSeconds);
    lines.push(
      chapter === null
        ? `**Position:** ${time}`
        : `**Position:** ${time} — Chapter ${String(chapter.index)}: ${chapter.title}`,
    );
  }
  lines.push(`**Loop:** ${view.loop} · **Volume:** ${String(view.volume)}%`);
  return lines.join("\n");
}

export function queueText(view: PlaybackView): string {
  const lines: string[] = [];
  if (view.current !== null) {
    lines.push(`**Now:** ${view.current.title}`);
  }
  view.queue.slice(0, MAX_LIST).forEach((item, index) => {
    lines.push(`${String(index + 1)}. ${item.title} (<@${item.requesterId}>)`);
  });
  if (view.queue.length > MAX_LIST) {
    lines.push(`…and ${String(view.queue.length - MAX_LIST)} more`);
  }
  return lines.length === 0 ? "The queue is empty." : lines.join("\n");
}
