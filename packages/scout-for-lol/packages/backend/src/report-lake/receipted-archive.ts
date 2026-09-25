import { z } from "zod";
import {
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RawTimelineSchema,
  type RawCurrentGameInfo,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import { Prisma } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { countDurableWriteFailure } from "#src/durable/match/durable-facts.ts";
import { createLogger } from "#src/logger.ts";
import type {
  ArtifactDescriptor,
  ArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  prematchReceiptMatchId,
  rawArchiveReceiptRecord,
  receiptMatchId,
  recordReceiptFailOpen,
  storedRawArchiveDescriptor,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import {
  archiveMatchToS3,
  archiveTimelineToS3,
  savePrematchDataToS3,
  type RawArchiveResult,
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

/**
 * What one fenced archive did, for any artifact family.
 *
 * `already_archived` carries the CANONICAL payload alongside the descriptor,
 * and that pairing is the point. A caller holding its own fetch of the same
 * artifact would otherwise stage lake rows derived from ITS bytes while the
 * staging receipt named the archived object they did not come from, leaving
 * the lake disagreeing with both its own receipt and canonical S3. Handing
 * back the bytes the descriptor actually describes makes staging the wrong
 * ones unrepresentable rather than merely discouraged.
 *
 * `T` is the family's parsed payload, so a caller cannot accidentally stage a
 * timeline where a match belongs.
 */
export type ReceiptedArchiveResult<T> =
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
  | {
      status: "already_archived";
      artifact: ArtifactDescriptor;
      /** The archived object's own contents, verified against the receipt. */
      canonical: T;
    }
  | { status: "skipped_no_bucket" };

type ReceiptOptions = {
  /** Supply a transaction client to record the receipt atomically with others. */
  db?: Db;
  /**
   * Shrinks every part of the fence's budget so a test can drive the expiry,
   * the starved-follower and the bounded-wait paths in milliseconds; nothing
   * in production passes it. See {@link ArchiveFenceBudget}.
   */
  fenceBudget?: ArchiveFenceBudget;
  /**
   * The client a door opens its fencing transaction on. Injectable
   * so a test can drive two genuinely concurrent captures against one
   * database; nothing in production passes it.
   */
  database?: ExtendedPrismaClient;
};

/** The `archived` answer alone: what an attestation can produce. */
type ArchivedResult<T> = Extract<
  ReceiptedArchiveResult<T>,
  { status: "archived" }
>;

async function receiptArchived<T>(args: {
  matchId: string;
  artifact: ArtifactDescriptor;
  options: ReceiptOptions;
}): Promise<ArchivedResult<T>> {
  const receipt = await recordReceiptFailOpen({
    record: rawArchiveReceiptRecord({
      matchId: receiptMatchId(args.matchId),
      artifact: args.artifact,
    }),
    writeKind: "raw-archive",
    ...(args.options.db === undefined ? {} : { db: args.options.db }),
  });
  return { status: "archived", artifact: args.artifact, receipt };
}

const logger = createLogger("report-lake-receipted-archive");

const ARCHIVE_LOCK_NAMESPACE = "scout-raw-archive";
/** Pool wait for the fencing transaction's own connection. */
const ARCHIVE_POOL_MAX_WAIT_MS = 10_000;

/**
 * The fence's budget, and why it is four numbers rather than one.
 *
 * `lockLifetimeMs` is how long the advisory lock may be held — the Prisma
 * transaction timeout. It must cover the lock wait, one S3 put or read-back
 * and one receipt insert, and still fit inside the 90-second start-to-close
 * budget of the realtime Activity that calls it.
 *
 * `externalDeadlineMs` bounds the put — and the canonical read-back an
 * `already_archived` answer needs — STRICTLY INSIDE that lifetime. An S3 put
 * is not one request: the SDK's own request timeout multiplied by
 * `MAX_PUT_ATTEMPTS` plus backoff can exceed the transaction's lifetime on its
 * own. When a Prisma transaction hits its timer it rolls back and releases the
 * lock WITHOUT cancelling anything still in flight, so an unbounded put
 * becomes a zombie: a rival acquires the freed lock, writes and attests its
 * own bytes, and the zombie put then lands the older body over them —
 * leaving the object disagreeing with the receipt that vouches for it. So the
 * external work is both raced and CANCELLED at its deadline.
 *
 * But a fixed deadline is only strictly inside the lifetime for a caller that
 * acquired the lock at once. The transaction's timer starts when it opens,
 * BEFORE the lock wait, and a follower that waited behind a holder which put
 * for the full deadline and left without a receipt has that much less of its
 * lifetime left — a fresh 25 seconds on 20 remaining is the zombie again. Nor
 * is the lock acquisition the last thing that spends lifetime before the put:
 * the receipt lookup between them is a query on a possibly contended
 * database. So the deadline is derived from the REMAINING lifetime at the
 * moment the external work STARTS, measured from a clock started before the
 * transaction opened, with `settleMarginMs` reserved after the external work
 * for the receipt insert and the commit under a lock that is provably still
 * held; a caller whose remainder cannot fit any put fails closed before
 * putting at all.
 *
 * `lockWaitMs` bounds the wait itself, as a Postgres `lock_timeout` on the
 * advisory-lock statement. It is not redundant with the derived deadline: it
 * is what keeps a starved follower from spending its whole lifetime waiting
 * and then failing for want of budget, and it keeps the normal case — one
 * holder, one follower — inside the full external deadline with room to
 * spare. This mirrors the 600/900 split `temporal/v2/effect-fence.ts`
 * documents for the same class of hazard.
 */
export type ArchiveFenceBudget = {
  readonly lockLifetimeMs: number;
  readonly lockWaitMs: number;
  readonly externalDeadlineMs: number;
  readonly settleMarginMs: number;
};

export const ARCHIVE_FENCE_BUDGET: ArchiveFenceBudget = {
  lockLifetimeMs: 45_000,
  lockWaitMs: 10_000,
  externalDeadlineMs: 25_000,
  settleMarginMs: 5000,
};

/** Only whole positive milliseconds may be spliced into a SET statement. */
const LockTimeoutMsSchema = z.number().int().positive();

/**
 * A fence as one external operation sees it: the budget it runs under, when
 * the clock behind that budget started, and the key it is fenced on.
 */
type FenceClock = {
  readonly budget: ArchiveFenceBudget;
  /** `Date.now()` from before the fencing transaction opened. */
  readonly openedAt: number;
  readonly key: string;
};

/**
 * The deadline external work starting NOW may be given, or `null` when the
 * lock's remaining lifetime cannot fit any.
 */
function fenceDeadlineFor(clock: FenceClock, now: number): number | null {
  const remaining = clock.budget.lockLifetimeMs - (now - clock.openedAt);
  const deadline = Math.min(
    clock.budget.externalDeadlineMs,
    remaining - clock.budget.settleMarginMs,
  );
  return deadline > 0 ? deadline : null;
}

/**
 * An archived object's own contents, verified against the receipt that attests
 * them.
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
 */
async function readArchivedPayload<T>(args: {
  descriptor: ArtifactDescriptor;
  matchId: string;
  abortSignal: AbortSignal;
  parse: (value: unknown) => { success: true; data: T } | { success: false };
  expected: string;
}): Promise<T> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    // A receipt stands but this process cannot reach the store it names. That
    // is a misconfiguration, not a fact about the object, so it is not an
    // `ArchivedObjectUnusableError`.
    throw new Error(
      `A raw-archive receipt stands for ${args.matchId} but no S3 bucket is configured, so the artifact it attests to cannot be read back`,
    );
  }
  const text = await readVerifiedRawObjectText({
    client: createS3Client(),
    bucket,
    key: args.descriptor.key,
    expectedDigest: args.descriptor.digest,
    options: { abortSignal: args.abortSignal },
  });
  const parsed = args.parse(JSON.parse(text));
  if (!parsed.success) {
    // The bytes matched their digest and still are not what they claim to be,
    // so they are exactly what was archived and what was archived is wrong.
    throw new ArchivedObjectUnusableError({
      key: args.descriptor.key,
      reason: "unparseable",
      detail: `the stored bytes are not ${args.expected}`,
    });
  }
  return parsed.data;
}

/**
 * The archived prematch snapshot, for the resume path that reads it outside a
 * fence. Shared with the door rather than duplicated, so the two readers of one
 * archived snapshot cannot disagree about when it is usable.
 */
export async function readArchivedPrematchSnapshot(
  descriptor: ArtifactDescriptor,
  matchId: string,
): Promise<RawCurrentGameInfo> {
  return await readArchivedPayload({
    descriptor,
    matchId,
    abortSignal: AbortSignal.timeout(ARCHIVE_FENCE_BUDGET.externalDeadlineMs),
    parse: (value) => RawCurrentGameInfoSchema.safeParse(value),
    expected: "a spectator payload",
  });
}

/** Read a receipted canonical match back from raw storage. */
export async function readArchivedMatchPayload(
  descriptor: ArtifactDescriptor,
  matchId: string,
): Promise<RawMatch> {
  return await readArchivedPayload({
    descriptor,
    matchId,
    abortSignal: AbortSignal.timeout(ARCHIVE_FENCE_BUDGET.externalDeadlineMs),
    parse: (value) => RawMatchSchema.safeParse(value),
    expected: "a Match-V5 payload",
  });
}

/**
 * Run external work, and refuse to let it outlive the lock fencing it.
 *
 * Two mechanisms, doing different jobs. The race guarantees this function
 * SETTLES at the deadline even if the transport ignores cancellation, so the
 * caller never blocks past the lock's lifetime. The abort actually STOPS the
 * request, which is what keeps a cancelled put from landing later — a race
 * alone would abandon the put, not cancel it, and an abandoned put is exactly
 * the zombie this exists to prevent.
 *
 * The deadline is derived HERE, from the clock, at the moment the work
 * starts — not handed in by the caller. A deadline computed when the lock was
 * acquired and used later would be stale by however long the statements in
 * between took, and the receipt lookup between the lock and the put is a
 * query on a database that may be slow or contended: a lookup that spent
 * fifteen seconds of a forty-five-second lifetime would otherwise leave the
 * put a full twenty-five, which is the zombie again. Deriving inside the call
 * makes an early capture unrepresentable rather than merely avoided.
 *
 * Both fail closed: the work throws, no receipt is written, and the Activity's
 * retry re-enters the fence cleanly. So does a clock with nothing left: a
 * caller whose remaining lifetime cannot fit any external work fails before
 * starting it, rather than starting it on a budget the lock cannot cover.
 */
async function withinFenceDeadline<T>(
  clock: FenceClock,
  run: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const key = clock.key;
  const deadlineMs = fenceDeadlineFor(clock, Date.now());
  if (deadlineMs === null) {
    throw new Error(
      `Archiving ${key} reached its external work with too little of the lock's lifetime left to do any; failing closed rather than putting on a budget the lock cannot cover`,
    );
  }
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
 * Archive one raw artifact, at most once, under a fence.
 *
 * ## The hazard, which every artifact family shares
 *
 * Each family's S3 key is deterministic — one key per (match, kind) — but the
 * BYTES under it are not guaranteed identical across two fetches. A prematch
 * payload varies by construction, since `gameLength` advances between polls. A
 * MatchV5 response is semantically stable once the game is over, but stability
 * of MEANING is not identity of bytes: serialization order and late
 * corrections both produce a different body for the same match, and the
 * v1-vs-V2 dual-run window archives one match from two independent fetches.
 *
 * So two overlapping attempts race the same way in every family. The second
 * overwrites the first's object and only then discovers the receipt mismatch,
 * leaving S3 holding B's bytes while the standing receipt attests A's digest —
 * which breaks the invariant this whole table exists for: that a row in it can
 * be trusted without re-deriving the fact it attests to. What differs between
 * the families is only how OFTEN the bytes vary, and the fence costs one
 * advisory lock around an infrequent write either way.
 *
 * ## Why the fence gates rather than only serializing
 *
 * Serialization alone would not fix it. A second attempt that waited its turn
 * and then put anyway would still overwrite, just in an orderly fashion. The
 * gate is what makes the fence work: inside the lock the door reads the
 * standing receipt first, and an artifact already archived is answered from
 * that receipt with NO put at all. Read, put and attest are one critical
 * section, so a rival attempt observes either all of it or none of it.
 *
 * The fence lives in the door rather than in any caller because several
 * pipelines enter here — v1's ingest paths and the V2 Activities — and during
 * the rollout window both can want the same artifact. A fence at one call site
 * would serialize that caller against itself and leave the cross-pipeline race
 * wide open.
 *
 * The lock is keyed by (match, artifact kind) rather than by match alone: a
 * match and its timeline are different objects under different keys with
 * different receipts, so making them wait for each other would buy nothing.
 *
 * The receipt is written through the fencing transaction on purpose. An
 * advisory xact lock dies with its transaction, and Prisma ends a transaction
 * on its own timer as well as on its callback, so a put that somehow outran
 * the lock lifetime would be running unfenced. Writing the attestation through
 * `tx` makes that case fail closed: the aborted transaction cannot record a
 * receipt, so no attestation is ever written for a put the fence could not
 * vouch for, and the next attempt re-enters under a lock it genuinely holds.
 *
 * ## What is fail-open, and where
 *
 * The RECEIPT is fail-open; the put's exclusivity never is. v1's live ingest
 * paths must survive a bookkeeping outage — refusing an archive because the
 * row recording it could not be written trades a parity problem for data
 * loss — and `recordReceiptFailOpen` answers `failed` for that. But a receipt
 * write that failed INSIDE the transaction can leave the transaction unable
 * to commit (a statement error aborts it; a dropped connection ends it), and
 * that rejection would surface after the canonical put already landed. So
 * the boundary holds the contract: a transaction that fails once the put has
 * landed is reported as `archived` with `receipt: "failed"` — the object is
 * in S3, the durable record of it is not, which is exactly what that answer
 * has always meant — and only a failure BEFORE the put propagates. The V2
 * Activities translate `failed` into a retryable Activity failure at their
 * own boundary, so their strictness is unchanged.
 *
 * ## No bucket, no transaction
 *
 * With no bucket configured nothing can be archived, so the dev/test no-op
 * is answered before any transaction opens. That path is documented as a
 * storage no-op and must stay one: a test or a script running without a
 * database has always been able to take it.
 */
async function archiveUnderFence<T>(args: {
  matchId: string;
  artifactKind: ArtifactKind;
  options: ReceiptOptions;
  put: (abortSignal: AbortSignal) => Promise<RawArchiveResult>;
  readCanonical: (
    descriptor: ArtifactDescriptor,
    abortSignal: AbortSignal,
  ) => Promise<T>;
}): Promise<ReceiptedArchiveResult<T>> {
  if (configuration.s3BucketName === undefined) {
    return { status: "skipped_no_bucket" };
  }
  const database = args.options.database ?? prisma;
  const budget = args.options.fenceBudget ?? ARCHIVE_FENCE_BUDGET;
  const fenceKey = `${args.matchId}:${args.artifactKind}`;
  // The clock starts before the transaction opens, so it can only run ahead
  // of Prisma's own timer — never behind it. Every external operation below
  // derives its deadline from this clock at the moment it starts.
  const clock: FenceClock = { budget, openedAt: Date.now(), key: fenceKey };
  let landed: ArtifactDescriptor | undefined;
  let receipt: ReceiptRecordOutcome | undefined;
  try {
    return await database.$transaction(
      async (tx) => {
        await acquireFence(tx, fenceKey, budget);
        // The receipt lookup sits between the lock and the external work and
        // spends lifetime like anything else; the deadline is not derived
        // until after it, inside `withinFenceDeadline`.
        const stored = await storedRawArchiveDescriptor(
          tx,
          receiptMatchId(args.matchId),
          args.artifactKind,
        );
        if (stored !== null) {
          return {
            status: "already_archived",
            artifact: stored,
            canonical: await withinFenceDeadline(
              clock,
              async (abortSignal) =>
                await args.readCanonical(stored, abortSignal),
            ),
          };
        }
        const result = await withinFenceDeadline(clock, args.put);
        if (result.status === "skipped_no_bucket") {
          return { status: "skipped_no_bucket" };
        }
        landed = result.artifact;
        const attested = await receiptArchived<T>({
          matchId: args.matchId,
          artifact: result.artifact,
          options: { ...args.options, db: tx },
        });
        receipt = attested.receipt;
        return attested;
      },
      {
        maxWait: ARCHIVE_POOL_MAX_WAIT_MS,
        timeout: budget.lockLifetimeMs,
      },
    );
  } catch (error) {
    if (landed === undefined) throw error;
    // The put landed under the lock and the transaction failed after it —
    // in the receipt write or at commit. The object is canonical; the record
    // of it is not. That is `failed`, and it must not become an ingest
    // failure on the live path. Counted once: the recorder already counted a
    // write it saw throw, so only a commit that failed after a receipt the
    // recorder believed written is new information.
    logger.error(
      `Archived ${fenceKey} but its fencing transaction failed after the put; reporting the archive with a failed receipt rather than failing the ingest`,
      error,
    );
    if (receipt !== "failed") countDurableWriteFailure("raw-archive");
    return { status: "archived", artifact: landed, receipt: "failed" };
  }
}

/**
 * Take the fence, waiting at most `lockWaitMs` for it.
 *
 * `lock_timeout` is a Postgres session setting; `SET LOCAL` scopes it to this
 * transaction, and it applies to advisory locks. A follower that cannot get
 * the lock in time fails here, before it has spent its lifetime waiting and
 * before it could put on whatever was left.
 */
async function acquireFence(
  tx: Db,
  fenceKey: string,
  budget: ArchiveFenceBudget,
): Promise<void> {
  const lockWaitMs = LockTimeoutMsSchema.parse(budget.lockWaitMs);
  await tx.$executeRaw`SET LOCAL lock_timeout = ${Prisma.raw(lockWaitMs.toString())}`;
  try {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${ARCHIVE_LOCK_NAMESPACE}),
        hashtext(${fenceKey})
      )
    `;
  } catch (error) {
    throw new Error(
      `Archiving ${fenceKey} could not acquire its fence within ${lockWaitMs.toString()}ms; failing closed rather than putting on a shrunken budget`,
      { cause: error },
    );
  }
}

export async function archiveMatchReceipted(
  match: RawMatch,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult<RawMatch>> {
  return await archiveUnderFence({
    matchId: match.metadata.matchId,
    artifactKind: "match",
    options,
    put: async (abortSignal) =>
      await archiveMatchToS3(match, trackedPlayerAliases, abortSignal),
    readCanonical: async (descriptor, abortSignal) =>
      await readArchivedPayload({
        descriptor,
        matchId: match.metadata.matchId,
        abortSignal,
        parse: (value) => RawMatchSchema.safeParse(value),
        expected: "a MatchV5 payload",
      }),
  });
}

export async function archiveTimelineReceipted(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult<RawTimeline>> {
  return await archiveUnderFence({
    matchId: timeline.metadata.matchId,
    artifactKind: "timeline",
    options,
    put: async (abortSignal) =>
      await archiveTimelineToS3(
        timeline,
        trackedPlayerAliases,
        gameCreatedAt,
        abortSignal,
      ),
    readCanonical: async (descriptor, abortSignal) =>
      await readArchivedPayload({
        descriptor,
        matchId: timeline.metadata.matchId,
        abortSignal,
        parse: (value) => RawTimelineSchema.safeParse(value),
        expected: "a match timeline",
      }),
  });
}

export async function archivePrematchReceipted(
  gameInfo: RawCurrentGameInfo,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult<RawCurrentGameInfo>> {
  const matchId = prematchReceiptMatchId(gameInfo);
  return await archiveUnderFence({
    matchId,
    artifactKind: "prematch",
    options,
    put: async (abortSignal) => {
      const result = await savePrematchDataToS3(
        gameInfo,
        trackedPlayerAliases,
        abortSignal,
      );
      return result.status === "skipped_no_bucket" ||
        result.artifact === undefined
        ? { status: "skipped_no_bucket" }
        : { status: "saved", artifact: result.artifact };
    },
    readCanonical: async (descriptor, abortSignal) =>
      await readArchivedPayload({
        descriptor,
        matchId,
        abortSignal,
        parse: (value) => RawCurrentGameInfoSchema.safeParse(value),
        expected: "a spectator payload",
      }),
  });
}
