import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import configuration from "#src/configuration.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { createS3CrawlObjectStore } from "#src/league/crawl/crawl-object-store.ts";
import { readRawObjectBytes } from "#src/report-store/s3-raw-source.ts";
import type {
  RawErasureObjects,
  RawErasureStore,
  SweepCursor,
} from "#src/report-lake/crawl/crawl-raw-erasure.ts";
import { loadErasedPuuidHashes } from "#src/report-lake/crawl/crawl-sources.ts";

/** The raw erasure sweep's state in PostgreSQL: `ErasedPuuid`, `CrawlSegment`, `CrawlMatch`, `CrawlObjectDeletion`. */
export function createPrismaRawErasureStore(
  prisma: ExtendedPrismaClient,
): RawErasureStore {
  return {
    pending: async () => {
      const rows = await prisma.erasedPuuid.findMany({
        where: { rawSweptAt: null },
        select: {
          puuidHash: true,
          rawCursorCreatedAt: true,
          rawCursorSha256: true,
        },
        orderBy: { erasedAt: "asc" },
      });
      return rows.map((row) => ({
        puuidHash: row.puuidHash,
        cursor:
          row.rawCursorCreatedAt === null || row.rawCursorSha256 === null
            ? null
            : {
                createdAt: row.rawCursorCreatedAt,
                sha256: row.rawCursorSha256,
              },
      }));
    },
    erasedHashes: async () => await loadErasedPuuidHashes(prisma),
    segmentsAfter: async (cursor: SweepCursor | null, limit: number) =>
      await prisma.crawlSegment.findMany({
        where:
          cursor === null
            ? {}
            : {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  {
                    createdAt: cursor.createdAt,
                    sha256: { gt: cursor.sha256 },
                  },
                ],
              },
        orderBy: [{ createdAt: "asc" }, { sha256: "asc" }],
        take: limit,
        select: {
          sha256: true,
          objectKey: true,
          route: true,
          dt: true,
          createdAt: true,
        },
      }),
    replaceSegment: async ({ old, replacement, removedMatchIds }) => {
      const removed = [...removedMatchIds];
      await prisma.$transaction(async (tx) => {
        if (replacement === null) {
          await tx.crawlMatch.deleteMany({
            where: { segmentSha256: old.sha256 },
          });
        } else {
          await tx.crawlSegment.createMany({
            data: [
              {
                sha256: replacement.sha256,
                objectKey: replacement.objectKey,
                route: replacement.route,
                dt: replacement.dt,
                matchCount: replacement.matchCount,
                bytes: replacement.bytes.length,
                createdAt: old.createdAt,
              },
            ],
            skipDuplicates: true,
          });
          await tx.crawlMatch.deleteMany({
            where: { segmentSha256: old.sha256, riotMatchId: { in: removed } },
          });
          await tx.crawlMatch.updateMany({
            where: { segmentSha256: old.sha256 },
            data: { segmentSha256: replacement.sha256 },
          });
        }
        await tx.crawlSegment.delete({ where: { sha256: old.sha256 } });
        await tx.crawlObjectDeletion.createMany({
          data: [{ objectKey: old.objectKey }],
          skipDuplicates: true,
        });
      });
    },
    saveProgress: async (updates) => {
      const now = new Date();
      await prisma.$transaction(
        updates.map((update) =>
          prisma.erasedPuuid.update({
            where: { puuidHash: update.puuidHash },
            data: {
              rawCursorCreatedAt: update.cursor?.createdAt ?? null,
              rawCursorSha256: update.cursor?.sha256 ?? null,
              ...(update.swept ? { rawSweptAt: now } : {}),
              segmentsRewritten: { increment: update.segmentsRewritten },
              matchesRemoved: { increment: update.matchesRemoved },
            },
          }),
        ),
      );
    },
    queuedDeletions: async (limit) => {
      const rows = await prisma.crawlObjectDeletion.findMany({
        select: { objectKey: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return rows.map((row) => row.objectKey);
    },
    forgetDeletion: async (objectKey) => {
      await prisma.crawlObjectDeletion.deleteMany({ where: { objectKey } });
    },
  };
}

/** The configured crawl bucket's objects; a pending erasure with no bucket is a broken deployment. */
export function createConfiguredRawErasureObjects(
  abortSignal?: AbortSignal,
): RawErasureObjects {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw new Error("The crawl erasure sweep requires S3_BUCKET_NAME");
  }
  return createS3RawErasureObjects({
    client: createS3Client(),
    bucket,
    abortSignal,
  });
}

/** Crawl objects in the bucket the crawl writes to. S3 treats deleting a missing key as success. */
export function createS3RawErasureObjects(input: {
  client: S3Client;
  bucket: string;
  abortSignal?: AbortSignal | undefined;
}): RawErasureObjects {
  const crawlObjects = createS3CrawlObjectStore(input.client, input.bucket);
  const options =
    input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal };
  return {
    read: async (objectKey) =>
      await readRawObjectBytes(input.client, input.bucket, objectKey, options),
    put: async (segment) => {
      await crawlObjects.putSegment(segment);
    },
    delete: async (objectKey) => {
      await input.client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: objectKey }),
        options,
      );
    },
  };
}
