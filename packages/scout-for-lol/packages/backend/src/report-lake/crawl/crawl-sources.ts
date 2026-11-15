import type { S3Client } from "@aws-sdk/client-s3";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { readRawObjectBytes } from "#src/report-store/s3-raw-source.ts";
import type { ErasedPuuidHashes } from "#src/report-lake/crawl/crawl-rows.ts";

/**
 * Where crawl maintenance reads committed segments and erasures from.
 *
 * The lake functions take these as plain interfaces so they run against temp
 * directories in tests; production wires PostgreSQL (`CrawlSegment`,
 * `ErasedPuuid`) and the S3 bucket the crawl wrote to.
 */

export type CommittedCrawlSegment = {
  sha256: string;
  objectKey: string;
  dt: string;
};

export type CrawlSegmentSource = {
  /** Committed segments whose ingest day is on or after `sinceDay`. */
  segmentsSince: (sinceDay: string) => Promise<CommittedCrawlSegment[]>;
  read: (segment: CommittedCrawlSegment) => Promise<Uint8Array>;
};

export function createCrawlSegmentSource(input: {
  prisma: ExtendedPrismaClient;
  client: S3Client;
  bucket: string;
  abortSignal?: AbortSignal | undefined;
}): CrawlSegmentSource {
  return {
    segmentsSince: async (sinceDay) =>
      await input.prisma.crawlSegment.findMany({
        where: { dt: { gte: sinceDay } },
        select: { sha256: true, objectKey: true, dt: true },
        orderBy: [{ dt: "asc" }, { sha256: "asc" }],
      }),
    read: async (segment) =>
      await readRawObjectBytes(
        input.client,
        input.bucket,
        segment.objectKey,
        input.abortSignal === undefined
          ? {}
          : { abortSignal: input.abortSignal },
      ),
  };
}

/** Every erased PUUID hash; the list holds hashes only and stays small. */
export async function loadErasedPuuidHashes(
  prisma: ExtendedPrismaClient,
): Promise<ErasedPuuidHashes> {
  const rows = await prisma.erasedPuuid.findMany({
    select: { puuidHash: true },
  });
  return new Set(rows.map((row) => row.puuidHash));
}
