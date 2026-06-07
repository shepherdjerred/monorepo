import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  getErrorMessage,
  parseJson,
} from "@shepherdjerred/streambot/util/errors.ts";
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

  try {
    return toResolvedSource(parseYtdlpInfo(stdout));
  } catch (error) {
    throw new Error(
      `could not parse yt-dlp output: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}
