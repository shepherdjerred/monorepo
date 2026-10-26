import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";

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
    serverMachineId: z.string().min(1),
    phase: z.string(),
    input: CleanupNativeArchiveInputSchema,
  })
  .parse(JSON.parse(await readFile(z.string().parse(process.argv[2]), "utf8")));
const db = createDatabase(config.databaseUrl);
const canonical = (root: Pick<z.infer<typeof Root>, "library">) =>
  root.library === config.roots.movies.library ? "/data/movies" : "/data/tv";
const observed = { wall: Date.now(), monotonic: performance.now() };
const deadline = observed.monotonic + 30_000;
const expiresAtMs = observed.wall + 30_000;
const execution = () => ({
  observed,
  expiresAtMs,
  signal: new AbortController().signal,
  assertActive: () => {
    if (performance.now() >= deadline || Date.now() >= expiresAtMs)
      throw new Error("Crash fixture deadline exceeded");
  },
  checkpoint: () => Promise.resolve(),
});
const activities = createNativeArchiveFileActivities(
  {
    workerPodUid: config.workerPodUid,
    files: {
      db,
      roots: config.roots,
      plexAccess: (sectionType) =>
        Promise.resolve({
          serverMachineId: config.serverMachineId,
          sectionId: sectionType === "movie" ? "1" : "2",
          sectionType,
        }),
      enabled: {
        acquisition: () => Promise.resolve(false),
        quarantine: () => Promise.resolve(false),
        purge: () => Promise.resolve(true),
      },
      verifyStorageAuthority: (root) =>
        requireStorageAuthority(db, canonical(root), config.workerPodUid),
      verifyPlexExclusion: async (root) => {
        const proof = await requirePlexExclusionDatabaseProof(db, {
          library: canonical(root),
          control: `${canonical(root)}/.media-control`,
        });
        if (
          textDigest(
            await readFile(path.join(root.library, ".plexignore"), "utf8"),
          ) !== proof.rootMarkerSha256 ||
          textDigest(
            await readFile(path.join(root.control, ".plexignore"), "utf8"),
          ) !== proof.controlMarkerSha256
        )
          throw new Error("Crash fixture marker changed");
      },
      checkpoint: (phase) => {
        if (phase === config.phase) process.kill(process.pid, "SIGKILL");
        return Promise.resolve();
      },
    },
  },
  execution,
);
await activities.cleanupNativeArchiveFiles(config.input);
throw new Error("Crash fixture did not reach requested exact checkpoint");
