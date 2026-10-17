import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { z } from "zod";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import type { Database } from "#infrastructure/database.ts";
import { buildRecoveryClaims } from "./legacy-claims/projection.ts";
import { PrismaLegacyRequesterBindings } from "./legacy-claims/service.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";

const { fixture } = recoveryHarness();
function captureInput(tmdbId: number) {
  const request: MigrationRecord = {
    kind: "request",
    sourceId: "arrived-during-review",
    requesterSourceId: "unmapped-race",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: tmdbId },
    scope: "movie",
    seasons: [],
    active: true,
  };
  const timestamp = new Date().toISOString();
  return {
    snapshot: {
      schemaVersion: 1 as const,
      sourceInstanceId: snapshotHash(`capture-first-${String(tmdbId)}`),
      sourceKind: "seerr" as const,
      sourceVersion: "3.0.0",
      startedAt: timestamp,
      completedAt: timestamp,
      records: [request],
      endpoints: [
        {
          name: "requests" as const,
          pages: 1,
          records: 1,
          complete: true,
          stable: true,
          digest: recordDigest([request]),
          reason: "complete" as const,
        },
      ],
    },
  };
}
async function waiting(db: Database, pattern: string, event: string) {
  await expect
    .poll(
      async () => {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND wait_event = ${event} AND query LIKE ${pattern}
      AND pid <> pg_backend_pid()) AS waiting`;
        return rows[0]?.waiting;
      },
      { timeout: 2000, interval: 10 },
    )
    .toBe(true);
}

test("actual capture upload waits for reviewed release commit and the later claim cannot inherit its receipt", async () => {
  const f = await fixture();
  const tmdbId = 987_321;
  await f.db.mediaItem.update({ where: { id: f.media.id }, data: { tmdbId } });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: { serverAccountId: "200" },
  });
  const initial = await f.prepare();
  const ready = await f.responses(initial.id);
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      // SHARE permits the scope's receipt SELECT, but stops the actual final INSERT.
      await tx.$executeRaw`LOCK TABLE "RecoveryReleaseReceipt" IN SHARE MODE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 12_000 },
  );
  await locked.promise;
  const releasing = f.service.release(
    f.owner,
    crypto.randomUUID(),
    initial.id,
    releaseInput(ready),
  );
  const releasingResult = Promise.allSettled([releasing]);
  let uploading:
    ReturnType<PrismaMigrationAdministration["upload"]> | undefined;
  try {
    await waiting(f.db, "%INSERT%RecoveryReleaseReceipt%", "relation");
    const request: MigrationRecord = {
      kind: "request",
      sourceId: "arrived-after-review",
      requesterSourceId: "unmapped-7",
      plexAccountId: null,
      requesterMappingEvidenceHash: null,
      externalIds: { tmdb: tmdbId },
      scope: "movie",
      seasons: [],
      active: true,
    };
    const timestamp = new Date().toISOString();
    uploading = new PrismaMigrationAdministration(f.db).upload(f.owner, {
      snapshot: {
        schemaVersion: 1,
        sourceInstanceId: snapshotHash("capture-writer-race"),
        sourceKind: "seerr",
        sourceVersion: "3.0.0",
        startedAt: timestamp,
        completedAt: timestamp,
        records: [request],
        endpoints: [
          {
            name: "requests",
            pages: 1,
            records: 1,
            complete: true,
            stable: true,
            digest: recordDigest([request]),
            reason: "complete",
          },
        ],
      },
    });
    await waiting(f.db, "%media-legacy-requester-bindings%", "advisory");
    expect(await f.db.migrationCapture.count()).toBe(0);
  } finally {
    release.resolve(undefined);
    await blocker;
    await releasingResult;
    if (uploading !== undefined) await Promise.allSettled([uploading]);
  }
  const result = await releasing;
  if (uploading === undefined) throw new Error("Capture upload did not start");
  const uploaded = await uploading;
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.recoveryReceiptId) },
  });
  expect(receipt.claimAccounting).toEqual([]);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).not.toMatchObject({ releasedAt: null });
  const unbound = await buildRecoveryClaims(f.db, {
    planIds: [],
    mediaIds: [f.media.id],
  });
  expect(unbound.blockers).toContain("legacy_claim_requester_unmapped");
  const bindings = new PrismaLegacyRequesterBindings(f.db, "fixture");
  const available = await bindings.list(f.owner, uploaded.captureId);
  const source = available.requesters[0];
  if (source === undefined) throw new Error("Uploaded requester missing");
  await bindings.bind(f.owner, crypto.randomUUID(), {
    captureId: uploaded.captureId,
    requesterSourceId: source.requesterSourceId,
    requesterEvidenceHash: source.requesterEvidenceHash,
    userId: f.member.id,
    expectedRevision: 0,
    acknowledgeIdentityOnly: true,
  });
  const pending = await buildRecoveryClaims(f.db, {
    planIds: [],
    mediaIds: [f.media.id],
  });
  expect(pending.blockers).toEqual([]);
  expect(pending.claims).toMatchObject([
    {
      captureId: uploaded.captureId,
      userId: f.member.id,
      mediaIds: [f.media.id],
    },
  ]);
});

test("capture-first commit forces actual release to retry its older snapshot and preserve the hold", async () => {
  const f = await fixture();
  const tmdbId = 987_322;
  await f.db.mediaItem.update({ where: { id: f.media.id }, data: { tmdbId } });
  const initial = await f.prepare();
  const ready = await f.responses(initial.id);
  const locked = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      // The real capture and revision are written, but their transaction cannot commit.
      await tx.$executeRaw`LOCK TABLE "AdoptionProposal" IN SHARE MODE`;
      locked.resolve(undefined);
      await resume.promise;
    },
    { timeout: 12_000 },
  );
  await locked.promise;
  const upload = new PrismaMigrationAdministration(f.db).upload(
    f.owner,
    captureInput(tmdbId),
  );
  const uploaded = Promise.allSettled([upload]);
  let releasing: ReturnType<typeof f.service.release> | undefined;
  let settled:
    | Promise<
        PromiseSettledResult<Awaited<ReturnType<typeof f.service.release>>>[]
      >
    | undefined;
  try {
    await waiting(f.db, "%INSERT%AdoptionProposal%", "relation");
    releasing = f.service.release(
      f.owner,
      crypto.randomUUID(),
      initial.id,
      releaseInput(ready),
    );
    settled = Promise.allSettled([releasing]);
    await waiting(f.db, "%media-legacy-requester-bindings%", "advisory");
  } finally {
    resume.resolve(undefined);
    await blocker;
    await uploaded;
    await settled;
  }
  await upload;
  if (releasing === undefined) throw new Error("Release did not start");
  await expect(releasing).rejects.toMatchObject({
    code: "recovery_review_changed",
  });
  expect(
    await f.db.recoveryReleaseReceipt.count({
      where: { reviewId: initial.id },
    }),
  ).toBe(0);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ releasedAt: null });
  expect(
    await buildRecoveryClaims(f.db, { planIds: [], mediaIds: [f.media.id] }),
  ).toMatchObject({ blockers: ["legacy_claim_requester_unmapped"] });
  const refreshed = await f.prepare();
  expect(refreshed.scope.blockers).toContain("legacy_claim_requester_unmapped");
});

test("concurrent actual capture uploads retry the knowledge fence without duplicating immutable records", async () => {
  const f = await fixture();
  const input = captureInput(987_323);
  const service = new PrismaMigrationAdministration(f.db);
  const [first, second] = await Promise.all([
    service.upload(f.owner, input),
    service.upload(f.owner, input),
  ]);
  expect(second.id).toBe(first.id);
  expect(second.captureId).toBe(first.captureId);
  expect(
    await f.db.migrationRecord.count({ where: { captureId: first.captureId } }),
  ).toBe(1);
  expect(
    await f.db.adoptionProposal.count({
      where: { captureId: first.captureId },
    }),
  ).toBe(1);
});
