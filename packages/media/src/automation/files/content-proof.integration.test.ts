import { afterAll, expect, test } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import nodePath from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { elapsedQuarantineClient } from "./plex-binding/elapsed-quarantine.test-support.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import {
  FilePlanSchema,
  RemovalPlanSchema,
  type FileContext,
} from "./types.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
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
  const db = harness.database();
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
  const f = await fileFixture(harness.database());
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
  const attempt = await harness
    .database()
    .acquisitionAttempt.findUniqueOrThrow({
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
    const bound =
      phase === "rollback"
        ? null
        : await boundRetentionFixture(harness.database(), harness.context());
    const f = bound?.files ?? (await fileFixture(harness.database()));
    directories.push(f.directory);
    const original = bound?.published ?? (await f.published());
    const retention = bound?.retention;
    if (retention === undefined && phase !== "rollback")
      throw new Error("Bound retention fixture missing");
    const activities = createMediaFileActivities(f.context);
    let file = nodePath.join(f.roots.library, original.entry.libraryPath);
    if (phase === "purge" || phase === "restore") {
      if (bound === null) throw new Error("Bound quarantine fixture missing");
      file = await quarantinedHashTarget(bound, phase, activities);
    }
    const target = await harness.database().mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    const restore = await harness.database().operation.create({
      data: {
        kind: "restore_media",
        payload: { mediaId: f.media.id, generation: target.generation },
      },
    });
    const pause = pauseHash(f.context);
    const operation =
      phase === "quarantine" && retention !== undefined
        ? activities.quarantineMediaFiles(retention.input)
        : phase === "purge" && retention !== undefined
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

async function quarantinedHashTarget(
  bound: Awaited<ReturnType<typeof boundRetentionFixture>>,
  phase: "purge" | "restore",
  activities: ReturnType<typeof createMediaFileActivities>,
) {
  const { files: f, retention } = bound;
  const timing =
    phase === "purge"
      ? await elapsedQuarantineClient(harness.database(), {
          ...retention.input,
          mediaIds: [f.media.id],
        })
      : null;
  f.context.db = timing?.db ?? harness.database();
  try {
    expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
      status: "quarantined",
    });
  } finally {
    f.context.db = harness.database();
  }
  await timing?.assertCommitted();
  const decision = await harness
    .database()
    .retentionDecision.findUniqueOrThrow({
      where: { id: retention.decision.id },
    });
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined) throw new Error("Removal plan missing");
  const file = nodePath.join(f.roots.control, "quarantine", entry.quarantineId);
  if (phase === "purge") {
    await bound.observe(true);
    expect(await bound.refresh()).toMatchObject({ status: "purge" });
  }
  return file;
}
