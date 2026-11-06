import path from "node:path";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import type { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { prepareActualMovieExclusion } from "#testing/plex-exclusion-real.ts";

export async function configureMovieLibraryPaths(
  f: Awaited<ReturnType<typeof handoffFixture>>,
  options: { canonicalStorage?: boolean; actualMovieExclusion?: boolean },
) {
  f.context.files.pathMapping =
    options.canonicalStorage === true
      ? createMediaPathMapping({
          canonicalRoots: {
            movies: {
              library: "/data/movies",
              control: "/data/movies/.media-control",
              downloads: "/downloads",
            },
            tv: {
              library: "/data/tv",
              control: "/data/tv/.media-control",
              downloads: "/downloads",
            },
          },
          workerRoots: f.context.files.roots,
        })
      : {
          canonical(kind, root, relative) {
            return root === "control"
              ? path.join(`/data/${kind}/.media-control`, relative)
              : path.join(f.context.files.roots[kind][root], relative);
          },
          local(stored) {
            for (const kind of ["movies", "tv"] as const) {
              const prefix = `/data/${kind}/.media-control/`;
              if (stored.startsWith(prefix))
                return path.join(
                  f.context.files.roots[kind].control,
                  stored.slice(prefix.length),
                );
            }
            return stored;
          },
        };
  if (options.actualMovieExclusion === true)
    await prepareActualMovieExclusion(f.context.files, f.network.actor);
  if (options.canonicalStorage === true) {
    if (options.actualMovieExclusion !== true)
      throw new Error(
        "Canonical initial-library fixture requires its genuine scanner proof",
      );
    f.context.files.roots.movies.controlPolicy = "plex-excluded";
  }
}
