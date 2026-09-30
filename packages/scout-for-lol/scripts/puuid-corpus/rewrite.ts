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
import { listRawObjects, scanObjects, type FetchedObject } from "./scan.ts";
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

/**
 * Move every mapped identifier in a document, wherever it sits.
 *
 * Deliberately a token substitution over the raw text rather than a parse, a
 * structural walk and a re-serialize. Two reasons, one of them a bug the walk
 * could not have fixed.
 *
 * The walk replaces a string only when the WHOLE value is a mapped identifier,
 * and identifiers are not always whole values. A single AI pipeline trace in
 * beta holds a 100,772-character prompt with 21 identifiers embedded in it.
 * Detection sees those tokens, so the object would be rewritten and marked
 * while every one of them survived — old-domain, reported as done, and rewritten
 * again on every later run because the tokens are still there. Neither complete
 * nor idempotent.
 *
 * It also keeps the bytes. Re-serializing normalizes formatting across the whole
 * document; substituting tokens changes exactly the identifiers and nothing
 * else, so the archive stays as close to what Riot returned as a re-domaining
 * allows.
 *
 * Only a complete token is substituted. A longer run of word characters does
 * not match any key, so an identifier glued to something else is left alone
 * rather than half-rewritten — and detection reads the same tokens, so the two
 * cannot disagree about what needs doing.
 */
export function redomainBody(
  body: string,
  map: ReadonlyMap<string, string>,
): string {
  return body.replaceAll(PUUID_TOKEN, (token) => map.get(token) ?? token);
}

/** S3 metadata rides in an HTTP header: only printable ASCII survives. */
const PRINTABLE_ASCII = /^[\u{20}-\u{7E}]*$/u;

/** How many players a legacy comma-joined alias list names. */
function countAliases(value: string): number {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0).length;
}

/** Where an object's original capture time is kept once the put restamps it. */
export const ORIGINAL_UPLOAD_METADATA_KEY = "originaluploadedat";

/**
 * The metadata to write back: everything the producer recorded, plus our marker.
 *
 * `putContentAddressedObject` overwrites `sha256` and `uploadedAt` with the
 * values for the bytes it is storing, which is correct — they describe the
 * object that now exists. The capture time is provenance rather than integrity,
 * so it is moved aside instead of being overwritten away.
 *
 * A value that is not printable ASCII cannot be carried forward, and refusing
 * it is right rather than pedantic: writing one back re-encodes it. Measured
 * against the live store, `KbeÃ§a` comes back as `KbeÃÂ§a`, so every rewrite
 * would corrupt it further.
 *
 * In practice that is one legacy key. Around 3% of prod's match objects carry
 * `trackedplayers`, a comma-joined list of aliases written before the producer
 * switched to a count, and an alias holds whatever a player can type. The only
 * thing that reads it derives a count, so the count is what carries forward —
 * the same information in the form the current producer already writes. The
 * aliases themselves go, because there is no way to write them back intact.
 */
export function preservedMetadata(
  existing: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (PRINTABLE_ASCII.test(key) && PRINTABLE_ASCII.test(value)) {
      merged[key] = value;
      continue;
    }
    if (
      key === "trackedplayers" &&
      merged["trackedplayercount"] === undefined
    ) {
      merged["trackedplayercount"] = countAliases(value).toString();
    }
  }
  const captured = merged["uploadedat"];
  if (
    captured !== undefined &&
    merged[ORIGINAL_UPLOAD_METADATA_KEY] === undefined
  ) {
    merged[ORIGINAL_UPLOAD_METADATA_KEY] = captured;
  }
  merged[REWRITE_METADATA_KEY] = new Date().toISOString();
  return merged;
}

/** A PUUID's shape. Global, and used only with `matchAll`, which is reentrant. */
const PUUID_TOKEN = /[\w-]{70,90}/gu;

export type RewriteOptions = {
  bucket: string;
  map: ReadonlyMap<string, string>;
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

  // Deliberately NOT filtered by modification time, unlike the inventory.
  //
  // Rewriting an object advances its LastModified past any cutover, so a filter
  // would exclude exactly the objects a re-run needs to inspect: one whose PUT
  // landed while its database update did not. Its marker would never be read
  // and its digest would stay wrong permanently — the filter would defeat the
  // recovery it shares a function with.
  //
  // It buys almost nothing anyway. Post-cutover objects are 0.6% of prod and
  // 0.4% of beta, and the body check skips them correctly regardless: an object
  // written under the production key holds no old identifier to find.
  const candidates = await listRawObjects(
    client,
    options.bucket,
    options.prefix,
  );
  console.log(`  ${candidates.length.toString()} objects to inspect`);

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
      const stored = await putContentAddressedObject({
        client,
        bucket: options.bucket,
        key: object.key,
        body: redomainBody(body, options.map),
        contentType: "application/json",
        // A PUT REPLACES user metadata rather than merging it, and these objects
        // carry the producer's own record: match id, queue, frame counts,
        // participant and tracked-player counts, capture time. Sending only the
        // marker would erase all of it while rewriting the canonical archive —
        // changing far more than the identifiers this migration is for, with no
        // backup to recover from.
        //
        // The digest and upload time are recomputed by the put, so the original
        // capture time is carried forward under its own key rather than lost.
        metadata: preservedMetadata(metadata),
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
