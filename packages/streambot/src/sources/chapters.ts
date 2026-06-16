import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  getErrorMessage,
  parseJson,
} from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("chapters");

/** A single chapter of the current video. `index` is 1-based (what users type for `/stream chapter`). */
export type Chapter = {
  readonly index: number;
  readonly title: string;
  readonly startSeconds: number;
  readonly endSeconds: number | null;
};

/**
 * The slice of `ffprobe -show_chapters -print_format json` we rely on. ffprobe emits `start_time` /
 * `end_time` as decimal-second *strings*, so we coerce. Unknown fields are dropped.
 */
const FfprobeChapterSchema = z.object({
  start_time: z.coerce.number(),
  end_time: z.coerce.number().optional(),
  tags: z.object({ title: z.string() }).partial().optional(),
});
const FfprobeOutputSchema = z.object({
  chapters: z.array(FfprobeChapterSchema).default([]),
});

/**
 * Pick the chapter containing `seconds`, scanning by ascending `startSeconds`. Returns null for an
 * empty list, or when `seconds` falls before the first chapter — the caller treats that as "no
 * current chapter" rather than guessing. Open right-hand boundary: a chapter owns `[start, next)`,
 * and the last chapter extends to infinity (its `endSeconds` is advisory).
 */
export function findChapterAt(
  chapters: readonly Chapter[],
  seconds: number,
): Chapter | null {
  const first = chapters[0];
  if (first === undefined || seconds < first.startSeconds) {
    return null;
  }
  for (let i = chapters.length - 1; i >= 0; i--) {
    const chapter = chapters[i];
    if (chapter !== undefined && seconds >= chapter.startSeconds) {
      return chapter;
    }
  }
  // Unreachable: the early guard above ensures seconds >= first.startSeconds,
  // so i=0 always matches. TypeScript requires an explicit return path here.
  return null;
}

/** Map validated ffprobe/yt-dlp rows (start/end seconds + optional title) to 1-based {@link Chapter}s. */
export function toChapters(
  rows: readonly {
    startSeconds: number;
    endSeconds?: number | null;
    title?: string | null;
  }[],
): Chapter[] {
  return rows.map((row, i) => ({
    index: i + 1,
    title:
      row.title !== null && row.title !== undefined && row.title.length > 0
        ? row.title
        : `Chapter ${String(i + 1)}`,
    startSeconds: Math.max(0, Math.floor(row.startSeconds)),
    endSeconds:
      row.endSeconds === null || row.endSeconds === undefined
        ? null
        : Math.max(0, Math.floor(row.endSeconds)),
  }));
}

/** Parse `ffprobe -show_chapters` JSON into chapters. Throws on malformed input (caller swallows). */
export function parseFfprobeChapters(stdout: string): Chapter[] {
  const parsed = FfprobeOutputSchema.parse(parseJson(stdout));
  return toChapters(
    parsed.chapters.map((chapter) => ({
      startSeconds: chapter.start_time,
      endSeconds: chapter.end_time ?? null,
      title: chapter.tags?.title ?? null,
    })),
  );
}

/**
 * Probe a local media file's chapter markers via ffprobe. Best-effort: any failure (missing ffprobe,
 * non-zero exit, unparseable output, no chapters) resolves to `[]` and never throws — chapters are a
 * nicety and must not break playback. Honours the {@link AbortSignal}.
 */
export async function probeFileChapters(
  config: Config,
  filePath: string,
  signal: AbortSignal,
): Promise<Chapter[]> {
  try {
    const proc = Bun.spawn(
      [
        config.ffprobePath,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_chapters",
        filePath,
      ],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore", signal },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      log.warn("ffprobe chapters failed", {
        filePath,
        exitCode,
        stderr: stderr.trim(),
      });
      return [];
    }
    return parseFfprobeChapters(stdout);
  } catch (error) {
    log.warn("ffprobe chapters errored", {
      filePath,
      error: getErrorMessage(error),
    });
    return [];
  }
}
