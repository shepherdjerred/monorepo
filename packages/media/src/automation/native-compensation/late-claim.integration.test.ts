import { afterAll, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "./test-fixture.ts";
import { reconcileCompensationHousehold } from "./fixtures/household.ts";
import { compensationPublicationContext } from "./fixtures/publication.ts";
import { publishCompensatedMedia } from "./publication.ts";

const harness = automationTestHarness();
const directories: string[] = [];
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
beforeEach(async () => {
  const db = harness.database();
  fixture = await nativeCompensationFixture(db, harness.context().cipher);
  directories.push(fixture.file.directory);
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
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function captureLateClaim(mapped: boolean) {
  const db = harness.database();
  const record: MigrationRecord = {
    kind: "request",
    sourceId: crypto.randomUUID(),
    requesterSourceId: "7",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: z.number().parse(fixture.file.media.tmdbId) },
    scope: "movie",
    seasons: [],
    active: true,
  };
  const timestamp = new Date().toISOString();
  const upload = await new PrismaMigrationAdministration(db).upload(
    fixture.prior.actor,
    {
      snapshot: {
        schemaVersion: 1,
        sourceKind: "seerr",
        sourceVersion: "3.0.0",
        sourceInstanceId: snapshotHash(crypto.randomUUID()),
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
  if (!mapped) return;
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: String(crypto.getRandomValues(new Uint32Array(1))[0]),
      displayName: "Late compensation requester",
    },
  });
  await grantTestRequesterAccess(db, user.id, "server");
  const bindings = new PrismaLegacyRequesterBindings(db, "server");
  const view = await bindings.list(fixture.prior.actor, upload.captureId);
  const requester = view.requesters[0];
  if (requester === undefined)
    throw new Error("Actual late requester capture missing");
  await bindings.bind(fixture.prior.actor, crypto.randomUUID(), {
    captureId: upload.captureId,
    requesterSourceId: requester.requesterSourceId,
    requesterEvidenceHash: requester.requesterEvidenceHash,
    userId: user.id,
    expectedRevision: requester.latestRevision,
    acknowledgeIdentityOnly: true,
  });
}

test.each([false, true])(
  "a mapped=%s claim arriving during Plex verification durably reopens household protection",
  async (mapped) => {
    const db = harness.database();
    const where = {
      mediaId_edition: { mediaId: fixture.file.media.id, edition: "default" },
    };
    const previousHold = await db.recoveryHold.findUniqueOrThrow({ where });
    expect(previousHold.releasedAt).not.toBeNull();
    let captured = false;
    const context = compensationPublicationContext(
      harness.context(),
      fixture.observerContext,
      {
        requests: [],
        beforeRefresh: async () => {
          if (captured) throw new Error("Late capture callback repeated");
          await captureLateClaim(mapped);
          captured = true;
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
      reason: "legacy_claim_reconciliation_required",
    });
    expect(captured).toBe(true);
    expect(await db.recoveryHold.findUniqueOrThrow({ where })).toMatchObject({
      releasedAt: null,
      reason: "legacy_claim_reconciliation_required",
    });
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
  },
);
