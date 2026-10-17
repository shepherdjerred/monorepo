import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { PrismaNativeCompensation } from "#infrastructure/native-compensation/service.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "./test-fixture.ts";
import { reconcileCompensationHousehold } from "./fixtures/household.ts";
import { compensationPublicationContext } from "./fixtures/publication.ts";
import { publishCompensatedMedia } from "./publication.ts";

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

describe(
  "current publication generation fencing",
  { concurrent: false, shuffle: false },
  () => {
    test("expiry during refresh prevents later Plex reads and availability commit", async () => {
      const requests: string[] = [];
      let expired = false;
      const failure = new Error(
        "Compensation publication invocation expired during refresh",
      );
      const execution = testCompensationExecution();
      const context = compensationPublicationContext(
        harness.context(),
        fixture.observerContext,
        {
          requests,
          beforeRefresh: () => {
            expired = true;
            return Promise.resolve();
          },
        },
      );
      await expect(
        publishCompensatedMedia(context, activity, {
          ...execution,
          assertActive: () => {
            execution.assertActive();
            if (expired) throw failure;
          },
        }),
      ).rejects.toBe(failure);
      expect(
        requests.some(
          (value) => value.endsWith("/all") || value.includes("/metadata/"),
        ),
      ).toBe(false);
      const row = await harness
        .database()
        .nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: activity.continuationId },
        });
      expect(row.fenceRelease).toBeNull();
      expect(row.verifiedPublication).toBeNull();
    });

    test.each(["owner", "coverage"] as const)(
      "a %s change while Plex refresh is awaited cannot release playback",
      async (changed) => {
        const db = harness.database();
        const requests: string[] = [];
        const coverage = {
          assetId_mediaId: {
            assetId: fixture.asset.id,
            mediaId: fixture.file.media.id,
          },
        };
        let injected = false;
        const context = compensationPublicationContext(
          harness.context(),
          fixture.observerContext,
          {
            requests,
            beforeRefresh: async () => {
              if (changed === "owner")
                await db.mediaUser.update({
                  where: { id: fixture.prior.actor.id },
                  data: { restricted: true, version: { increment: 1 } },
                });
              else
                await db.assetCoverage.update({
                  where: coverage,
                  data: { current: false },
                });
              injected = true;
            },
          },
        );
        try {
          expect(
            await publishCompensatedMedia(
              context,
              activity,
              testCompensationExecution(),
            ),
          ).toEqual({
            status: "blocked",
            reason:
              changed === "owner"
                ? "compensation_owner_changed"
                : "compensation_publication_binding_changed",
          });
          expect(injected).toBe(true);
          const row =
            await db.nativePublicationCompensationContinuation.findUniqueOrThrow(
              { where: { id: activity.continuationId } },
            );
          expect(row.fenceRelease).toBeNull();
          expect(row.verifiedPublication).toBeNull();
          const media = await db.mediaItem.findUniqueOrThrow({
            where: { id: fixture.file.media.id },
          });
          expect(media.availability).toBe("importing");
        } finally {
          // Disposable concurrent-change injection; no publication succeeds on this state.
          if (changed === "owner")
            await db.mediaUser.update({
              where: { id: fixture.prior.actor.id },
              data: { restricted: false, version: { increment: 1 } },
            });
          else
            await db.assetCoverage.update({
              where: coverage,
              data: { current: true },
            });
        }
      },
    );
  },
);

describe(
  "fresh publication coordinator after intent changes",
  { concurrent: false, shuffle: false },
  () => {
    test("a real fresh request during Plex refresh invalidates the older immutable publication command", async () => {
      const db = harness.database();
      const before = await db.operation.findUniqueOrThrow({
        where: { id: activity.operationId },
      });
      const requests: string[] = [];
      const commands = new PrismaMediaCommands(db, {
        keepDays: 30,
        serverMachineId: "server",
      });
      let changed = false;
      const context = compensationPublicationContext(
        harness.context(),
        fixture.observerContext,
        {
          requests,
          beforeRefresh: async () => {
            if (changed)
              throw new Error("Unexpected repeated publication refresh");
            await commands.createRequest(
              fixture.file.user,
              crypto.randomUUID(),
              {
                mediaId: fixture.file.media.id,
                subtitleLanguages: [],
                includeSpecials: false,
              },
            );
            changed = true;
          },
        },
      );
      expect(
        await publishCompensatedMedia(
          context,
          activity,
          testCompensationExecution(),
        ),
      ).toEqual({
        status: "blocked",
        reason: "compensation_publication_command_changed",
      });
      expect(changed).toBe(true);
      expect(requests.filter((item) => item.endsWith("/refresh"))).toHaveLength(
        1,
      );
      const row =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: activity.continuationId },
        });
      expect(row.verifiedPublication).toBeNull();
      expect(row.fenceRelease).toBeNull();
      expect(row.publicationCoordinatorOperationId).toBe(activity.operationId);
      const unchanged = await db.operation.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(unchanged.payload).toEqual(before.payload);
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: fixture.file.media.id },
      });
      expect(media.availability).toBe("importing");
    });

    test("only exact terminal Workflow proof queues a fresh command that can verify Plex and release the fence", async () => {
      const db = harness.database();
      const row =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: activity.continuationId },
        });
      let closed = false;
      const service = new PrismaNativeCompensation(db, (workflowId) => {
        expect(workflowId).toBe(`media-operation-${activity.operationId}`);
        return Promise.resolve({
          status: closed ? "COMPLETED" : "RUNNING",
          runId: "actual-fixture-terminal-run",
        });
      });
      await expect(
        service.retry(fixture.prior.actor, crypto.randomUUID(), row.id, {
          expectedVersion: row.version,
        }),
      ).rejects.toMatchObject({
        code: "compensation_coordinator_not_terminal",
      });
      closed = true;
      const result = await service.retry(
        fixture.prior.actor,
        crypto.randomUUID(),
        row.id,
        { expectedVersion: row.version },
      );
      const operationId = z.uuid().parse(result.operationId);
      expect(operationId).not.toBe(activity.operationId);
      const requests: string[] = [];
      const context = compensationPublicationContext(
        harness.context(),
        fixture.observerContext,
        { requests },
      );
      expect(
        await publishCompensatedMedia(
          context,
          activity,
          testCompensationExecution(),
        ),
      ).toEqual({
        status: "blocked",
        reason: "compensation_publication_coordinator_changed",
      });
      expect(requests).toEqual([]);
      expect(
        await publishCompensatedMedia(
          context,
          { ...activity, operationId },
          testCompensationExecution(),
        ),
      ).toEqual({ status: "available", reason: null });
      const settled =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: row.id },
        });
      expect(settled.descriptor).toEqual(row.descriptor);
      expect(settled.completion).toEqual(row.completion);
      expect(settled.fenceRelease).not.toBeNull();
      expect(settled.verifiedPublication).not.toBeNull();
    });
  },
);
