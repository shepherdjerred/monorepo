import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { createSubtitleReplacementActivities } from "./activities.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";

const input = z
  .object({
    databaseUrl: z.url(),
    roots: z.object({
      downloads: z.string(),
      library: z.string(),
      control: z.string(),
    }),
    replacementId: z.uuid(),
    operationId: z.uuid(),
    phase: z.string(),
    mode: z.enum(["apply", "reconcile", "cleanup"]),
    now: z.iso.datetime(),
  })
  .parse(JSON.parse(process.argv[2] ?? "null"));
if (!input.databaseUrl.startsWith("postgres://media@127.0.0.1:"))
  throw new Error("Disposable fixture database required");
const db = createDatabase(input.databaseUrl);
const activities = createSubtitleReplacementActivities({
  db,
  serverMachineId: "fixture-server",
  publicationExecution: testPublicationExecution,
  roots: { movies: input.roots, tv: input.roots },
  plexAccess: (sectionType) =>
    Promise.resolve({
      serverMachineId: "fixture-server",
      sectionId: sectionType === "movie" ? "1" : "2",
      sectionType,
    }),
  now: () => new Date(input.now),
  minimumFreeBytes: 0,
  enabled: {
    acquisition: () => Promise.resolve(true),
    quarantine: () => Promise.resolve(true),
    purge: () => Promise.resolve(true),
  },
  verifyStorageAuthority: () => Promise.resolve(),
  checkpoint: async (phase) => {
    if (phase === input.phase) {
      process.stdout.write("ready\n");
      await new Promise<void>(() => {
        /* Intentionally pending until this fixture worker is killed. */
      });
    }
  },
});
const command = {
  replacementId: input.replacementId,
  operationId: input.operationId,
};
try {
  const result =
    input.mode === "apply"
      ? await activities.applySubtitleReplacement(command)
      : input.mode === "reconcile"
        ? await activities.reconcileSubtitleReplacement(command)
        : await activities.cleanupSubtitleReplacement(command);
  process.stdout.write(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
