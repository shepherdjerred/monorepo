import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { probeFileChapters } from "@shepherdjerred/streambot/sources/chapters.ts";
import { resolveWithYtdlp } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  BlockedSourceError,
  isBlockedSource,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";

/**
 * Resolve a {@link Source} to a {@link ResolvedSource} ffmpeg can read: local files pass straight
 * through, URL/search sources go through the system yt-dlp. Adult sources are rejected here — once
 * up front on the obvious request, and again on the yt-dlp-resolved domain (inside
 * {@link resolveWithYtdlp}) for searches/redirects. This is the machine's `resolveSource` actor.
 */
export async function resolveSource(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  if (isBlockedSource(source)) {
    throw new BlockedSourceError(sourceLabel(source));
  }
  if (source.kind === "file") {
    return {
      title: source.title,
      ffmpegInput: source.path,
      chapters: await probeFileChapters(config, source.path, signal),
    };
  }
  return resolveWithYtdlp(config, source, signal);
}
