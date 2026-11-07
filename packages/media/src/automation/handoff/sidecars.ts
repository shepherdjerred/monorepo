import path from "node:path";
import { opendir } from "node:fs/promises";
import type { MediaPathMapping } from "#filesystem/media-paths.ts";

/** Discovery is protective only. It never converts unknown subtitle files into owned assets. */
export async function unmanagedSidecars(
  video: string,
  mapping?: MediaPathMapping,
) {
  const directory = path.dirname(mapping?.local(video) ?? video);
  const basename = path.basename(video, path.extname(video)).toLowerCase();
  const result: {
    canonicalPath: string;
    reason: "subtitle_ownership_unconfirmed";
  }[] = [];
  const entries = await opendir(directory);
  let count = 0;
  for await (const entry of entries) {
    if (++count > 10_000)
      throw new Error("Handoff sidecar inventory exceeds bound");
    const name = entry.name.toLowerCase();
    if (
      ![".srt", ".ass", ".ssa", ".vtt", ".sub", ".idx"].includes(
        path.extname(name),
      )
    )
      continue;
    if (!name.startsWith(`${basename}.`)) continue;
    if (result.length >= 100)
      throw new Error("Handoff sidecar count exceeds bound");
    result.push({
      canonicalPath: path.join(path.dirname(video), entry.name),
      reason: "subtitle_ownership_unconfirmed",
    });
  }
  return result.sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
}
