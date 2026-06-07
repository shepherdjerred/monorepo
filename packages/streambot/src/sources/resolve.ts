import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { resolveWithYtdlp } from "@shepherdjerred/streambot/sources/ytdlp.ts";

/**
 * Resolve a {@link Source} to a {@link ResolvedSource} ffmpeg can read: local files pass straight
 * through, URL/search sources go through the system yt-dlp. This is the machine's `resolveSource`
 * actor.
 */
export async function resolveSource(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  if (source.kind === "file") {
    return { title: source.title, ffmpegInput: source.path };
  }
  return resolveWithYtdlp(config, source, signal);
}
