import { z } from "zod";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import type { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";

export async function captureArchiveClaim(
  f: Awaited<ReturnType<typeof readyArchiveCleanup>>,
  mapped: boolean,
) {
  const record: MigrationRecord = {
    kind: "request",
    sourceId: "archive-late-request",
    requesterSourceId: "7",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: z.number().parse(f.file.media.tmdbId) },
    scope: "movie",
    seasons: [],
    active: true,
  };
  const timestamp = new Date().toISOString();
  const result = await new PrismaMigrationAdministration(f.db).upload(
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
    await f.db.mediaUser.update({
      where: { id: f.file.user.id },
      data: {
        plexAccountId: BigInt(
          `0x${f.file.user.id.replaceAll("-", "")}`,
        ).toString(),
      },
    });
    await grantTestRequesterAccess(f.db, f.file.user.id, "fixture-server");
    const service = new PrismaLegacyRequesterBindings(f.db, "fixture-server");
    const view = await service.list(f.prior.actor, result.captureId);
    const requester = view.requesters[0];
    if (requester === undefined) throw new Error("Late requester missing");
    await service.bind(f.prior.actor, crypto.randomUUID(), {
      captureId: result.captureId,
      requesterSourceId: requester.requesterSourceId,
      requesterEvidenceHash: requester.requesterEvidenceHash,
      userId: f.file.user.id,
      expectedRevision: requester.latestRevision,
      acknowledgeIdentityOnly: true,
    });
  }
}
