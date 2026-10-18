import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";
import { compensationPublicationContext } from "#automation/native-compensation/fixtures/publication.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
let directory: string | undefined;

beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeCompensationFixture(db, harness.context().cipher);
  directory = fixture.file.directory;
  await fixture.prepare();
  const inverse = await fixture.apply();
  await fixture.observe(inverse);
  expect(
    await fixture.activities.compensateNativePublicationFiles(inverse),
  ).toEqual({ status: "compensated", reason: null });
  await reconcileCompensationHousehold(db, {
    owner: fixture.prior.actor,
    requester: fixture.file.user,
    mediaIds: fixture.published.entry.mediaIds,
    kind: "movie",
    serverMachineId: "server",
  });
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: inverse.continuationId },
    });
  activity = {
    ...inverse,
    operationId: z.uuid().parse(row.publicationCoordinatorOperationId),
  };
}, 60_000);
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

async function assertHeld() {
  const db = harness.database();
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  expect(row.fenceRelease).toBeNull();
  expect(row.verifiedPublication).toBeNull();
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: fixture.file.media.id },
  });
  expect(media.availability).toBe("importing");
}

describe(
  "compensation authority freshness",
  { concurrent: false, shuffle: false },
  () => {
    test.each(["lease", "storage", "owner"] as const)(
      "%s change during the second identity lookup prevents any refresh",
      async (changed) => {
        const db = harness.database();
        const lease = await db.legacyWriterLease.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const storage = await db.mediaStorageAuthority.findMany();
        const requests: string[] = [];
        let identities = 0;
        const context = compensationPublicationContext(
          harness.context(),
          fixture.observerContext,
          {
            requests,
            beforeIdentity: async () => {
              identities++;
              if (identities !== 2) return;
              if (changed === "lease")
                await db.legacyWriterLease.update({
                  where: { id: "singleton" },
                  data: { expiresAt: new Date(Date.now() - 1) },
                });
              else if (changed === "storage")
                await db.mediaStorageAuthority.updateMany({
                  data: { expiresAt: new Date(Date.now() - 1) },
                });
              else
                await db.mediaUser.update({
                  where: { id: fixture.prior.actor.id },
                  data: { restricted: true },
                });
            },
          },
        );
        try {
          const result = await publishCompensatedMedia(
            context,
            activity,
            testCompensationExecution(),
          );
          expect(identities).toBe(2);
          expect(requests.filter((path) => path.endsWith("/refresh"))).toEqual(
            [],
          );
          expect(result.status).toBe("blocked");
          await assertHeld();
        } finally {
          await db.legacyWriterLease.update({
            where: { id: "singleton" },
            data: { expiresAt: lease.expiresAt },
          });
          for (const row of storage)
            await db.mediaStorageAuthority.update({
              where: { rootPath: row.rootPath },
              data: { expiresAt: row.expiresAt },
            });
          await db.mediaUser.update({
            where: { id: fixture.prior.actor.id },
            data: { restricted: false },
          });
        }
      },
    );

    test("real lease expiry across the final awaited fence write rolls back availability and release", async () => {
      const db = harness.database();
      const lease = await db.legacyWriterLease.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      await db.$executeRawUnsafe(
        'CREATE SEQUENCE "compensation_freshness_wait"',
      );
      await db.$executeRawUnsafe(
        `CREATE FUNCTION compensation_freshness_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."fenceRelease" IS NOT NULL AND OLD."fenceRelease" IS NULL THEN PERFORM nextval('"compensation_freshness_wait"'); PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER compensation_freshness_wait BEFORE UPDATE ON "NativePublicationCompensationContinuation" FOR EACH ROW EXECUTE FUNCTION compensation_freshness_wait()',
      );
      const requests: string[] = [];
      const context = compensationPublicationContext(
        harness.context(),
        fixture.observerContext,
        {
          requests,
          beforeRefresh: async () => {
            await db.legacyWriterLease.update({
              where: { id: "singleton" },
              data: { expiresAt: new Date(Date.now() + 1000) },
            });
          },
        },
      );
      try {
        const result = await publishCompensatedMedia(
          context,
          activity,
          testCompensationExecution(),
        );
        const waited = await db.$queryRaw<
          { is_called: boolean }[]
        >`SELECT is_called FROM "compensation_freshness_wait"`;
        expect(waited).toEqual([{ is_called: true }]);
        expect(result).toEqual({
          status: "blocked",
          reason: "compensation_publication_authority_expired",
        });
        await assertHeld();
      } finally {
        await db.$executeRawUnsafe(
          'DROP TRIGGER compensation_freshness_wait ON "NativePublicationCompensationContinuation"',
        );
        await db.$executeRawUnsafe(
          "DROP FUNCTION compensation_freshness_wait()",
        );
        await db.$executeRawUnsafe(
          'DROP SEQUENCE "compensation_freshness_wait"',
        );
        await db.legacyWriterLease.update({
          where: { id: "singleton" },
          data: { expiresAt: lease.expiresAt },
        });
      }
    });
  },
);
