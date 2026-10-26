import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { createNativeQuarantineFileActivities } from "#automation/native-quarantine/activities.ts";

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
    input: z.strictObject({
      continuationId: z.uuid(),
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int(),
    }),
  })
  .parse(JSON.parse(await readFile(z.string().parse(process.argv[2]), "utf8")));
const db = createDatabase(config.databaseUrl);
const canonicalRoot = (root: Pick<z.infer<typeof Root>, "library">) =>
  root.library === config.roots.movies.library ? "/data/movies" : "/data/tv";
const activities = createNativeQuarantineFileActivities({
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
      acquisition: () => Promise.resolve(true),
      quarantine: () => Promise.resolve(false),
      purge: () => Promise.resolve(false),
    },
    verifyStorageAuthority: (root) =>
      requireStorageAuthority(db, canonicalRoot(root), config.workerPodUid),
    verifyPlexExclusion: async (root) => {
      const library = canonicalRoot(root);
      const proof = await requirePlexExclusionDatabaseProof(db, {
        library,
        control: `${library}/.media-control`,
      });
      if (
        textDigest(
          await readFile(path.join(root.library, ".plexignore"), "utf8"),
        ) !== proof.rootMarkerSha256 ||
        textDigest(
          await readFile(path.join(root.control, ".plexignore"), "utf8"),
        ) !== proof.controlMarkerSha256
      )
        throw new Error("Synthetic crash exclusion marker changed");
    },
    checkpoint: (phase) => {
      if (phase === config.phase) process.kill(process.pid, "SIGKILL");
      return Promise.resolve();
    },
  },
});
await activities.restoreNativeQuarantineFiles(config.input);
throw new Error("Crash fixture did not reach requested checkpoint");
