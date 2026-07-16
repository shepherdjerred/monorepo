import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { listSubtitleCandidatesForFile } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import { listSubtitleTracksForYtdlp } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";

/**
 * Enumerate the burnable subtitle candidates for a source (file: sidecar + embedded; url/search:
 * yt-dlp's reported tracks) — for `/stream subtitles`'s track picker. Dispatches on `source.kind`;
 * see `listSubtitleCandidatesForFile`/`listSubtitleTracksForYtdlp` for per-kind detail.
 */
export function listSubtitleCandidatesForSource(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<SubtitleCandidate[]> {
  if (source.kind === "file") {
    return listSubtitleCandidatesForFile(config, source.path, signal);
  }
  return listSubtitleTracksForYtdlp(config, source, signal);
}
