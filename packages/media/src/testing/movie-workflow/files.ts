import path from "node:path";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Database } from "#infrastructure/database.ts";
import type { FileContext } from "#automation/files/types.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";

/** Real disposable namespace and validators; mount/scanner observations are explicitly synthetic. */
export async function movieWorkflowFiles(db: Database, ownerId: string) {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-movie-workflow-")),
  );
  const workerPodUid = "synthetic-movie-workflow-worker";
  const roots = {
    movies: {
      library: path.join(directory, "movies"),
      control: path.join(directory, "movies/.media-control"),
      downloads: path.join(directory, "downloads"),
      controlPolicy: "plex-excluded" as const,
    },
    tv: {
      library: path.join(directory, "tv"),
      control: path.join(directory, "tv/.media-control"),
      downloads: path.join(directory, "downloads"),
      controlPolicy: "plex-excluded" as const,
    },
  };
  const canonical = {
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
  try {
    await mkdir(roots.movies.downloads, { recursive: true });
    for (const kind of ["movies", "tv"] as const) {
      await mkdir(roots[kind].control, { recursive: true });
      const observedAt = new Date();
      await db.mediaStorageAuthority.create({
        data: {
          rootPath: canonical[kind].library,
          recoveryEpoch: 0,
          pvcUid: `synthetic-${kind}`,
          volumeName: `synthetic-${kind}`,
          volumePath: roots[kind].library,
          workerPodUid,
          evidence: { source: "synthetic-movie-workflow" },
          observedAt,
          expiresAt: new Date(observedAt.getTime() + 120_000),
        },
      });
    }
    const proofs = await grantTestExclusionProofs(
      db,
      ownerId,
      "fixture-server",
    );
    for (const proof of proofs) {
      const kind =
        proof.libraryRoot === canonical.movies.library ? "movies" : "tv";
      await writeFile(
        path.join(roots[kind].library, ".plexignore"),
        proof.rootMarkerAfter,
      );
      await writeFile(
        path.join(roots[kind].control, ".plexignore"),
        proof.controlMarkerAfter,
      );
    }
    const context: FileContext = {
      db,
      roots,
      serverMachineId: "fixture-server",
      pathMapping: createMediaPathMapping({
        canonicalRoots: canonical,
        workerRoots: roots,
      }),
      permittedMovieSection: () => Promise.resolve("1"),
      plexAccess: (sectionType) =>
        Promise.resolve({
          serverMachineId: "fixture-server",
          sectionId: sectionType === "movie" ? "1" : "2",
          sectionType,
        }),
      inspect: inspectMedia,
      minimumFreeBytes: 0,
      checkpoint: () => Promise.resolve(),
      enabled: {
        acquisition: () => Promise.resolve(true),
        quarantine: () => Promise.resolve(true),
        purge: () => Promise.resolve(true),
      },
      verifyStorageAuthority: (root) => {
        const kind =
          root.library === roots.movies.library
            ? "movies"
            : root.library === roots.tv.library
              ? "tv"
              : null;
        if (kind === null) throw new Error("Unknown owned fixture root");
        return requireStorageAuthority(
          db,
          canonical[kind].library,
          workerPodUid,
        );
      },
      verifyPlexExclusion: async (root) => {
        const kind =
          root.library === roots.movies.library
            ? "movies"
            : root.library === roots.tv.library
              ? "tv"
              : null;
        if (kind === null) throw new Error("Unknown owned fixture root");
        const proof = await requirePlexExclusionDatabaseProof(
          db,
          canonical[kind],
        );
        if (
          textDigest(
            await readFile(path.join(root.library, ".plexignore"), "utf8"),
          ) !== proof.rootMarkerSha256 ||
          textDigest(
            await readFile(path.join(root.control, ".plexignore"), "utf8"),
          ) !== proof.controlMarkerSha256
        )
          throw new Error("Owned fixture exclusion markers changed");
      },
    };
    return {
      context,
      directory,
      roots,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
