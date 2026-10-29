import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { plexBindingFixture, bindingTestExecution } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await plexBindingFixture(harness.database(), harness.context(), {
    publicationPending: true,
  });
  directories.push(f.files.directory);
  return f;
}

test.each([false, true])(
  "exact publication ACK survives a lost response with finalized=%s and unavailable fresh configuration",
  async (finalized) => {
    const f = await fixture();
    const db = harness.database();
    const activities = createPublicationActivities(f.context);
    const lost = new Error(
      "Synthetic caller lost committed publication response",
    );
    await expect(
      activities.publishMediaToPlex(f.published.input).then((result) => {
        expect(result).toEqual({ status: "available", reason: null });
        throw lost;
      }),
    ).rejects.toBe(lost);
    if (finalized) await activities.finalizeMediaAcquisition(f.published.input);
    const before = {
      operation: await db.operation.findUniqueOrThrow({
        where: { id: f.published.input.operationId },
      }),
      attempt: await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.published.input.attemptId },
      }),
      pointers: await db.plexBindingCurrent.findMany({
        where: { mediaId: f.files.media.id },
      }),
      evidence: await db.plexAssociationEvidence.findMany({
        where: { mediaId: f.files.media.id },
      }),
      asset: await db.libraryAsset.findUniqueOrThrow({
        where: { id: f.asset.id },
      }),
      deliveries: await db.notificationDelivery.count(),
      calls: [...f.calls],
    };
    expect(
      z
        .object({ acquisitionPlexReceipt: z.unknown() })
        .parse(before.operation.result).acquisitionPlexReceipt,
    ).toBeDefined();
    if (finalized)
      expect(
        await db.acquisitionReservation.count({
          where: { attemptId: before.attempt.id },
        }),
      ).toBe(0);
    const expired = bindingTestExecution();
    const replay = createPublicationActivities(
      {
        ...f.context,
        plexAccess: () =>
          Promise.reject(new Error("Exact ACK must not resolve configuration")),
      },
      () => ({ ...expired, expiresAtMs: Date.now() - 1 }),
    );
    expect(await replay.publishMediaToPlex(f.published.input)).toEqual({
      status: "available",
      reason: null,
    });
    expect(
      await db.operation.findUniqueOrThrow({
        where: { id: before.operation.id },
      }),
    ).toEqual(before.operation);
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: before.attempt.id },
      }),
    ).toEqual(before.attempt);
    expect(
      await db.plexBindingCurrent.findMany({
        where: { mediaId: f.files.media.id },
      }),
    ).toEqual(before.pointers);
    expect(
      await db.plexAssociationEvidence.findMany({
        where: { mediaId: f.files.media.id },
      }),
    ).toEqual(before.evidence);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(before.asset);
    expect(await db.notificationDelivery.count()).toBe(before.deliveries);
    expect(f.calls).toEqual(before.calls);
  },
);

test("publication ACK rejects changed input and a substituted literal FilePlan read without new network effects", async () => {
  const f = await fixture();
  const db = harness.database();
  expect(
    await createPublicationActivities(f.context).publishMediaToPlex(
      f.published.input,
    ),
  ).toEqual({ status: "available", reason: null });
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: f.published.input.operationId },
  });
  const calls = [...f.calls];
  await expect(
    createPublicationActivities(f.context).publishMediaToPlex({
      ...f.published.input,
      attemptId: crypto.randomUUID(),
    }),
  ).rejects.toThrow(
    "Acquisition Plex receipt raw input or expected hash changed",
  );
  let reached = false;
  // Corrupt only the returned raw database value; never rewrite stored immutable history.
  const substituted = queryFixtureDatabase(db, {
    query: {
      acquisitionAttempt: {
        async findUniqueOrThrow({ args, query }) {
          const row = await query(args);
          if (row.id !== f.published.input.attemptId) return row;
          reached = true;
          return {
            ...row,
            filePlan: z
              .array(z.record(z.string(), z.json()))
              .parse(row.filePlan)
              .map((entry) => ({
                ...entry,
                unknownReceiptField: "must remain hash-bound",
              })),
          };
        },
      },
    },
  });
  await expect(
    createPublicationActivities({
      ...f.context,
      db: substituted,
    }).publishMediaToPlex(f.published.input),
  ).rejects.toThrow("Acquisition Plex receipt command or attempt changed");
  expect(reached).toBe(true);
  expect(f.calls).toEqual(calls);
  expect(
    await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
  ).toEqual(operation);
});

test("a completed physical attempt without a publication receipt cannot manufacture an ACK", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: f.published.input.operationId },
  });
  expect(
    await db.acquisitionReservation.count({
      where: { attemptId: f.published.input.attemptId },
    }),
  ).toBe(0);
  expect(
    await createPublicationActivities(f.context).publishMediaToPlex(
      f.published.input,
    ),
  ).toEqual({ status: "blocked", reason: "scope_changed" });
  expect(f.calls).toEqual([]);
  expect(
    await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
  ).toEqual(operation);
  expect(
    await db.plexAssociationEvidence.count({
      where: { mediaId: f.files.media.id },
    }),
  ).toBe(0);
});
