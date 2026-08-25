/**
 * Pure text builders for `/stream queue`, `nowplaying`, and `chapters` — kept out of
 * `command-handler.ts` so that file stays under the max-lines cap and these renderers stay
 * unit-testable without a `CommandHandler` instance.
 */
import { findChapterAt } from "@shepherdjerred/streambot/sources/chapters.ts";
import { formatTimecode } from "@shepherdjerred/streambot/util/timecode.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";

/** How many queue entries `/stream queue` renders before truncating with a "…and N more" line. */
const MAX_LIST = 20;

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

export type QueueTextOptions = {
  /**
   * Render requester mentions. The voice path passes false: these strings are sent to OpenAI as
   * tool results, and requester user IDs must not leave the process for a spoken summary.
   */
  readonly mentions?: boolean;
};

export function nowPlayingText(
  view: PlaybackView,
  options: QueueTextOptions = {},
): string {
  if (view.current === null) {
    return "Nothing is playing.";
  }
  const lines = [
    (options.mentions ?? true)
      ? `**Now playing:** ${view.current.title} (requested by <@${view.current.requesterId}>)`
      : `**Now playing:** ${view.current.title}`,
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

export function queueText(
  view: PlaybackView,
  options: QueueTextOptions = {},
): string {
  const lines: string[] = [];
  if (view.current !== null) {
    lines.push(`**Now:** ${view.current.title}`);
  }
  view.queue.slice(0, MAX_LIST).forEach((item, index) => {
    lines.push(
      (options.mentions ?? true)
        ? `${String(index + 1)}. ${item.title} (<@${item.requesterId}>)`
        : `${String(index + 1)}. ${item.title}`,
    );
  });
  if (view.queue.length > MAX_LIST) {
    lines.push(`…and ${String(view.queue.length - MAX_LIST)} more`);
  }
  return lines.length === 0 ? "The queue is empty." : lines.join("\n");
}
