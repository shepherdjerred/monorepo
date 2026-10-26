import { afterAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture(mapped = false) {
  const value = await (mapped ? mappedPublicationFixture : fileFixture)(
    harness.database(),
  );
  directories.push(value.directory);
  return value;
}

test("a historical cross-root shared file remains stored but cannot be quarantined", async () => {
  const f = await fixture();
  const published = await f.published();
  const retention = await f.retention();
  const second = await harness.database().mediaItem.create({
    data: { kind: "movie", title: "Distinct canonical root" },
  });
  await harness.database().$transaction(async (tx) => {
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
    await harness.database().assetCoverage.count({
      where: { assetId: published.entry.assetId },
    }),
  ).toBe(2);
  expect(
    await harness.database().libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
  ).toMatchObject({ state: "published", editionRootId: null, version: 0 });
});

test("new nondefault acquisition cannot be admitted or borrow the default reservation", async () => {
  const f = await fixture();
  const acquired = await f.acquisition();
  const operationId = crypto.randomUUID();
  const reservation = await harness.database().acquisitionReservation.findMany({
    where: { attemptId: acquired.attempt.id },
  });
  let effects = 0;
  f.context.checkpoint = async () => {
    effects++;
  };
  await expect(
    harness.database().acquisitionAttempt.create({
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
    await harness.database().acquisitionAttempt.findMany({
      where: { operationId },
    }),
  ).toEqual([]);
  expect(
    await harness.database().acquisitionReservation.findMany({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toEqual(reservation);
  expect(
    await harness.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    }),
  ).toMatchObject({ filePlan: null, state: "ready" });
});

test("default publication and quarantine mirror availability without changing target authority", async () => {
  const f = await fixture(true);
  const before = await harness.database().mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
  });
  const published = await preparePhysicalPublication(f);
  const target = await harness.database().mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
  });
  expect(target).toMatchObject({
    availability: "importing",
    version: before.version,
    generation: before.generation,
    automationEpoch: before.automationEpoch,
  });
  expect(
    await harness.database().libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
  ).toMatchObject({ edition: "default", editionRootId: f.media.id });
  const bound = await prepareBoundRetention(f, published, harness.context());
  const retention = bound.retention;
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "quarantined" });
  expect(
    await harness.database().mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({
    availability: "quarantined",
    version: before.version,
    generation: before.generation,
    automationEpoch: before.automationEpoch,
  });
});
