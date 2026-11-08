import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import { fileFixture } from "#automation/files/test-support.ts";

/** Physical bootstrap precedes any handoff ownership; optional mapping uses nested real control roots. */
export async function handoffFixtureFiles(
  db: Database,
  options: { memberAccountId?: string; canonicalStorage?: boolean },
) {
  const file =
    options.memberAccountId === undefined && options.canonicalStorage !== true
      ? await fileFixture(db)
      : await fileFixture(db, undefined, {
          ...(options.memberAccountId === undefined
            ? {}
            : { plexAccountId: options.memberAccountId }),
          ...(options.canonicalStorage === true
            ? { initialHandoffStorage: true }
            : {}),
        });
  const roots = file.context.roots.movies;
  const tv = {
    library: path.join(file.directory, "tv"),
    downloads: roots.downloads,
    control:
      options.canonicalStorage === true
        ? path.join(file.directory, "tv/.media-control")
        : path.join(file.directory, "tv-control"),
  };
  await mkdir(tv.library);
  await mkdir(tv.control);
  file.context.roots.tv = tv;
  const canonicalRoots =
    options.canonicalStorage === true
      ? { movies: "/data/movies", tv: "/data/tv" }
      : { movies: roots.library, tv: tv.library };
  return { file, roots, tv, canonicalRoots };
}
