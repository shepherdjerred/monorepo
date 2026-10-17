import { afterAll, beforeAll, expect, test } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import nodePath from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import {
  FilePlanSchema,
  RemovalPlanSchema,
  type FileContext,
} from "./types.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

function pauseHash(context: FileContext) {
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let paused = false;
  context.checkpoint = async (phase) => {
    if (phase === "hashing")
      throw new Error("Hashing under final authority is forbidden");
    if (phase === "content-proof-hashing" && !paused) {
      paused = true;
      entered.resolve(undefined);
      await resume.promise;
    }
  };
  return {
    entered: entered.promise,
    resume: () => {
      resume.resolve(undefined);
    },
  };
}

async function keep(f: Awaited<ReturnType<typeof fileFixture>>) {
  const db = cluster.database;
  // A bounded real row-lock probe fails if hashing still holds database authority.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
  });
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.media.id },
  });
  await new PrismaMediaCommands(db, { keepDays: 30 }).act(
    { ...f.user, role: "member" },
    crypto.randomUUID(),
    f.media.id,
    { action: "keep", expectedVersion: media.version },
  );
}

test("Keep commits while initial promotion hashes and stale publication preserves staged recovery data", async () => {
  const f = await fileFixture(cluster.database);
  directories.push(f.directory);
  const acquisition = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquisition.input)).toEqual({
    status: "staged",
  });
  const pause = pauseHash(f.context);
  const publication = activities.promoteMediaFiles(acquisition.input);
  await pause.entered;
  try {
    await keep(f);
  } finally {
    pause.resume();
  }
  expect(await publication).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
  });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquisition.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Plan missing");
  await expect(
    access(nodePath.join(f.roots.library, entry.libraryPath)),
  ).rejects.toThrow();
  expect(
    await readFile(
      nodePath.join(f.roots.control, "staging", entry.operationId),
      "utf8",
    ),
  ).toBe(acquisition.content);
});

test.each(["quarantine", "purge", "restore", "rollback"] as const)(
  "Keep commits during %s hashing and protects the prior file location",
  async (phase) => {
    const f = await fileFixture(cluster.database);
    directories.push(f.directory);
    const original = await f.published();
    const retention = await f.retention();
    const activities = createMediaFileActivities(f.context);
    let file = nodePath.join(f.roots.library, original.entry.libraryPath);
    if (phase === "purge" || phase === "restore") {
      expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
        status: "quarantined",
      });
      const decision =
        await cluster.database.retentionDecision.findUniqueOrThrow({
          where: { id: retention.decision.id },
        });
      const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
      if (entry === undefined) throw new Error("Removal plan missing");
      file = nodePath.join(f.roots.control, "quarantine", entry.quarantineId);
      if (phase === "purge")
        await cluster.database.retentionDecision.update({
          where: { id: decision.id },
          data: {
            quarantinedAt: new Date(Date.now() - 8 * 86_400_000),
            purgeAfter: new Date(Date.now() - 86_400_000),
          },
        });
    }
    const restore = await cluster.database.operation.create({
      data: {
        kind: "restore_media",
        payload: { mediaId: f.media.id, generation: 0 },
      },
    });
    const pause = pauseHash(f.context);
    const operation =
      phase === "quarantine"
        ? activities.quarantineMediaFiles(retention.input)
        : phase === "purge"
          ? activities.purgeMediaFiles(retention.input)
          : phase === "restore"
            ? activities.restoreMediaFiles({
                mediaId: f.media.id,
                operationId: restore.id,
              })
            : activities.rollbackMediaPromotion(original.input);
    await pause.entered;
    try {
      await keep(f);
    } finally {
      pause.resume();
    }
    expect(await operation).toMatchObject({ status: "protected" });
    expect(await readFile(file, "utf8")).toBe(original.content);
  },
);
