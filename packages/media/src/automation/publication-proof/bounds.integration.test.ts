import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { seasonPublicationFixture } from "./season-fixture.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let prepared: Awaited<ReturnType<typeof prepareSeason>>;
let published: Awaited<ReturnType<typeof publishSeason>> | undefined;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  prepared = await prepareSeason();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function prepareSeason() {
  const db = cluster.database;
  const fixture = await seasonPublicationFixture(db);
  directories.push(fixture.directory);
  const f = { ...fixture, ...(await fixture.acquisition()) };
  const input = { attemptId: f.attempt.id, operationId: f.attempt.operationId };
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(input)).toEqual({
    status: "staged",
  });
  const staged = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.attempt.id },
  });
  const plan = FilePlanSchema.parse(staged.filePlan);
  expect(plan).toHaveLength(26);
  expect(plan.flatMap((entry) => entry.mediaIds).toSorted()).toEqual(
    f.mediaIds.toSorted(),
  );
  return { f, input, staged, plan };
}

async function publishSeason() {
  const db = cluster.database;
  const { f, input, staged, plan } = prepared;
  expect(
    await createMediaFileActivities(f.context).promoteMediaFiles(input),
  ).toEqual({
    status: "published",
  });
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.attempt.id },
  });
  const intent = PublicationIntentSchema.parse(transition.intent);
  const outcome = PublicationOutcomeSchema.parse(transition.outcome);
  expect(intent.filePlanHash).toBe(snapshotHash(nativeJson(staged.filePlan)));
  expect(intent.entries).toHaveLength(26);
  expect(outcome.entries).toHaveLength(26);
  expect(outcome.effects).toHaveLength(26 * 3);
  const mapping = f.context.pathMapping;
  if (mapping === undefined) throw new Error("Missing mapped roots");
  for (const entry of outcome.entries) {
    const asset = entry.successor;
    if (asset === null) throw new Error("Missing published successor");
    const planned = plan.find((item) => item.assetId === asset.id);
    const file = f.files.find((item) => item.name === planned?.downloadPath);
    if (file === undefined) throw new Error("Unexpected published coverage");
    expect(asset.path.startsWith("/data/tv/")).toBe(true);
    expect(await readFile(mapping.local(asset.path), "utf8")).toBe(
      file.content,
    );
    for (const journal of entry.journals)
      expect(
        await readFile(path.join(f.roots.control, journal.path), "utf8"),
      ).toBe(journal.raw);
  }
  const committed = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.attempt.id },
  });
  expect(committed.filePlan).toEqual(staged.filePlan);
  return { transition, outcome, committed };
}

describe(
  "26-entry ordinary publication lifecycle",
  { concurrent: false, shuffle: false },
  () => {
    test("publishes the entire staged season with exact canonical bytes and journals", async () => {
      published = await publishSeason();
    });

    test("a fresh Activity retries the committed season without rewriting any raw proof", async () => {
      if (published === undefined)
        throw new Error("The preceding real publication did not complete");
      const db = cluster.database;
      const { f, input } = prepared;
      const { transition, outcome, committed } = published;
      expect(
        await createMediaFileActivities(f.context).promoteMediaFiles(input),
      ).toEqual({ status: "published" });
      expect(
        await db.mediaPublicationTransition.findUniqueOrThrow({
          where: { id: transition.id },
        }),
      ).toEqual(transition);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: f.attempt.id },
        }),
      ).toEqual(committed);
      for (const entry of outcome.entries)
        for (const journal of entry.journals)
          expect(
            await readFile(path.join(f.roots.control, journal.path), "utf8"),
          ).toBe(journal.raw);
    });
  },
);
