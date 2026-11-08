import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import {
  loadPublicationIntent,
  createPublicationIntent,
  commitPublicationOutcome,
} from "./store.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";

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

test("actual publication intent preserves raw historical FilePlan and rejects stripping-hidden drift", async () => {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const files = createMediaFileActivities(f.context);
  expect(await files.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const before = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  f.context.checkpoint = async (phase) => {
    if (phase === "publication-intent-committed")
      throw new Error("test-before-first-effect");
  };
  await expect(files.promoteMediaFiles(acquired.input)).rejects.toThrow(
    "test-before-first-effect",
  );
  const intent = await loadPublicationIntent(db, before.id);
  expect(intent?.intent.filePlanHash).toBe(
    snapshotHash(nativeJson(before.filePlan)),
  );
  expect(
    await db.libraryAsset.count({
      where: { coverage: { some: { mediaId: f.media.id } } },
    }),
  ).toBe(0);
  const original = z
    .array(z.record(z.string(), z.json()))
    .parse(before.filePlan);
  const changed = original.map((entry) => ({
    ...entry,
    unknownHistoricalField: "must remain hashed",
  }));
  await db.acquisitionAttempt.update({
    where: { id: before.id },
    data: { filePlan: changed },
  });
  await expect(loadPublicationIntent(db, before.id)).rejects.toThrow(
    "original raw FilePlan",
  );
});

test("actual committed publication has one immutable parent/outcome and exact lost-ACK replay", async () => {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const files = createMediaFileActivities(f.context);
  expect(await files.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await files.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const intent = await loadPublicationIntent(db, acquired.attempt.id);
  if (intent === null)
    throw new Error("Actual producer omitted publication intent");
  const row = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: intent.transitionId },
  });
  const outcome = PublicationOutcomeSchema.parse(row.outcome);
  await db.$transaction((tx) =>
    recordVerifiedPublication(
      tx,
      outcome.entries.flatMap((entry) =>
        entry.successor === null ? [] : [entry.successor.id],
      ),
      acquired.attempt.recoveryEpoch,
    ),
  );
  await expect(
    db.$transaction((tx) => createPublicationIntent(tx, intent.intent)),
  ).resolves.toEqual(intent);
  await expect(
    db.$transaction((tx) => commitPublicationOutcome(tx, { intent, outcome })),
  ).resolves.toBeUndefined();
  await expect(
    db.mediaPublicationTransition.update({
      where: { id: row.id },
      data: { intentHash: "a".repeat(64) },
    }),
  ).rejects.toThrow();
  await expect(
    db.mediaPublicationTransition.update({
      where: { id: row.id },
      data: { outcome: { ...outcome, completedAt: new Date(0).toISOString() } },
    }),
  ).rejects.toThrow();
  await expect(
    db.mediaPublicationTransition.delete({ where: { id: row.id } }),
  ).rejects.toThrow();
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: row.id },
    }),
  ).toEqual(row);
});
