import { describe, expect, it } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { FilePlanSchema, RemovalPlanSchema } from "#automation/files/types.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { SubtitlePolicySchema } from "#shared/subtitle-policy.ts";
import { z } from "zod";
import { nativeHousehold } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const migration = "20261017001700_default_edition_scope";

describe("default scope populated migration", () => {
  it("preserves existing authority and sparse orphan/multi-root references", async () => {
    const cluster = await startMediaTestPostgres({
      migrationCeiling: "20261017001600_visibility",
    });
    const db = cluster.database;
    try {
      const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
      const [
        movie,
        series,
        season,
        episode,
        direct,
        orphan,
        orphanSeason,
        catalog,
      ] = ids;
      if (
        !movie ||
        !series ||
        !season ||
        !episode ||
        !direct ||
        !orphan ||
        !orphanSeason ||
        !catalog
      )
        throw new Error("Fixture identity missing");
      for (const [id, kind, parent] of [
        [movie, "movie", null],
        [series, "series", null],
        [season, "season", series],
        [episode, "episode", season],
        [direct, "episode", series],
        [orphan, "episode", null],
        [orphanSeason, "season", null],
        [catalog, "movie", null],
      ]) {
        await db.$executeRaw`INSERT INTO "MediaItem" (id,kind,title,"parentId","updatedAt") VALUES (${id},${kind}::"MediaKind",'Historical',${parent},'2020-01-01')`;
      }
      const user = crypto.randomUUID();
      await db.$executeRaw`INSERT INTO "MediaUser" (id,"plexAccountId","displayName","updatedAt") VALUES (${user},${user},'Household','2020-01-01')`;
      await db.$executeRaw`INSERT INTO "MediaIntent" ("mediaId","automationEpoch",generation,version,"desiredPresence",monitoring,"updatedAt") VALUES (${movie},7,12,9,true,true,'2020-01-01')`;
      for (const id of [series, season, episode, direct, orphan, orphanSeason])
        await db.$executeRaw`INSERT INTO "RetentionHold" (id,"userId","mediaId","isPin") VALUES (${crypto.randomUUID()},${user},${id},true)`;
      const request = crypto.randomUUID();
      await db.$executeRaw`INSERT INTO "MediaRequest" (id,"userId","mediaId",version,"updatedAt") VALUES (${request},${user},${episode},4,'2020-01-01')`;
      const asset = crypto.randomUUID();
      await db.$executeRaw`INSERT INTO "LibraryAsset" (id,path,"sizeBytes",properties,state,owned,"ownershipEpoch",version) VALUES (${asset},'/data/shared.mkv',10,'{}','published',true,7,3)`;
      for (const id of [movie, episode])
        await db.$executeRaw`INSERT INTO "AssetCoverage" ("assetId","mediaId",current) VALUES (${asset},${id},true)`;
      const receipt = crypto.randomUUID();
      const review = crypto.randomUUID();
      await db.$executeRaw`INSERT INTO "RecoveryReview" (id,"actorId","recoveryEpoch","runtimeVersion",scope,"scopeHash",state,"expiresAt") VALUES (${review},${user},7,3,'{"schemaVersion":1,"historical":"unchanged"}','original-hash','released','2030-01-01')`;
      await db.$executeRaw`INSERT INTO "RecoveryReleaseReceipt" (id,"reviewId","actorId","recoveryEpoch","scopeHash","responseHash","releasedHoldIds") VALUES (${receipt},${review},${user},7,'original-hash','response-hash',${[episode]})`;
      const before =
        await db.$queryRaw`SELECT to_jsonb(r) AS row FROM "RecoveryReleaseReceipt" r WHERE id = ${receipt}`;
      const sparse = await sparseParents(db, {
        user,
        series,
        episode,
        request,
        asset,
      });
      const householdIds = [...ids, ...sparse.ids];
      const historicalHousehold = await originalHousehold(db, householdIds);
      cluster.applyMigration(migration);
      const currentHousehold = await nativeHousehold(db, householdIds, []);
      expect(currentHousehold).toEqual(historicalHousehold);
      expect(snapshotHash(currentHousehold)).toBe(
        snapshotHash(historicalHousehold),
      );
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: movie, edition: "default" } },
      });
      expect(target).toMatchObject({
        automationEpoch: 7,
        generation: 12,
        version: 9,
        editionRootId: movie,
        desiredPresence: true,
        monitoring: true,
        updatedAt: new Date("2020-01-01Z"),
      });
      for (const id of [
        series,
        season,
        episode,
        direct,
        orphan,
        orphanSeason,
      ]) {
        const inert = await db.mediaIntent.findUniqueOrThrow({
          where: { mediaId_edition: { mediaId: id, edition: "default" } },
        });
        expect(inert).toMatchObject({
          automationEpoch: -1,
          generation: 0,
          version: 0,
          desiredPresence: false,
          monitoring: false,
          editionRootId: [orphan, orphanSeason].includes(id) ? null : series,
        });
      }
      expect(await db.mediaIntent.count({ where: { mediaId: catalog } })).toBe(
        0,
      );
      expect(
        await db.libraryAsset.findUniqueOrThrow({ where: { id: asset } }),
      ).toMatchObject({ editionRootId: null, ownershipEpoch: 7, version: 3 });
      expect(
        await db.assetCoverage.count({
          where: { assetId: asset, current: true },
        }),
      ).toBe(2);
      expect(
        await db.mediaRequest.findUniqueOrThrow({ where: { id: request } }),
      ).toMatchObject({ version: 4, edition: "default" });
      expect(
        await db.$queryRaw`SELECT to_jsonb(r) AS row FROM "RecoveryReleaseReceipt" r WHERE id = ${receipt}`,
      ).toEqual(before);
      for (const id of sparse.ids) {
        expect(
          await db.mediaIntent.findUniqueOrThrow({
            where: { mediaId_edition: { mediaId: id, edition: "default" } },
          }),
        ).toMatchObject({
          automationEpoch: -1,
          generation: 0,
          version: 0,
          desiredPresence: false,
          monitoring: false,
          editionRootId: id,
        });
      }
      expect(await sparseSnapshot(db)).toEqual(sparse.before);
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: sparse.attemptId },
      });
      expect(attempt).toMatchObject({
        filePlan: sparse.filePlan,
        identityEvidence: sparse.identity,
        recoveryEpoch: 7,
        edition: "default",
      });
      expect(FilePlanSchema.parse(attempt.filePlan)).toEqual(sparse.filePlan);
      expect(
        AcquisitionIdentitySnapshotSchema.parse(attempt.identityEvidence),
      ).toEqual(sparse.identity);
      await expect(
        db.acquisitionAttempt.update({
          where: { id: attempt.id },
          data: { edition: "named" },
        }),
      ).rejects.toThrow("immutable");
      await expect(
        db.mediaEditionDefinition.update({
          where: { rootMediaId_key: { rootMediaId: movie, key: "default" } },
          data: { policy: "theatrical" },
        }),
      ).rejects.toThrow("immutable");
      await expect(
        db.retentionHold.create({ data: { userId: user, mediaId: catalog } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    } finally {
      await cluster.close();
    }
  });

  it("diagnoses unsupported historical editions and rolls back without coercion", async () => {
    const cluster = await startMediaTestPostgres({
      migrationCeiling: "20261017001600_visibility",
    });
    try {
      const db = cluster.database;
      const mediaId = crypto.randomUUID(),
        assetId = crypto.randomUUID();
      await db.$executeRaw`INSERT INTO "MediaItem" (id,kind,title,"updatedAt") VALUES (${mediaId},'movie','Historical',CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO "LibraryAsset" (id,path,"sizeBytes",properties,state) VALUES (${assetId},'/data/named.mkv',1,'{}','published')`;
      await db.$executeRaw`INSERT INTO "AssetCoverage" ("assetId","mediaId",edition,current) VALUES (${assetId},${mediaId},'directors-cut',true)`;
      expect(() => cluster.applyMigration(migration)).toThrow(
        "explicit reconciliation",
      );
      expect(
        await db.$queryRaw`SELECT edition FROM "AssetCoverage" WHERE "assetId" = ${assetId}`,
      ).toEqual([{ edition: "directors-cut" }]);
      expect(
        await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'MediaIntent' AND column_name = 'edition'`,
      ).toEqual([]);
    } finally {
      await cluster.close();
    }
  });
});

/** Read the actual pre017 columns, independently of the new Prisma schema. */
async function originalHousehold(db: Prisma.TransactionClient, ids: string[]) {
  const result = await db.$queryRaw`SELECT jsonb_build_object(
    'requests', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "MediaRequest" t WHERE "mediaId" = ANY(${ids})),
    'coverage', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY "rootRequestId","mediaId"),'[]') FROM "RequestCoverage" t WHERE "mediaId" = ANY(${ids})),
    'personalHolds', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "RetentionHold" t WHERE "mediaId" = ANY(${ids})),
    'recoveryHolds', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY "mediaId"),'[]') FROM "RecoveryHold" t WHERE "mediaId" = ANY(${ids}))
  ) AS household`;
  const rows = z
    .array(
      z.object({
        household: z.record(
          z.string(),
          z.array(z.record(z.string(), z.json())),
        ),
      }),
    )
    .parse(result);
  const household = rows[0]?.household;
  if (household === undefined) throw new Error("Original household missing");
  // PostgreSQL JSON dates omit the UTC suffix and retain microseconds; Prisma
  // returns Date instances whose serialized representation is millisecond UTC.
  for (const records of Object.values(household)) {
    for (const record of records) {
      for (const key of [
        "createdAt",
        "updatedAt",
        "coverageCompletedAt",
        "until",
        "releasedAt",
      ]) {
        const value = record[key];
        if (typeof value === "string")
          record[key] = new Date(`${value}Z`).toISOString();
      }
    }
  }
  return household;
}

async function sparseSnapshot(db: Prisma.TransactionClient) {
  return db.$queryRaw`SELECT jsonb_build_object(
    'watch', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY "mediaId") FROM "WatchState" t),
    'hold', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY "mediaId") FROM "RecoveryHold" t),
    'decision', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY id) FROM "RetentionDecision" t),
    'policy', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY id) FROM "MediaSubtitlePolicyVersion" t),
    'coverage', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY "rootRequestId") FROM "RequestCoverage" t),
    'reservation', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY "mediaId") FROM "AcquisitionReservation" t),
    'attempt', (SELECT jsonb_agg(to_jsonb(t) - 'edition' ORDER BY id) FROM "AcquisitionAttempt" t)
  ) AS snapshot`;
}

async function sparseParents(
  db: Prisma.TransactionClient,
  input: {
    user: string;
    series: string;
    episode: string;
    request: string;
    asset: string;
  },
) {
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const [watch, hold, decision, policy, reservation] = ids;
  if (!watch || !hold || !decision || !policy || !reservation)
    throw new Error("Sparse fixture missing");
  for (const id of ids)
    await db.$executeRaw`INSERT INTO "MediaItem" (id,kind,title,"updatedAt") VALUES (${id},'movie','Sparse historic reference','2020-01-01')`;
  await db.$executeRaw`INSERT INTO "WatchState" ("userId","mediaId",watched,"observedAt",source) VALUES (${input.user},${watch},true,'2020-01-01','plex')`;
  await db.$executeRaw`INSERT INTO "RecoveryHold" ("mediaId","recoveryEpoch",reason,version) VALUES (${hold},7,'restored_intent_requires_review',6)`;
  const manifest = RemovalPlanSchema.parse({
    assets: [
      {
        assetId: input.asset,
        assetVersion: 3,
        libraryKind: "movies",
        libraryPath: "/data/shared.mkv",
        checksum: "a".repeat(64),
        quarantineId: crypto.randomUUID(),
        mediaIds: [decision],
        generations: { [decision]: 12 },
        sidecars: [],
      },
    ],
  });
  await db.$executeRaw`INSERT INTO "RetentionDecision" (id,"mediaId",generation,state,evidence,manifest,version,"updatedAt") VALUES (${crypto.randomUUID()},${decision},12,'quarantined','{"historical":true}',${JSON.stringify(manifest)}::jsonb,8,'2020-01-01')`;
  const rules = SubtitlePolicySchema.parse({
    schemaVersion: 1,
    targets: [],
    protectedReasons: [],
  });
  await db.$executeRaw`INSERT INTO "MediaSubtitlePolicyVersion" (id,"mediaId",version,"actorId","recoveryEpoch",source,rules) VALUES (${crypto.randomUUID()},${policy},3,${input.user},7,'{"kind":"owner"}',${JSON.stringify(rules)}::jsonb)`;
  const rootRequest = crypto.randomUUID();
  await db.$executeRaw`INSERT INTO "MediaRequest" (id,"userId","mediaId",version,"updatedAt") VALUES (${rootRequest},${input.user},${input.series},9,'2020-01-01')`;
  await db.$executeRaw`INSERT INTO "RequestCoverage" ("rootRequestId","requestId","mediaId",active,"sourceVersion") VALUES (${rootRequest},${input.request},${input.episode},false,9)`;
  const release = crypto.randomUUID(),
    operation = crypto.randomUUID(),
    attemptId = crypto.randomUUID();
  await db.$executeRaw`INSERT INTO "ReleaseCandidate" (id,"providerId","providerReleaseId",title,attributes,evaluation,"mediaIds") VALUES (${release},'knaben',${release},'Historic.2020.WEB-1080p','{}','{}',${[reservation]})`;
  await db.$executeRaw`INSERT INTO "Operation" (id,kind,"targetId",payload,"updatedAt") VALUES (${operation},'acquire_release',${reservation},'{}','2020-01-01')`;
  const identity = AcquisitionIdentitySnapshotSchema.parse({
    schemaVersion: 1,
    source: { releaseId: release, candidateDigest: "a".repeat(64) },
    proof: {
      kind: "automatic",
      basis: "title_year",
      references: [],
      evidenceHash: "b".repeat(64),
    },
    canonical: {
      kind: "movie",
      mediaId: reservation,
      mediaVersion: 0,
      catalogDigest: "c".repeat(64),
    },
    coverage: [reservation],
    sponsorRequestId: input.request,
    sponsorAuthority: {
      userId: input.user,
      actorId: input.user,
      serverMachineId: "fixture",
    },
    birthEpoch: 7,
  });
  const filePlan = FilePlanSchema.parse([
    {
      assetId: input.asset,
      mediaIds: [reservation],
      generations: { [reservation]: 12 },
      libraryKind: "movies",
      downloadPath: "/downloads/historic.mkv",
      libraryPath: "/data/shared.mkv",
      checksum: "a".repeat(64),
      sizeBytes: "10",
      properties: {},
      operationId: operation,
      previousAssetId: null,
      previousChecksum: null,
      previousVersion: null,
      previousSidecars: [],
      embeddedSubtitles: [],
    },
  ]);
  await db.$executeRaw`INSERT INTO "AcquisitionAttempt" (id,"releaseId","sponsorRequestId","mediaIds",generations,state,"operationId","filePlan","identityEvidence","recoveryEpoch","updatedAt") VALUES (${attemptId},${release},${input.request},${[reservation]},${JSON.stringify({ [reservation]: 12 })}::jsonb,'ready',${operation},${JSON.stringify(filePlan)}::jsonb,${JSON.stringify(identity)}::jsonb,7,'2020-01-01')`;
  await db.$executeRaw`INSERT INTO "AcquisitionReservation" ("mediaId","attemptId",generation) VALUES (${reservation},${attemptId},12)`;
  return {
    ids,
    attemptId,
    identity,
    filePlan,
    before: await sparseSnapshot(db),
  };
}
