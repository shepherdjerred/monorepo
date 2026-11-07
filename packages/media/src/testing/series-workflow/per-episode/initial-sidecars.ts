import path from "node:path";
import { writeFile } from "node:fs/promises";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import type { InitialMovieSidecar } from "#automation/plex-binding/library-fixture/movie-sidecars.ts";

/** Real native sidecars precede the actual Bazarr capture and owner approval.
 * Import retains unknown provenance/unverified quality exactly as observed. */
export async function perEpisodeInitialSidecarsV1(
  selected: { filename: string; mediaSourceId: string }[],
  enabled: true | undefined,
) {
  if (enabled !== true) return {};
  const sidecars: InitialMovieSidecar[] = [];
  for (const item of selected)
    for (const language of ["en", "zh"]) {
      const filename = subtitleDestination({
        videoPath: item.filename,
        language,
        forced: false,
        hearingImpaired: false,
        format: "srt",
      });
      const text =
        language === "en"
          ? "1\n00:00:00,000 --> 00:00:01,500\nWelcome home. This is a real synthetic English sidecar.\n"
          : "1\n00:00:00,000 --> 00:00:01,500\n这是一个简体中文字幕测试，汉语龙马风云国书车头发现。\n";
      await writeFile(filename, text, { flag: "wx" });
      sidecars.push({
        language,
        path: `/tv/${path.basename(filename)}`,
        videoPath: `/tv/${path.basename(item.filename)}`,
        mediaSourceId: item.mediaSourceId,
      });
    }
  return { initialSidecars: sidecars };
}
