import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { createNativeArchiveNetworkActivities } from "./activities.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test.each([false, true])(
  "late mapped=%s claim during archive network observation durably reopens protection",
  async (mapped) => {
    const db = harness.database();
    const f = await nativeArchiveFixture(db, harness.context().cipher, {
      chain: 2,
      publicationAgeDays: 8,
    });
    directories.push(f.file.directory);
    await f.prepare();
    await f.apply();
    await db.recoveryHold.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
    });
    await db.mediaIntent.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { automationEpoch: f.runtime.recoveryEpoch, desiredPresence: true },
    });
    const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { receipt: { planId: f.planId } },
    });
    const operationId = await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: row.id,
        expectedVersion: row.version,
      }),
    );
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(operationId) },
    });
    const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
    f.observerContext.plex.activeSessions = async () => {
      const record: MigrationRecord = {
        kind: "request",
        sourceId: "late-archive-request",
        requesterSourceId: "7",
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
        externalIds: { tmdb: z.number().parse(f.file.media.tmdbId) },
        scope: "movie",
        seasons: [],
        active: true,
      };
      const timestamp = new Date().toISOString();
      const uploaded = await new PrismaMigrationAdministration(db).upload(
        f.prior.actor,
        {
          snapshot: {
            schemaVersion: 1,
            sourceKind: "seerr",
            sourceInstanceId: snapshotHash(crypto.randomUUID()),
            sourceVersion: "3.0.0",
            startedAt: timestamp,
            completedAt: timestamp,
            records: [record],
            endpoints: [
              {
                name: "requests",
                pages: 1,
                records: 1,
                complete: true,
                stable: true,
                reason: "complete",
                digest: recordDigest([record]),
              },
            ],
          },
        },
      );
      if (mapped) {
        const user = await db.mediaUser.create({
          data: {
            plexAccountId: String(
              crypto.getRandomValues(new Uint32Array(1))[0],
            ),
            displayName: "Late archive requester",
          },
        });
        await grantTestRequesterAccess(
          db,
          user.id,
          f.observerContext.expectedServerMachineId,
        );
        const service = new PrismaLegacyRequesterBindings(
          db,
          f.observerContext.expectedServerMachineId,
        );
        const view = await service.list(f.prior.actor, uploaded.captureId);
        const requester = view.requesters[0];
        if (requester === undefined)
          throw new Error("Actual captured requester missing");
        await service.bind(f.prior.actor, crypto.randomUUID(), {
          captureId: uploaded.captureId,
          requesterSourceId: requester.requesterSourceId,
          requesterEvidenceHash: requester.requesterEvidenceHash,
          userId: user.id,
          expectedRevision: requester.latestRevision,
          acknowledgeIdentityOnly: true,
        });
      }
      return [];
    };
    const activities = createNativeArchiveNetworkActivities({
      ...f.observerContext,
      qbittorrent: {
        ...f.observerContext.qbittorrent,
        login: () => Promise.resolve(),
      },
    });
    expect(await activities.observeNativeArchiveCleanup(input)).toEqual({
      status: "protected",
      reason: "archive_legacy_claims_unresolved",
    });
    expect(
      await db.recoveryHold.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: f.file.media.id, edition: "default" },
        },
      }),
    ).toMatchObject({
      releasedAt: null,
      reason: "legacy_claim_reconciliation_required",
    });
    expect(
      await db.nativeRecoveryObservation.count({
        where: { planId: f.planId, kind: "archive_cleanup_network" },
      }),
    ).toBe(0);
    expect(
      await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      state: "protected",
      executionEvidence: null,
      completion: null,
    });
  },
);
