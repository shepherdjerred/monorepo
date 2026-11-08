import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { lockPublicationSnapshots } from "./locked-snapshots.ts";
import { readLockedPublicationSnapshot } from "./queried-snapshots.ts";

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

test("queried publication snapshots require their live transaction, original allowance and exact locked assets", async () => {
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
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const entry = plan[0];
  if (entry === undefined)
    throw new Error("Actual publication omitted its plan");
  const scope = {
    attemptId: attempt.id,
    mediaIds: attempt.mediaIds,
    entries: plan.map((item) => ({ entry: item })),
  };
  const budget = new PublicationAuthorityReadBudget();
  const completed = await db.$transaction(async (tx) => {
    const token = await lockPublicationSnapshots(tx, scope, budget);
    const first = await readLockedPublicationSnapshot(
      tx,
      entry.assetId,
      budget,
      token,
    );
    const remaining = budget.take;
    expect(first.coverage).toEqual([
      { mediaId: f.media.id, edition: "default", current: true },
    ]);
    const coverage = first.coverage[0];
    if (coverage === undefined)
      throw new Error("Actual snapshot omitted coverage");
    coverage.current = false;
    const repeated = await readLockedPublicationSnapshot(
      tx,
      entry.assetId,
      budget,
      token,
    );
    expect(repeated.coverage[0]?.current).toBe(true);
    expect(budget.take).toBe(remaining);
    await expect(
      readLockedPublicationSnapshot(
        tx,
        entry.assetId,
        new PublicationAuthorityReadBudget(),
        token,
      ),
    ).rejects.toThrow("another transaction, allowance or locked scope");
    await expect(
      readLockedPublicationSnapshot(tx, crypto.randomUUID(), budget, token),
    ).rejects.toThrow("another transaction, allowance or locked scope");
    await expect(
      readLockedPublicationSnapshot(tx, entry.assetId, budget, {
        transaction: tx,
        budget,
      }),
    ).rejects.toThrow("another transaction, allowance or locked scope");
    await db.$transaction((other) =>
      expect(
        readLockedPublicationSnapshot(other, entry.assetId, budget, token),
      ).rejects.toThrow("another transaction, allowance or locked scope"),
    );
    return { tx, token };
  });
  await expect(
    readLockedPublicationSnapshot(
      completed.tx,
      entry.assetId,
      budget,
      completed.token,
    ),
  ).rejects.toThrow();
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(99);
  await expect(
    db.$transaction(async (tx) => {
      const token = await lockPublicationSnapshots(tx, scope, exhausted);
      await readLockedPublicationSnapshot(tx, entry.assetId, exhausted, token);
    }),
  ).rejects.toThrow("100 total queried records");
}, 60_000);
