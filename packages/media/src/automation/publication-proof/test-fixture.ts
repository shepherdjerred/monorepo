import path from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";

/** Declares the trusted namespace before its first publication; Plex/mount evidence is synthetic. */
export async function mappedPublicationFixture(
  db: Database,
  episode?: { seriesId: string; title?: string },
) {
  const f = await fileFixture(db, episode);
  try {
    const canonicalRoots = {
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
    };
    const roots = (kind: "movies" | "tv"): MediaFileRoots => ({
      library: path.join(f.directory, kind),
      control: path.join(f.directory, kind, ".media-control"),
      downloads: f.roots.downloads,
      controlPolicy: "plex-excluded",
    });
    const workerRoots = { movies: roots("movies"), tv: roots("tv") };
    for (const value of Object.values(workerRoots))
      await mkdir(value.control, { recursive: true });
    f.context.roots = workerRoots;
    f.context.pathMapping = createMediaPathMapping({
      canonicalRoots,
      workerRoots,
    });
    const proofs = await grantTestExclusionProofs(db, f.user.id);
    for (const proof of proofs) {
      const kind = proof.libraryRoot === "/data/movies" ? "movies" : "tv";
      await writeFile(
        path.join(workerRoots[kind].library, ".plexignore"),
        proof.rootMarkerAfter,
      );
      await writeFile(
        path.join(workerRoots[kind].control, ".plexignore"),
        proof.controlMarkerAfter,
      );
    }
    f.context.verifyPlexExclusion = async (current) => {
      const kind =
        current.library === workerRoots.movies.library
          ? "movies"
          : current.library === workerRoots.tv.library
            ? "tv"
            : null;
      if (kind === null || current.control !== workerRoots[kind].control)
        throw new Error("Unknown mapped fixture roots");
      const proof = await requirePlexExclusionDatabaseProof(
        db,
        canonicalRoots[kind],
      );
      if (
        textDigest(
          await readFile(path.join(current.library, ".plexignore"), "utf8"),
        ) !== proof.rootMarkerSha256 ||
        textDigest(
          await readFile(path.join(current.control, ".plexignore"), "utf8"),
        ) !== proof.controlMarkerSha256
      )
        throw new Error("Mapped fixture exclusion markers changed");
    };
    return {
      ...f,
      roots: workerRoots[episode === undefined ? "movies" : "tv"],
    };
  } catch (error) {
    await rm(f.directory, { recursive: true, force: true });
    throw error;
  }
}
