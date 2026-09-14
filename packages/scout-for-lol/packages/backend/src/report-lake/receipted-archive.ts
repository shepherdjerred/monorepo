import {
  RawCurrentGameInfoSchema,
  type RawCurrentGameInfo,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  rawArchiveReceiptKind,
  buildReceipt,
  prematchReceiptMatchId,
  rawArchiveEvidenceCodec,
  receiptMatchId,
  recordReceiptFailOpen,
  storedRawArchiveDescriptor,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import {
  archiveMatchToS3,
  archiveTimelineToS3,
  savePrematchDataToS3,
} from "#src/storage/s3.ts";
import {
  ArchivedObjectUnusableError,
  readVerifiedRawObjectText,
} from "#src/report-store/s3-raw-source.ts";
import { createS3Client } from "#src/storage/s3-client.ts";

/**
 * The receipted entry point into raw S3 archival.
 *
 * S3 is the canonical raw store, so these functions do not soften the archive
 * itself: a failed put throws exactly as it did before, and no receipt is
 * written for an object that does not exist. What they add is the durable claim
 * — the descriptor of what was stored, content-addressed by the digest of the
 * exact bytes uploaded, recorded against the match the capture belongs to.
 *
 * The receipt write is the one part that is fail-open, and deliberately so; see
 * `recordReceiptFailOpen`. The no-bucket path stays the dev/test no-op it has
 * always been, and records nothing, because nothing was archived.
 *
 * These live under `report-lake/` rather than `storage/` for an architectural
 * reason: `architecture.config.ts` forbids `storage/` and `report-store/` from
 * importing `database/`, since a persistence adapter that reaches into another
 * one cannot be used from a script or a fixture without dragging it along. The
 * lake layer is already the one that composes the object store, the staging
 * files and the database, so the composition belongs here.
 */

export type ReceiptedArchiveResult =
  | {
      status: "archived";
      artifact: ArtifactDescriptor;
      /**
       * What the durable recorder said. `failed` means the object is in S3 but
       * the durable record of it is not; `conflict` means a receipt for this
       * identity already exists carrying different evidence. Either way the
       * object is archived and the caller has succeeded.
       */
      receipt: ReceiptRecordOutcome;
    }
  | { status: "skipped_no_bucket" };

type ReceiptOptions = {
  /** Supply a transaction client to record the receipt atomically with others. */
  db?: Db;
  /** Injectable so tests need no wall clock; defaults to now. */
  now?: Date;
  /**
   * Shrinks the put deadline so a test can drive the expiry path in
   * milliseconds; nothing in production passes it.
   */
  putDeadlineMs?: number;
  /**
   * The client the prematch door opens its fencing transaction on. Injectable
   * so a test can drive two genuinely concurrent captures against one
   * database; nothing in production passes it.
   */
  database?: ExtendedPrismaClient;
};

async function receiptArchived(args: {
  matchId: string;
  artifact: ArtifactDescriptor;
  options: ReceiptOptions;
}): Promise<ReceiptedArchiveResult> {
  const receipt = await recordReceiptFailOpen({
    record: buildReceipt({
      matchId: receiptMatchId(args.matchId),
      kind: rawArchiveReceiptKind(args.artifact.kind),
      evidence: rawArchiveEvidenceCodec.serialize(args.artifact),
      recordedAt: args.options.now ?? new Date(),
    }),
    writeKind: "raw-archive",
    ...(args.options.db === undefined ? {} : { db: args.options.db }),
  });
  return { status: "archived", artifact: args.artifact, receipt };
}

export async function archiveMatchReceipted(
  match: RawMatch,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult> {
  const result = await archiveMatchToS3(match, trackedPlayerAliases);
  if (result.status === "skipped_no_bucket") {
    return { status: "skipped_no_bucket" };
  }
  return receiptArchived({
    matchId: match.metadata.matchId,
    artifact: result.artifact,
    options,
  });
}

export async function archiveTimelineReceipted(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult> {
  const result = await archiveTimelineToS3(
    timeline,
    trackedPlayerAliases,
    gameCreatedAt,
  );
  if (result.status === "skipped_no_bucket") {
    return { status: "skipped_no_bucket" };
  }
  return receiptArchived({
    matchId: timeline.metadata.matchId,
    artifact: result.artifact,
    options,
  });
}

/**
 * What the prematch door did, which needs one more answer than the others.
 *
 * `already_archived` exists because the prematch door GATES its put — see
 * {@link archivePrematchReceipted} — so "this snapshot is already stored" is a
 * distinct outcome from "I stored it just now".
 *
 * It carries the CANONICAL payload as well as the descriptor, and that pairing
 * is the point. A caller holding a fresher spectator payload would otherwise
 * stage rows derived from ITS bytes while the staging receipt named the
 * archived object they did not come from, leaving the lake disagreeing with
 * both its own receipt and canonical S3. Handing back the bytes the descriptor
 * actually describes makes staging the wrong ones unrepresentable rather than
 * merely discouraged.
 */
export type ReceiptedPrematchArchiveResult =
  | {
      status: "archived";
      artifact: ArtifactDescriptor;
      receipt: ReceiptRecordOutcome;
    }
  | {
      status: "already_archived";
      artifact: ArtifactDescriptor;
      /** The archived object's own contents, verified against the receipt. */
      canonical: RawCurrentGameInfo;
    }
  | { status: "skipped_no_bucket" };

const PREMATCH_ARCHIVE_LOCK_NAMESPACE = "scout-prematch-archive";
/** Pool wait for the fencing transaction's own connection. */
const PREMATCH_ARCHIVE_LOCK_MAX_WAIT_MS = 10_000;
/**
 * The fence's budget, and why the two numbers differ.
 *
 * `LIFETIME` is how long the advisory lock may be held: it must cover the lock
 * wait, one S3 put and one receipt insert, and still fit inside the 90-second
 * start-to-close budget of the realtime Activity that calls it.
 *
 * `PUT_DEADLINE` bounds the put STRICTLY INSIDE that lifetime, and the margin
 * between them is the whole reason it exists. An S3 put is not one request: the
 * SDK's own request timeout multiplied by `MAX_PUT_ATTEMPTS` plus backoff can
 * exceed the transaction's lifetime on its own. When a Prisma transaction hits
 * its timer it rolls back and releases the lock WITHOUT cancelling anything
 * still in flight, so an unbounded put becomes a zombie: a rival acquires the
 * freed lock, writes and attests its own bytes, and the zombie put then lands
 * the older body over them — leaving the object disagreeing with the receipt
 * that vouches for it.
 *
 * So the put is both raced and CANCELLED at the deadline, with 20 seconds of
 * margin left for the attestation to commit under a lock that is provably still
 * held. This mirrors the 600/900 split `temporal/v2/effect-fence.ts` documents
 * for the same class of hazard.
 */
const PREMATCH_ARCHIVE_LOCK_LIFETIME_MS = 45_000;
const PREMATCH_ARCHIVE_PUT_DEADLINE_MS = 25_000;

/**
 * Run the put, and refuse to let it outlive the lock fencing it.
 *
 * Two mechanisms, doing different jobs. The race guarantees this function
 * SETTLES at the deadline even if the transport ignores cancellation, so the
 * caller never blocks past the lock's lifetime. The abort actually STOPS the
 * request, which is what keeps a cancelled put from landing later — a race
 * alone would abandon the put, not cancel it, and an abandoned put is exactly
 * the zombie this exists to prevent.
 *
 * Both fail closed: the put throws, no receipt is written, and the Activity's
 * retry re-enters the fence cleanly.
 */
/**
 * The archived snapshot's own contents, verified against the receipt that
 * attests them.
 *
 * The digest comes from the receipt rather than from the object's metadata, so
 * this checks the bytes against what was ATTESTED rather than against what they
 * claim about themselves. Failing loudly is the only safe answer: a caller
 * about to stage lake rows from this payload would otherwise project content
 * nothing vouches for.
 *
 * Two failure classes leave here, and callers must keep them apart.
 * {@link ArchivedObjectUnusableError} is a fact about what is stored — gone,
 * digest-mismatched, or unparseable — and is terminal. Anything else is a
 * transport failure that establishes nothing, and propagates untouched so the
 * caller's own retry can be the wait loop.
 *
 * Shared with the resume path rather than duplicated, so the two readers of one
 * archived snapshot cannot disagree about when it is usable.
 */
export async function readArchivedPrematchSnapshot(
  descriptor: ArtifactDescriptor,
  matchId: string,
): Promise<RawCurrentGameInfo> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    // A receipt stands but this process cannot reach the store it names. That
    // is a misconfiguration, not a fact about the object, so it is not an
    // `ArchivedObjectUnusableError`.
    throw new Error(
      `A raw-archive receipt stands for ${matchId} but no S3 bucket is configured, so the snapshot it attests to cannot be read back`,
    );
  }
  const text = await readVerifiedRawObjectText({
    client: createS3Client(),
    bucket,
    key: descriptor.key,
    expectedDigest: descriptor.digest,
  });
  const parsed = RawCurrentGameInfoSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    // The bytes matched their digest and still are not a spectator payload, so
    // they are exactly what was archived and what was archived is wrong.
    throw new ArchivedObjectUnusableError({
      key: descriptor.key,
      reason: "unparseable",
      detail: "the stored bytes are not a spectator payload",
    });
  }
  return parsed.data;
}

async function putWithinDeadline<T>(
  deadlineMs: number,
  key: string,
  run: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `Archiving ${key} exceeded its ${deadlineMs.toString()}ms fence deadline; the upload was cancelled rather than left to land after the lock is released`,
        ),
      );
    }, deadlineMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Archive one prematch snapshot, at most once, under a fence.
 *
 * ## Why this door is fenced and the other two are not
 *
 * A prematch S3 key is deterministic (`prematch/{date}/{gameId}/...`) but the
 * spectator PAYLOAD is not: `gameLength` advances between fetches, so two
 * captures of one game produce different bytes for the same key. Two
 * overlapping attempts therefore race: the second overwrites the first's
 * object and only then discovers the receipt mismatch, leaving S3 holding B's
 * bytes while the standing receipt attests A's digest. That breaks the
 * invariant this whole table exists for — that a row in it can be trusted
 * without re-deriving the fact it attests to.
 *
 * A match or timeline payload is immutable once the game is over, so a repeat
 * put writes byte-identical content to the same key. Those two doors can
 * overlap harmlessly: only the descriptor's `capturedAt` differs, and the key
 * and digest an attestation names stay true of the object. The asymmetry is in
 * the data, not in the pipeline, which is why the fence is here and not on
 * `receiptArchived`.
 *
 * ## Why the fence gates rather than only serializing
 *
 * Serialization alone would not fix it. A second attempt that waited its turn
 * and then put anyway would still overwrite, just in an orderly fashion. The
 * gate is what makes the fence work: inside the lock the door reads the
 * standing receipt first, and a snapshot that is already archived is answered
 * from that receipt with NO put at all. Read, put and attest are one critical
 * section, so a rival attempt observes either all of it or none of it.
 *
 * The fence lives in the door rather than in either caller because both
 * pipelines enter here — v1 through `ingestPrematch`, V2 through
 * `archivePrematchSnapshotV2` — and during the rollout window both can want
 * the same capture. A fence at one call site would serialize that caller
 * against itself and leave the cross-pipeline race wide open.
 *
 * The receipt is written through the fencing transaction on purpose. An
 * advisory xact lock dies with its transaction, and Prisma ends a transaction
 * on its own timer as well as on its callback, so a put that somehow outran
 * {@link PREMATCH_ARCHIVE_LOCK_LIFETIME_MS} would be running unfenced. Writing
 * the attestation through `tx` makes that case fail closed: the aborted
 * transaction cannot record a receipt, so no attestation is ever written for a
 * put the fence could not vouch for, and the next attempt re-enters under a
 * lock it genuinely holds.
 */
export async function archivePrematchReceipted(
  gameInfo: RawCurrentGameInfo,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedPrematchArchiveResult> {
  const matchId = prematchReceiptMatchId(gameInfo);
  const database = options.database ?? prisma;
  return await database.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${PREMATCH_ARCHIVE_LOCK_NAMESPACE}),
          hashtext(${matchId})
        )
      `;
      const stored = await storedRawArchiveDescriptor(tx, matchId, "prematch");
      if (stored !== null) {
        return {
          status: "already_archived",
          artifact: stored,
          canonical: await readArchivedPrematchSnapshot(stored, matchId),
        };
      }
      const result = await putWithinDeadline(
        options.putDeadlineMs ?? PREMATCH_ARCHIVE_PUT_DEADLINE_MS,
        matchId,
        async (abortSignal) =>
          await savePrematchDataToS3(
            gameInfo.gameId,
            gameInfo,
            trackedPlayerAliases,
            abortSignal,
          ),
      );
      if (
        result.status === "skipped_no_bucket" ||
        result.artifact === undefined
      ) {
        return { status: "skipped_no_bucket" };
      }
      return await receiptArchived({
        matchId,
        artifact: result.artifact,
        options: { ...options, db: tx },
      });
    },
    {
      maxWait: PREMATCH_ARCHIVE_LOCK_MAX_WAIT_MS,
      timeout: PREMATCH_ARCHIVE_LOCK_LIFETIME_MS,
    },
  );
}
