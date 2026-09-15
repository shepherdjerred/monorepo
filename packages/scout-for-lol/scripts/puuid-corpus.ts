/**
 * Corpus-side half of the Riot key migration.
 *
 * The database half lives in `migrate-puuid-key.ts`. This one owns S3: finding
 * every identity the archive has ever recorded, and moving those identifiers
 * once a mapping exists for them.
 *
 * Why the two are separate: the inventory needs the cluster, and the hop that
 * takes days needs only a Riot key and an internet connection. Splitting them
 * lets the long part run on a laptop from a file, with no tunnel to hold open.
 *
 *   inventory   scan a bucket, write every distinct old PUUID to a file
 *   rewrite     re-domain every object in a bucket, using a resolved map
 *
 * Usage:
 *   S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts inventory --out prod.jsonl
 *   DATABASE_URL=... S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts rewrite [--apply] [--live-receipts-drained]
 */

import { createS3Client } from "@scout-for-lol/backend/storage/s3-client.ts";
import { composePuuidRemap } from "@scout-for-lol/backend/report-lake/puuid-remap.ts";
import {
  buildInventory,
  serializeInventory,
} from "./puuid-corpus/inventory.ts";
import type { Db } from "./puuid-migration/db.ts";
import { rewriteCorpus } from "./puuid-corpus/rewrite.ts";
import {
  countLiveReceipts,
  hasObservations,
  hasReceipts,
  recordRewrittenDigest,
  repointReceipts,
} from "./puuid-corpus/observations.ts";
import { openDb } from "./puuid-migration/db.ts";
import { asString } from "./puuid-migration/support.ts";

function requireFlag(name: string): string {
  const at = Bun.argv.indexOf(name);
  const value = at === -1 ? undefined : Bun.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function optionalFlag(name: string): string | undefined {
  const at = Bun.argv.indexOf(name);
  if (at === -1) {
    return undefined;
  }
  const value = Bun.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

/**
 * A cutover that cannot be read is refused rather than defaulted.
 *
 * An invalid Date compares false against everything, so every dated object
 * would fail the "written at or before the cutover" test and the inventory
 * would scan almost nothing — reporting zero failures over an empty corpus. A
 * map built that way looks clean and omits nearly every identity, and retiring
 * the old key afterwards strands all of them.
 */
function optionalDate(name: string): Date | undefined {
  const raw = optionalFlag(name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(
      `${name} must be a valid date, received ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function requireBucket(): string {
  const bucket = Bun.env["S3_BUCKET_NAME"];
  if (bucket === undefined || bucket === "") {
    throw new Error("S3_BUCKET_NAME must name the bucket to operate on");
  }
  return bucket;
}

async function runInventory(): Promise<void> {
  const out = requireFlag("--out");
  const result = await buildInventory(
    createS3Client(),
    requireBucket(),
    optionalFlag("--prefix"),
    optionalDate("--cutover"),
  );
  await Bun.write(out, serializeInventory(result.rows));
  console.log(
    `inventory: ${result.rows.length.toString()} distinct identities written to ${out}\n` +
      `  ${result.objectsRead.toString()} objects read, ${result.objectsFailed.toString()} failed\n` +
      `  ${result.withoutRiotId.toString()} carry no archived Riot ID (the old key is the authority regardless)`,
  );
  if (result.objectsFailed > 0) {
    throw new Error(
      `${result.objectsFailed.toString()} objects could not be read; the inventory is incomplete`,
    );
  }
}

/**
 * Only mappings whose database rewrite has landed may move S3 objects.
 *
 * A resolved-but-unapplied mapping is one whose replacement the database does
 * not hold yet. Translating the corpus to it would point archived payloads at
 * an identifier nothing joins against — the same reason the report lake gates
 * on `appliedAt`.
 */
async function loadAppliedMap(): Promise<Map<string, string>> {
  const db = await openDb();
  try {
    const rows = await db.query(
      `SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMap"
        WHERE "newPuuid" IS NOT NULL AND "appliedAt" IS NOT NULL
        UNION ALL
        SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMapHistory"
        ORDER BY "appliedAt" ASC, "oldPuuid" ASC`,
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      const oldPuuid = asString(row["oldPuuid"], "oldPuuid");
      map.delete(oldPuuid);
      map.set(oldPuuid, asString(row["newPuuid"], "newPuuid"));
    }
    composePuuidRemap(map);
    for (const [oldPuuid, replacement] of map) {
      if (oldPuuid === replacement) {
        map.delete(oldPuuid);
      }
    }
    return map;
  } finally {
    await db.close();
  }
}

/**
 * A live raw-archive snapshot cannot be rewritten safely while a workflow may
 * recover from it, and only the operator can know whether one might.
 *
 * The rewrite moves the receipt onto the new bytes, but the PUT and that update
 * are two stores and cannot be one transaction. A resume that reads the object
 * between them verifies new bytes against the old digest, and
 * `prematch-resume.ts` makes that mismatch non-retryable: the remaining lake
 * projection and its notifications are dropped and no later reconciliation
 * brings them back.
 *
 * Recovery can create an observation from a raw-match receipt even when no
 * observation exists yet. The same two-store race therefore applies to match,
 * timeline, and prematch receipts; all live receipt kinds are fenced together.
 *
 * Refusing rather than warning, and taking an acknowledgement rather than
 * guessing, follows `strand --accept-stranded`: the loss is silent, permanent,
 * and belongs to whoever can see the queue.
 */
async function requireLiveReceiptsDrained(db: Db): Promise<void> {
  const liveReceipts = await countLiveReceipts(db);
  if (liveReceipts === 0 || Bun.argv.includes("--live-receipts-drained")) {
    return;
  }
  throw new Error(
    `This database holds ${liveReceipts.toString()} live raw-archive receipts, and a ` +
      "recovery workflow can create a stale observation while its object is being " +
      "rewritten, losing its lake projection and notifications permanently. Confirm " +
      "no pre-swap match, timeline, or prematch recovery is still waiting to run, " +
      "then re-run with --live-receipts-drained.",
  );
}

async function runRewrite(): Promise<void> {
  const map = await loadAppliedMap();
  if (map.size === 0) {
    throw new Error(
      "No applied mappings. Run the database `apply` first: rewriting the corpus " +
        "to identifiers the database does not hold would hide the players it names.",
    );
  }
  const dryRun = !Bun.argv.includes("--apply");

  const db = await openDb();
  const tracksObservations = await hasObservations(db);
  const tracksReceipts = await hasReceipts(db);
  if (!dryRun && tracksReceipts) {
    await requireLiveReceiptsDrained(db);
  }
  let digestsUpdated = 0;
  let receiptsMoved = 0;
  try {
    const result = await rewriteCorpus(createS3Client(), {
      bucket: requireBucket(),
      map,
      prefix: optionalFlag("--prefix"),
      dryRun,
      onRewritten: dryRun
        ? undefined
        : async (key, digest) => {
            if (tracksObservations) {
              digestsUpdated += await recordRewrittenDigest(db, key, digest);
            }
            if (tracksReceipts) {
              receiptsMoved += await repointReceipts(db, key, digest);
            }
          },
    });
    console.log(
      tracksObservations
        ? `  ${digestsUpdated.toString()} MatchObservation artifact references re-pointed`
        : "  this database does not model MatchObservation; no artifact reference to move",
    );
    console.log(
      tracksReceipts
        ? `  ${receiptsMoved.toString()} raw-archive receipts re-pointed (staging receipts left as history)`
        : "  this database records no processing receipts",
    );
    if (result.failed > 0) {
      throw new Error(
        `${result.failed.toString()} objects failed to rewrite; re-run to retry them`,
      );
    }
  } finally {
    await db.close();
  }
}

const command = Bun.argv[2];
switch (command) {
  case "inventory":
    await runInventory();
    break;
  case "rewrite":
    await runRewrite();
    break;
  case undefined:
  default:
    throw new Error(
      "usage: puuid-corpus.ts <inventory --out FILE [--cutover ISO] | rewrite [--apply] [--live-receipts-drained]> " +
        "[--prefix games/2026/01/]",
    );
}
