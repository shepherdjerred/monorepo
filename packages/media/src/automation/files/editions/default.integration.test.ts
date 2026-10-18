import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const value = await fileFixture(cluster.database);
  directories.push(value.directory);
  return value;
}

test("a historical cross-root shared file remains stored but cannot be quarantined", async () => {
  const f = await fixture();
  const published = await f.published();
  const retention = await f.retention();
  const second = await cluster.database.mediaItem.create({
    data: { kind: "movie", title: "Distinct canonical root" },
  });
  await cluster.database.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(second.id)], {
      createMissing: true,
    });
    await tx.assetCoverage.create({
      data: {
        assetId: published.entry.assetId,
        mediaId: second.id,
        current: true,
      },
    });
    await tx.libraryAsset.update({
      where: { id: published.entry.assetId },
      data: { editionRootId: null },
    });
  });
  let effects = 0;
  f.context.checkpoint = async () => {
    effects++;
  };
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "protected", reason: "lineage_unresolved" });
  expect(effects).toBe(0);
  expect(
    await readFile(
      path.join(f.roots.library, published.entry.libraryPath),
      "utf8",
    ),
  ).toBe(published.content);
  expect(
    await cluster.database.assetCoverage.count({
      where: { assetId: published.entry.assetId },
    }),
  ).toBe(2);
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
  ).toMatchObject({ state: "published", editionRootId: null, version: 0 });
});

test("new nondefault acquisition cannot be admitted or borrow the default reservation", async () => {
  const f = await fixture();
  const acquired = await f.acquisition();
  const operationId = crypto.randomUUID();
  const reservation = await cluster.database.acquisitionReservation.findMany({
    where: { attemptId: acquired.attempt.id },
  });
  let effects = 0;
  f.context.checkpoint = async () => {
    effects++;
  };
  await expect(
    cluster.database.acquisitionAttempt.create({
      data: {
        edition: "named-test",
        releaseId: acquired.attempt.releaseId,
        sponsorRequestId: f.request.id,
        mediaIds: [f.media.id],
        generations: z
          .record(z.string(), z.json())
          .parse(acquired.attempt.generations),
        state: "ready",
        operationId,
        torrentId: acquired.attempt.torrentId,
        recoveryEpoch: 0,
      },
    }),
  ).rejects.toThrow(
    "New movie acquisition requires exact birth choice authority",
  );
  expect(effects).toBe(0);
  expect(
    await cluster.database.acquisitionAttempt.findMany({
      where: { operationId },
    }),
  ).toEqual([]);
  expect(
    await cluster.database.acquisitionReservation.findMany({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toEqual(reservation);
  expect(
    await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    }),
  ).toMatchObject({ filePlan: null, state: "ready" });
});

test("default publication and quarantine mirror availability without changing target authority", async () => {
  const f = await fixture();
  const before = await cluster.database.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
  });
  const published = await f.published();
  const target = await cluster.database.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
  });
  expect(target).toMatchObject({
    availability: "importing",
    version: before.version,
    generation: before.generation,
    automationEpoch: before.automationEpoch,
  });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
  ).toMatchObject({ edition: "default", editionRootId: f.media.id });
  const retention = await f.retention();
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "quarantined" });
  expect(
    await cluster.database.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({
    availability: "quarantined",
    version: before.version,
    generation: before.generation,
    automationEpoch: before.automationEpoch,
  });
});
