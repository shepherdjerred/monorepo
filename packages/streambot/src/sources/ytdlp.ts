import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  getErrorMessage,
  parseJson,
} from "@shepherdjerred/streambot/util/errors.ts";
import {
  BlockedSourceError,
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("ytdlp");

/**
 * The slice of `yt-dlp --dump-single-json` output we rely on. yt-dlp emits a large object; Zod
 * keeps the fields we trust and drops the rest, so a schema drift can't smuggle unknown shapes in.
 */
export const YtdlpInfoSchema = z.object({
  title: z.string().min(1),
  // Direct media URL for the selected format (we request a single muxed `best`).
  url: z.string().min(1),
  duration: z.number().optional(),
  is_live: z.boolean().optional(),
  webpage_url: z.string().optional(),
});

export type YtdlpInfo = z.infer<typeof YtdlpInfoSchema>;

/** The yt-dlp target string for a source: a URL/file passthrough or a `ytsearch1:` query. */
export function ytdlpTarget(source: Source): string {
  switch (source.kind) {
    case "url": {
      return source.url;
    }
    case "search": {
      return `ytsearch1:${source.query}`;
    }
    case "file": {
      return source.path;
    }
  }
}

/** Build the argument list for a metadata probe (no download), selecting a single muxed format. */
export function buildInfoArgs(source: Source): string[] {
  return [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--skip-download",
    "-f",
    "best",
    ytdlpTarget(source),
  ];
}

/** Parse yt-dlp stdout into validated info (JSON → unknown → Zod). */
export function parseYtdlpInfo(stdout: string): YtdlpInfo {
  return YtdlpInfoSchema.parse(parseJson(stdout));
}

/** Map validated yt-dlp info to a {@link ResolvedSource} ffmpeg can read. */
export function toResolvedSource(info: YtdlpInfo): ResolvedSource {
  return { title: info.title, ffmpegInput: info.url };
}

/** True if a URL looks like a playlist that should be expanded into individual items. */
export function isLikelyPlaylist(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.searchParams.has("list") || /\/playlist(?:\/|$)/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const PlaylistLineSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
});
export type PlaylistItem = z.infer<typeof PlaylistLineSchema>;

/**
 * Expand a playlist URL into individual `{ url, title }` items via `yt-dlp --flat-playlist`, capped
 * at `config.playlistLimit`. Adult items are dropped here too (defense before they reach the queue).
 */
export async function expandPlaylist(
  config: Config,
  url: string,
  signal: AbortSignal,
): Promise<PlaylistItem[]> {
  const proc = Bun.spawn(
    [
      config.ytDlpPath,
      "--flat-playlist",
      "--no-warnings",
      "--print",
      "%(url)s\t%(title)s",
      url,
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore", signal },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp playlist expansion failed (code ${String(exitCode)}): ${stderr.trim()}`,
    );
  }

  const items: PlaylistItem[] = [];
  for (const line of stdout.split("\n")) {
    const [itemUrl, title] = line.split("\t");
    const parsed = PlaylistLineSchema.safeParse({ url: itemUrl, title });
    if (!parsed.success) {
      continue;
    }
    if (isBlockedUrl(parsed.data.url) || isBlockedText(parsed.data.title)) {
      continue;
    }
    items.push(parsed.data);
    if (items.length >= config.playlistLimit) {
      log.warn("playlist truncated", { limit: config.playlistLimit });
      break;
    }
  }
  return items;
}

/**
 * Resolve a URL/search source to a streamable {@link ResolvedSource} by shelling out to the system
 * `yt-dlp`. Honours the {@link AbortSignal} so SKIP/STOP cancels promptly.
 */
export async function resolveWithYtdlp(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  const args = buildInfoArgs(source);
  log.debug("probing source", { target: ytdlpTarget(source) });

  const proc = Bun.spawn([config.ytDlpPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    signal,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp exited with code ${String(exitCode)}: ${stderr.trim()}`,
    );
  }

  let info: YtdlpInfo;
  try {
    info = parseYtdlpInfo(stdout);
  } catch (error) {
    throw new Error(
      `could not parse yt-dlp output: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }

  // Defense in depth: a search/redirect can land on an adult site the request text didn't reveal.
  if (isBlockedUrl(info.webpage_url ?? "") || isBlockedText(info.title)) {
    throw new BlockedSourceError(info.webpage_url ?? info.title);
  }
  return toResolvedSource(info);
}
