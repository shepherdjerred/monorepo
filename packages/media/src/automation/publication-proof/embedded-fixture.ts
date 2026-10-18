import path from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { runMediaTool, inspectMedia } from "#filesystem/media-tools.ts";

/** Seed an actual bounded video/text source before inspect creates its immutable plan. */
export async function embeddedFixtureSource(
  db: Database,
  file: Awaited<ReturnType<typeof fileFixture>>,
  acquired: Awaited<ReturnType<typeof file.acquisition>>,
) {
  const torrent = await db.torrent.findUniqueOrThrow({
    where: { id: z.uuid().parse(acquired.attempt.torrentId) },
  });
  const observation = z
    .object({
      torrent: z.record(z.string(), z.json()),
      files: z.array(
        z.object({
          index: z.int(),
          name: z.string(),
          size: z.number(),
          progress: z.number(),
        }),
      ),
    })
    .parse(torrent.observation);
  const selected = observation.files[0];
  if (selected === undefined || observation.files.length !== 1)
    throw new Error("Embedded fixture requires one owned new download");
  const subtitle = path.join(file.directory, "actual-embedded.srt");
  await writeFile(
    subtitle,
    "1\n00:00:00,000 --> 00:00:01,000\nActual extracted successor caption.\n",
  );
  const source = path.join(file.context.roots.movies.downloads, selected.name);
  await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=3840x1600:r=1:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=mono",
      "-i",
      subtitle,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-c:s",
      "srt",
      "-metadata:s:a:0",
      "language=eng",
      "-metadata:s:s:0",
      "language=eng",
      source,
    ],
    { maxBytes: 1024, timeoutMs: 30_000 },
  );
  const info = await stat(source);
  const size = info.size;
  await db.torrent.update({
    where: { id: torrent.id },
    data: { observation: { ...observation, files: [{ ...selected, size }] } },
  });
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: acquired.attempt.releaseId },
  });
  await db.releaseCandidate.update({
    where: { id: release.id },
    data: {
      attributes: {
        ...z.record(z.string(), z.json()).parse(release.attributes),
        sizeBytes: size,
      },
    },
  });
  file.context.inspect = inspectMedia;
  return source;
}
