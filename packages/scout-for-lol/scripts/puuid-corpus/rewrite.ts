/**
 * Re-domaining the raw corpus in place.
 *
 * S3 is the canonical record of what Riot returned, and rewriting it is a
 * deliberate trade: the alternative is translating on every read forever, which
 * only ever covered the handful of identities we had resolved. Both buckets are
 * `protected` in the SeaweedFS backup policy with a 30-day object lock, which is
 * what makes an in-place rewrite recoverable rather than final.
 *
 * Two properties make this safe to run hot:
 *
 * - An object with no old-domain identifier is left byte-identical. Only the
 *   documents that actually need changing are re-serialized, so formatting
 *   churn is confined to them.
 * - A rewritten object no longer contains an old PUUID, so a second run skips
 *   it. The pass is idempotent and resumable by construction, with no cursor to
 *   lose.
 *
 * Live ingest keeps writing throughout. Everything it adds is already
 * new-domain and gets skipped.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import { putContentAddressedObject } from "@scout-for-lol/backend/storage/object-integrity.ts";
import { remapRawJson } from "@scout-for-lol/backend/report-lake/puuid-remap.ts";
import { listRawObjects, scanObjects, type RawObject } from "./scan.ts";

/** Marks a body whose identifiers were moved between key domains. */
export const REWRITE_METADATA_KEY = "puuidredomainedat";

/**
 * Does this document mention any identity we are moving?
 *
 * A substring test over the raw text before parsing. Parsing 61 GiB of JSON to
 * discover that most documents need no change would dominate the run.
 */
export function needsRewrite(
  body: string,
  oldPuuids: ReadonlySet<string>,
): boolean {
  for (const oldPuuid of oldPuuids) {
    if (body.includes(oldPuuid)) {
      return true;
    }
  }
  return false;
}

/**
 * Objects that cannot contain an old identifier because of when they were
 * written.
 *
 * Anything written after the key swap came from the production key. This is an
 * optimization and nothing more — the body check below is the authority, and
 * verification re-reads the whole corpus regardless. A timestamp says when
 * bytes were written, not what is in them.
 */
export function writtenAfterCutover(
  object: RawObject,
  cutover: Date | undefined,
): boolean {
  return (
    cutover !== undefined &&
    object.lastModified !== undefined &&
    object.lastModified > cutover
  );
}

export type RewriteOptions = {
  bucket: string;
  map: ReadonlyMap<string, string>;
  /** Objects newer than this are skipped unread. */
  cutover?: Date | undefined;
  /** Narrow the pass to part of the archive. */
  prefix?: string | undefined;
  /** Report what would change without writing anything. */
  dryRun: boolean;
};

export async function rewriteCorpus(
  client: S3Client,
  options: RewriteOptions,
): Promise<{ rewritten: number; skipped: number; failed: number }> {
  const oldPuuids = new Set(options.map.keys());
  console.log(
    `rewrite: ${options.bucket}, ${oldPuuids.size.toString()} identities to move` +
      (options.dryRun ? " (DRY RUN — nothing is written)" : ""),
  );

  const all = await listRawObjects(client, options.bucket, options.prefix);
  const candidates = all.filter(
    (object) => !writtenAfterCutover(object, options.cutover),
  );
  console.log(
    `  ${all.length.toString()} objects, ${candidates.length.toString()} written before the cutover`,
  );

  let rewritten = 0;
  const report = await scanObjects(
    client,
    candidates,
    async (object, body) => {
      if (!needsRewrite(body, oldPuuids)) {
        return false;
      }
      if (options.dryRun) {
        rewritten++;
        return true;
      }
      const parsed: unknown = JSON.parse(body);
      const translated = remapRawJson(parsed, options.map);
      await putContentAddressedObject({
        client,
        bucket: options.bucket,
        key: object.key,
        body: JSON.stringify(translated),
        contentType: "application/json",
        // The digest recorded in metadata is recomputed by the put, which is the
        // point of going through it: a rewritten object whose stored digest
        // still described the old bytes would be worse than one with none.
        metadata: { [REWRITE_METADATA_KEY]: new Date().toISOString() },
        errorContext: `PUUID re-domaining of ${object.key}`,
        retryContext: `rewrite ${object.key}`,
      });
      rewritten++;
      return true;
    },
    {
      bucket: options.bucket,
      label: `${options.bucket} rewrite`,
      concurrency: 16,
    },
  );

  console.log(
    `rewrite: ${rewritten.toString()} rewritten, ` +
      `${report.skipped.toString()} already new-domain, ` +
      `${report.failed.toString()} failed`,
  );
  return { rewritten, skipped: report.skipped, failed: report.failed };
}
