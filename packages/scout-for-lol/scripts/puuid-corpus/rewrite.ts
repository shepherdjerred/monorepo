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
import {
  listRawObjects,
  scanObjects,
  type FetchedObject,
  type RawObject,
} from "./scan.ts";
import { computeSha256Digest } from "@scout-for-lol/backend/storage/object-integrity.ts";

/** Marks a body whose identifiers were moved between key domains. */
export const REWRITE_METADATA_KEY = "puuidredomainedat";

/**
 * Does this document mention any identity we are moving?
 *
 * Extract the PUUID-shaped tokens once, then test set membership — NOT a
 * `includes` per mapping. At production scale that difference decides whether
 * the pass finishes at all: 240,000 mappings against 66,000 objects is sixteen
 * billion substring scans over multi-megabyte bodies, and an object naming
 * nobody pays the full price every time.
 *
 * Membership against the real map, not the shape, is also what keeps this
 * correct. Report renders embed base64 PNG data that matches a PUUID's shape;
 * on shape alone every sampled SVG looked like a hit and none actually held a
 * mapped identity.
 */
export function needsRewrite(
  body: string,
  oldPuuids: ReadonlySet<string>,
): boolean {
  if (oldPuuids.size === 0) {
    return false;
  }
  for (const match of body.matchAll(PUUID_TOKEN)) {
    if (oldPuuids.has(match[0])) {
      return true;
    }
  }
  return false;
}

/** A PUUID's shape. Global, and used only with `matchAll`, which is reentrant. */
const PUUID_TOKEN = /[\w-]{70,90}/gu;

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
  /**
   * Told the new content address of every object this pass rewrites.
   *
   * `MatchObservation` stores an object's key and SHA-256 together as the
   * durable identity of the canonical bytes, and the schema treats a differing
   * digest as two producers disagreeing rather than as an update. Rewriting an
   * object without telling it leaves the database asserting a digest for bytes
   * that no longer exist, and primes that conflict for whoever reports next.
   *
   * Processing receipts are deliberately NOT updated here. A receipt says rows
   * were derived from particular bytes at a particular time, which stays true
   * afterwards; rewriting it would falsify a record of the past to tidy the
   * present.
   */
  onRewritten?:
    ((key: string, digest: string) => Promise<void> | void) | undefined;
};

export async function rewriteCorpus(
  client: S3Client,
  options: RewriteOptions,
): Promise<{
  rewritten: number;
  reconciled: number;
  skipped: number;
  failed: number;
}> {
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
  let reconciled = 0;
  const report = await scanObjects(
    client,
    candidates,
    async (object, fetched: FetchedObject) => {
      const { body, metadata } = fetched;
      if (!needsRewrite(body, oldPuuids)) {
        // A re-run cannot recognise its own interrupted work by content: a
        // rewritten object carries no old identifier, so it looks exactly like
        // one that never needed touching. The marker is the difference. If the
        // put landed and the database update did not, this is the only chance
        // to notice — and the stale digest would otherwise stand forever,
        // conflicting with whoever reports next.
        if (!options.dryRun && metadata[REWRITE_METADATA_KEY] !== undefined) {
          await options.onRewritten?.(
            object.key,
            computeSha256Digest(new TextEncoder().encode(body)),
          );
          reconciled++;
        }
        return false;
      }
      if (options.dryRun) {
        rewritten++;
        return true;
      }
      const parsed: unknown = JSON.parse(body);
      const translated = remapRawJson(parsed, options.map);
      const stored = await putContentAddressedObject({
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
      await options.onRewritten?.(object.key, stored.digest);
      rewritten++;
      return true;
    },
    {
      bucket: options.bucket,
      label: `${options.bucket} rewrite`,
      concurrency: 16,
    },
  );

  // "untouched" rather than "already new-domain": an object is skipped either
  // because a previous run rewrote it or because it never named anybody in the
  // map, and from here those are indistinguishable. Claiming the first would be
  // a guess, and on a partial map it would usually be the wrong one.
  console.log(
    `rewrite: ${rewritten.toString()} rewritten, ` +
      `${report.skipped.toString()} untouched (named nobody in the map), ` +
      `${reconciled.toString()} digests reconciled from an earlier run, ` +
      `${report.failed.toString()} failed`,
  );
  return {
    rewritten,
    reconciled,
    skipped: report.skipped,
    failed: report.failed,
  };
}
