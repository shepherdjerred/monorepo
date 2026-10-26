import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import type { Database } from "#infrastructure/database.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { NativeRecoveryScopeSchema } from "#shared/native-recovery.ts";
import {
  NativePublishedScopeV2Schema,
  FinishedNativeV2Schema,
} from "#shared/native-recovery/lifecycle.ts";
import { FinishedNativeSchema } from "#automation/native-recovery/plan.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readNativePlexReceipt } from "./native/native-version.ts";
import {
  readCurrentPlexBinding,
  readLegacyDefaultPlexDisplay,
} from "./read.ts";
import { readCompletedAcquisitionPlexPublication } from "./publication-receipt.ts";

test("populated022 preserves literal history, movie birth and full watch fence while023 protects legacy display", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017002200_movie_edition_choice",
  });
  const db = cluster.database;
  let directory: string | undefined;
  try {
    // Real explicit choice and physical FilePlan producer on the actual022 schema.
    // Its injected media probe is synthetic; no live Plex verification is claimed.
    const f = await mappedPublicationFixture(db);
    directory = f.directory;
    const published = await f.published();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: published.attempt.id },
    });
    expect(attempt.movieEditionChoiceId).not.toBeNull();
    expect(attempt.movieEditionAuthority).not.toBeNull();
    expect(attempt.filePlan).not.toBeNull();
    // Explicit pre023 display metadata, written once before the migration. It is
    // deliberately insufficient to authorize a serving binding after migration.
    await db.$transaction(async (tx) => {
      await recordVerifiedPublication(tx, [asset.id], 0);
      await tx.mediaItem.update({
        where: { id: f.media.id },
        data: {
          availability: "available",
          externalIds: { plexRatingKey: "901", plexSectionId: "1" },
        },
      });
      await tx.watchObservationFence.create({
        data: {
          mediaId: f.media.id,
          edition: "default",
          issuedRevision: 9_223_372_036_854_775_807n,
          settledRevision: 9_223_372_036_854_775_806n,
        },
      });
      await tx.watchState.create({
        data: {
          userId: f.user.id,
          mediaId: f.media.id,
          edition: "default",
          watched: true,
          source: "plex",
          observedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
    });
    const receipts = await historicalFormats(db, {
      assetId: asset.id,
      mediaId: f.media.id,
      actorId: f.user.id,
    });
    const before = await rawHistory(db);
    cluster.applyMigration("20261017002300_plex_association_binding");
    expect(await rawHistory(db)).toEqual(before);
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
    ).toEqual(attempt);
    expect(
      await db.watchObservationFence.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toMatchObject({
      issuedRevision: 9_223_372_036_854_775_807n,
      settledRevision: 9_223_372_036_854_775_806n,
    });
    for (const receiptId of receipts)
      expect(
        await db.$transaction((tx) => readNativePlexReceipt(tx, receiptId)),
      ).toBeNull();
    const read = {
      scope: { mediaId: f.media.id, edition: "default" as const },
      assetId: asset.id,
      access: {
        serverMachineId: "fixture-server",
        sectionId: "1",
        sectionType: "movie" as const,
      },
    };
    expect(
      await db.$transaction((tx) => readCurrentPlexBinding(tx, read)),
    ).toEqual({ status: "protected", reason: "missing_binding" });
    expect(
      await db.$transaction((tx) => readLegacyDefaultPlexDisplay(tx, read)),
    ).toEqual({
      status: "legacy_association_unverified",
      ratingKey: "901",
      sectionId: "1",
    });
    expect(
      await db.$transaction((tx) =>
        readCompletedAcquisitionPlexPublication(tx, published.input),
      ),
    ).toBeNull();
    expect(await db.plexAssociationEvidence.count()).toBe(0);
    expect(await db.plexBindingCurrent.count()).toBe(0);
    expect(await db.plexWatchProjection.count()).toBe(0);
    expect(await db.plexBindingVerificationReceipt.count()).toBe(0);
    expect(await db.nativePlexProofBatch.count()).toBe(0);
    expect(await rawHistory(db)).toEqual(before);
  } finally {
    await cluster.close();
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

/** Strict synthetic historical FORMAT rows, not a captured old production grant.
 * They exercise literal SQL preservation and the legacy dispatch boundary only. */
async function historicalFormats(
  db: Database,
  input: { assetId: string; mediaId: string; actorId: string },
) {
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: input.assetId },
  });
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: input.mediaId },
  });
  const operation = await db.operation.create({
    data: {
      kind: "restore_observe",
      status: "completed",
      userId: input.actorId,
      payload: {
        literal: String.raw`Synthetic pre023 history: Ω\path"quote`,
        recoveryEpoch: 1,
      },
      result: {
        reason: null,
        originalNested: { order: [3, 1, 2], absentIsNotNull: null },
      },
    },
  });
  const scope1 = NativeRecoveryScopeSchema.parse({
    schemaVersion: 1,
    request: {
      restoreOperationId: operation.id,
      recoveryEpoch: 1,
      runtimeVersion: 0,
      activation: "activate",
      assetIds: [asset.id],
    },
    media: [
      {
        id: media.id,
        title: media.title,
        kind: "movie",
        version: media.version,
        tmdbId: media.tmdbId,
        externalIds: media.externalIds,
        seasonNumber: null,
        episodeNumber: null,
        parent: null,
        intent: null,
        profile: null,
      },
    ],
    files: [
      {
        assetId: asset.id,
        assetVersion: asset.version,
        canonicalPath: asset.path,
        libraryKind: "movies",
        checksum: asset.checksum,
        sizeBytes: String(asset.sizeBytes),
        ownershipEpoch: asset.ownershipEpoch,
        properties: asset.properties,
        mediaIds: [media.id],
        subtitles: [],
      },
    ],
    storageRoots: ["/data/movies", "/data/tv"].map((rootPath) => ({
      rootPath,
      pvcUid: "synthetic-historical-pvc",
      volumeName: "synthetic-historical-volume",
      volumePath: rootPath,
      receipt: {
        kind: "legacy",
        id: crypto.randomUUID(),
        planHash: "a".repeat(64),
      },
    })),
    subtitlePolicies: [],
    household: { syntheticHistoricalFormat: true },
    lifecycle: {},
    torrents: [],
  });
  const scope2 = NativePublishedScopeV2Schema.parse({
    ...scope1,
    schemaVersion: 2,
    lifecycleKind: "published",
    terminalDependencies: [
      {
        cleanupId: crypto.randomUUID(),
        kind: "purged",
        birthEpoch: 0,
        assetIds: [crypto.randomUUID(), asset.id],
        rowDigest: "b".repeat(64),
        files: [
          {
            canonicalPath: "/data/movies/.media-control/rollback/historical",
            expectedChecksum: null,
          },
        ],
        journals: [
          {
            operationId: "synthetic-historical-purge",
            kind: "purge",
            source: "/data/movies/.media-control/rollback/historical",
            target: "/data/movies/.media-control/purged/historical",
            sha256: "c".repeat(64),
            previousSha256: null,
          },
        ],
      },
    ],
  });
  const ids: string[] = [];
  for (const scope of [scope1, scope2]) {
    const raw = {
      schemaVersion: scope.schemaVersion,
      ...(scope.schemaVersion === 1
        ? {}
        : { lifecycleKind: scope.lifecycleKind }),
      scopeHash: identityHash(scope),
      network: { literalSyntheticOldNetwork: ["one", "two"] },
      files: { literalSyntheticOldFileAudit: { unknownToNewProtocol: true } },
    };
    const finished =
      scope.schemaVersion === 1
        ? FinishedNativeSchema.parse(raw)
        : FinishedNativeV2Schema.parse(raw);
    const planHash = identityHash(finished);
    const plan = await db.nativeRecoveryPlan.create({
      data: {
        restoreOperationId: operation.id,
        actorId: input.actorId,
        recoveryEpoch: 1,
        runtimeVersion: 0,
        requestHash: identityHash(scope.request),
        scope: z.record(z.string(), z.json()).parse(scope),
        state: "applied",
        plan: z.record(z.string(), z.json()).parse(finished),
        planHash,
      },
    });
    const receipt = await db.nativeRecoveryReceipt.create({
      data: {
        planId: plan.id,
        actorId: input.actorId,
        recoveryEpoch: 1,
        previousRuntimeVersion: 0,
        runtimeVersion: 1,
        planHash,
        selection: {
          scope: z.json().parse(scope),
          networkEvidence: raw.network,
          fileEvidence: raw.files,
          bindings: [{ assetId: asset.id, historicalFormatOnly: true }],
        },
      },
    });
    await db.nativeRecoveryObservation.create({
      data: {
        planId: plan.id,
        kind: "network",
        evidence: raw.network,
        evidenceHash: identityHash(raw.network),
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-01T00:01:00.000Z"),
      },
    });
    ids.push(receipt.id);
  }
  return ids;
}

async function rawHistory(db: Database) {
  // Text returned by PostgreSQL compares every existing column and raw nested JSON,
  // including BigInt without a JavaScript Number conversion.
  return db.$queryRaw<{ history: string }[]>`SELECT jsonb_build_object(
    'operations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "Operation" r),
    'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "AcquisitionAttempt" r),
    'choices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "MovieEditionChoice" r),
    'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "MediaRequest" r),
    'plans',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "NativeRecoveryPlan" r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "NativeRecoveryReceipt" r),
    'observations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "NativeRecoveryObservation" r),
    'transitions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "MediaPublicationTransition" r),
    'assets',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "LibraryAsset" r),
    'watch',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r."userId",r."mediaId",r.edition) FROM "WatchState" r),
    'fences',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r."mediaId",r.edition) FROM "WatchObservationFence" r)
  )::text AS history`;
}
