import { mkdir, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each([false, true])(
  "canonical download mount maps to the worker before inspection, symlink=%s",
  async (linked) => {
    const db = cluster.database;
    const f = await fileFixture(db);
    directories.push(f.directory);
    const tv = {
      downloads: f.roots.downloads,
      library: path.join(f.directory, "tv-library"),
      control: path.join(f.directory, "tv-control"),
    };
    await mkdir(tv.library);
    await mkdir(tv.control);
    f.context.roots.tv = tv;
    f.context.pathMapping = createMediaPathMapping({
      canonicalRoots: {
        movies: {
          downloads: "/downloads",
          library: "/data/movies",
          control: "/control/movies",
        },
        tv: {
          downloads: "/downloads",
          library: "/data/tv",
          control: "/control/tv",
        },
      },
      workerRoots: f.context.roots,
    });
    const acquired = await f.acquisition();
    const torrent = await db.torrent.findUniqueOrThrow({
      where: { id: z.string().parse(acquired.attempt.torrentId) },
    });
    const observed = z
      .object({
        torrent: z.object({
          progress: z.literal(1),
          save_path: z.literal("/downloads"),
        }),
        files: z
          .array(
            z.object({
              name: z.string(),
              index: z.int(),
              size: z.number(),
              progress: z.number(),
            }),
          )
          .length(1),
      })
      .parse(torrent.observation);
    if (linked) {
      const file = observed.files[0];
      if (file === undefined) throw new Error("Fixture torrent member missing");
      const original = path.join(f.roots.downloads, file.name);
      const external = path.join(f.roots.control, "external-source.mkv");
      await rename(original, external);
      await symlink(external, original);
    }
    const result = await createMediaFileActivities(
      f.context,
    ).inspectAndStageMedia(acquired.input);
    expect(result).toEqual(
      linked
        ? { status: "blocked", reason: "download_path_unsafe" }
        : { status: "staged" },
    );
  },
);
