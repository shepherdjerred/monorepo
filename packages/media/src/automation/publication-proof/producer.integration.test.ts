import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";

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

test("declared canonical roots survive real publication and committed retry without rewriting raw outcomes", async () => {
  const db = cluster.database;
  const f = await mappedPublicationFixture(db);
  directories.push(f.directory);
  const published = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(published.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(published.input)).toEqual({
    status: "published",
  });
  const row = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: published.attempt.id },
  });
  const outcome = PublicationOutcomeSchema.parse(row.outcome);
  const asset = outcome.entries[0]?.successor;
  if (
    asset === undefined ||
    asset === null ||
    f.context.pathMapping === undefined
  )
    throw new Error("Missing mapped publication");
  const intent = PublicationIntentSchema.parse(row.intent);
  const entry = intent.entries[0];
  if (entry === undefined) throw new Error("Actual publication entry missing");
  expect(asset.path).toBe(`/data/movies/${entry.entry.libraryPath}`);
  expect(await readFile(f.context.pathMapping.local(asset.path), "utf8")).toBe(
    published.content,
  );
  expect(
    await createMediaFileActivities(f.context).promoteMediaFiles(
      published.input,
    ),
  ).toEqual({ status: "published" });
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: row.id },
    }),
  ).toEqual(row);
});

test("ordinary publication commits the original plan intent before effects and the actual outcome atomically", async () => {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const before = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  let observedCommittedIntent = false;
  f.context.checkpoint = async (phase) => {
    if (phase !== "publication-intent-committed") return;
    const row = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: before.id },
    });
    expect(row.outcome).toBeNull();
    expect(
      await db.libraryAsset.count({
        where: { coverage: { some: { mediaId: f.media.id } } },
      }),
    ).toBe(0);
    observedCommittedIntent = true;
  };
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  expect(observedCommittedIntent).toBe(true);
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: before.id },
  });
  const intent = PublicationIntentSchema.parse(transition.intent);
  const outcome = PublicationOutcomeSchema.parse(transition.outcome);
  expect(intent.filePlanHash).toBe(snapshotHash(nativeJson(before.filePlan)));
  expect(outcome.effects.map((effect) => effect.step)).toEqual([
    "import_publish_link",
    "import_stage_unlink",
    "journal_complete",
  ]);
  expect(outcome.entries[0]?.successor?.path).toBeDefined();
  const successor = outcome.entries[0]?.successor;
  if (successor === undefined || successor === null)
    throw new Error("Missing actual successor");
  expect(await readFile(successor.path, "utf8")).toBe(acquired.content);
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: before.id },
    }),
  ).toEqual(transition);
});
