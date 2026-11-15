import type { S3Client } from "@aws-sdk/client-s3";
import { putContentAddressedObject } from "#src/storage/object-integrity.ts";
import { readRawObjectText } from "#src/report-store/s3-raw-source.ts";
import type { EncodedSegment } from "./crawl-segment.ts";
import type { CrawlObjectStore } from "./crawl-store.ts";

/**
 * Raw-object access for the crawl. Segments are written with the shared
 * content-addressed put but under `crawl/v1/` only: no receipt, no
 * `MatchObservation`, nothing the tracked-match scans enumerate.
 */
export function createS3CrawlObjectStore(
  client: S3Client,
  bucket: string,
): CrawlObjectStore {
  return {
    readText: (key) => readRawObjectText(client, bucket, key),
    async putSegment(segment: EncodedSegment) {
      await putContentAddressedObject({
        client,
        bucket,
        key: segment.objectKey,
        body: segment.bytes,
        contentType: "application/zstd",
        metadata: { source: "participant-crawl", schema: "crawl-v1" },
        errorContext: "crawl segment",
        retryContext: `crawl segment ${segment.sha256}`,
      });
    },
  };
}
