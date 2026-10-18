import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

const Root = z.strictObject({
  library: z.string(),
  control: z.string(),
  downloads: z.string(),
  controlPolicy: z.literal("plex-excluded"),
});
const config = z
  .strictObject({
    databaseUrl: z
      .url()
      .refine((value) => new URL(value).hostname === "127.0.0.1"),
    roots: z.strictObject({ movies: Root, tv: Root }),
    workerPodUid: z.string(),
    phase: z.string(),
    input: z.union([
      NativeCompensationActivityInputSchema,
      z.strictObject({ attemptId: z.uuid(), operationId: z.uuid() }),
    ]),
    serverMachineId: z.string().optional(),
    movieSectionId: z.string().min(1).optional(),
  })
  .parse(JSON.parse(await readFile(z.string().parse(process.argv[2]), "utf8")));
const db = createDatabase(config.databaseUrl);
const unacknowledgedAttempt =
  config.phase === "sidecar-syscall-before-ack" && "attemptId" in config.input
    ? await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: config.input.attemptId },
      })
    : null;
const unacknowledgedEntry =
  unacknowledgedAttempt === null
    ? undefined
    : FilePlanSchema.parse(unacknowledgedAttempt.filePlan)[0];
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
const canonical = (root: z.infer<typeof Root>) =>
  root.library === config.roots.movies.library
    ? canonicalRoots.movies
    : canonicalRoots.tv;
const execution = () => {
  const signal = new AbortController().signal;
  const deadline = performance.now() + 30_000;
  return {
    signal,
    assertActive: () => {
      signal.throwIfAborted();
      if (performance.now() >= deadline)
        throw new Error("Crash invocation expired");
    },
    checkpoint: () => Promise.resolve(),
  };
};
const movieSectionId = config.movieSectionId;
const files = {
  db,
  roots: config.roots,
  pathMapping: createMediaPathMapping({
    canonicalRoots,
    workerRoots: config.roots,
  }),
  ...(config.serverMachineId === undefined
    ? {}
    : { serverMachineId: config.serverMachineId }),
  ...(movieSectionId === undefined
    ? {}
    : { permittedMovieSection: () => Promise.resolve(movieSectionId) }),
  publicationExecution: execution,
  enabled: {
    acquisition: () => Promise.resolve(true),
    quarantine: () => Promise.resolve(false),
    purge: () => Promise.resolve(false),
  },
  verifyStorageAuthority: (root: MediaFileRoots) =>
    requireStorageAuthority(
      db,
      canonical(Root.parse(root)).library,
      config.workerPodUid,
    ),
  verifyPlexExclusion: async (root: MediaFileRoots) => {
    const proof = await requirePlexExclusionDatabaseProof(
      db,
      canonical(Root.parse(root)),
    );
    if (
      textDigest(
        await readFile(path.join(root.library, ".plexignore"), "utf8"),
      ) !== proof.rootMarkerSha256 ||
      textDigest(
        await readFile(path.join(root.control, ".plexignore"), "utf8"),
      ) !== proof.controlMarkerSha256
    )
      throw new Error("Crash fixture exclusion marker changed");
    if (unacknowledgedEntry !== undefined) {
      const sidecar = unacknowledgedEntry.previousSidecars[0];
      if (sidecar === undefined)
        throw new Error("Pre-ACK crash needs a real sidecar");
      try {
        const roots = config.roots[unacknowledgedEntry.libraryKind];
        const source = await stat(
          path.join(roots.library, sidecar.libraryPath),
        );
        const target = await stat(
          path.join(roots.control, "quarantine", sidecar.quarantineId),
        );
        if (source.dev === target.dev && source.ino === target.ino)
          process.kill(process.pid, "SIGKILL");
      } catch (error) {
        if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
          throw error;
      }
    }
  },
  checkpoint: (phase: string) => {
    if (phase === config.phase) process.kill(process.pid, "SIGKILL");
    return Promise.resolve();
  },
};
try {
  const result =
    "attemptId" in config.input
      ? await createMediaFileActivities(files).promoteMediaFiles(config.input)
      : await createNativeCompensationFileActivities(
          { workerPodUid: config.workerPodUid, files },
          execution,
        ).compensateNativePublicationFiles(config.input);
  throw new Error(`Crash checkpoint not reached: ${JSON.stringify(result)}`);
} finally {
  await db.$disconnect();
}
