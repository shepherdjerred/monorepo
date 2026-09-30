import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  RawMatchSchema,
  type RawCurrentGameInfo,
  type RawMatch,
} from "@scout-for-lol/data";
import type * as ReceiptRepositoryModule from "#src/database/durable/receipt-repository.ts";
import {
  prematchReceiptMatchId,
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
  receiptMatchId,
} from "#src/report-lake/durable-receipts.ts";
import {
  archiveMatchReceipted,
  archivePrematchReceipted,
  type ArchiveFenceBudget,
} from "#src/report-lake/receipted-archive.ts";
import {
  loadRawMatchFixture,
  rawCurrentGameInfoFixture,
} from "#src/testing/raw-capture-fixtures.ts";
import {
  mockS3ObjectStore,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
  type S3ObjectStore,
} from "#src/storage/s3-test-helpers.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The archive door's fence, against a real Postgres.
 *
 * The advisory lock is the whole subject here, so it cannot be faked: a double
 * would serialize by construction and prove nothing. The S3 client is still a
 * mock, because the hazard is about ORDER rather than about storage.
 *
 * Both families are covered because both are exposed. A prematch payload varies
 * between polls by construction; a MatchV5 payload is semantically stable once
 * the game is over but its BYTES are not guaranteed identical across fetches,
 * and the v1-vs-V2 window archives one match from two of them.
 */

/** The second argument to `client.send`, where the abort signal travels. */
const SendOptionsSchema = z.object({
  abortSignal: z.instanceof(AbortSignal).optional(),
});

/**
 * The receipt recorder, real by default. `poison` makes the next receipt write
 * lose its database connection mid-transaction — the session behind the
 * fencing transaction is terminated — so the fail-open contract is proved at
 * the boundary that actually breaks. A mere statement error would not do: a
 * transaction aborted by one is rolled back silently at commit, and the
 * boundary is never reached. A dropped connection makes the commit itself
 * reject, after the put has landed.
 */
const recorder = vi.hoisted(() => ({ poison: false }));

/**
 * The receipt LOOKUP the door gates on, real by default. `stallOnceMs` holds
 * the next lookup open for that long — a slow or contended database answering
 * the read-gate query — so the budget tests can prove that time spent between
 * acquiring the lock and starting the external work comes out of the same
 * lifetime. One-shot, so the suite's own `listReceipts` assertions afterwards
 * are not stalled with it.
 */
const lookup = vi.hoisted(() => ({ stallOnceMs: 0 }));

vi.mock("#src/database/durable/receipt-repository.ts", async () => {
  const actual = await vi.importActual<typeof ReceiptRepositoryModule>(
    "#src/database/durable/receipt-repository.ts",
  );
  return {
    ...actual,
    recordReceipt: async (
      db: Parameters<typeof actual.recordReceipt>[0],
      record: Parameters<typeof actual.recordReceipt>[1],
    ) => {
      if (recorder.poison) {
        recorder.poison = false;
        await db.$executeRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
      }
      return await actual.recordReceipt(db, record);
    },
    listReceipts: async (
      db: Parameters<typeof actual.listReceipts>[0],
      args: Parameters<typeof actual.listReceipts>[1],
    ) => {
      if (lookup.stallOnceMs > 0) {
        const stallMs = lookup.stallOnceMs;
        lookup.stallOnceMs = 0;
        await new Promise((done) => setTimeout(done, stallMs));
      }
      return await actual.listReceipts(db, args);
    },
  };
});

const { listReceipts } =
  await import("#src/database/durable/receipt-repository.ts");

const { prisma } = createTestDatabase("scout-archive-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

/** How long a put takes, so a second unfenced attempt would start inside it. */
const SLOW_PUT_MS = 250;

/** A budget no test here can exhaust, to shrink one number at a time from. */
const GENEROUS: ArchiveFenceBudget = {
  lockLifetimeMs: 20_000,
  lockWaitMs: 15_000,
  externalDeadlineMs: 10_000,
  settleMarginMs: 500,
};

/**
 * A holder that keeps the lock for `holdMs` and then leaves WITHOUT a receipt:
 * its put fails at the last moment, deterministically — a 4xx, which the put
 * retry loop does not retry, so the holder's one attempt is its only one.
 * What a follower meets after that is the whole subject of the budget tests:
 * a lock it waited for, and less of its own lifetime than it started with.
 */
function holderThenFollowerPuts(args: {
  holdMs: number;
  followerPutMs: number;
}): void {
  let puts = 0;
  s3Mock.on(PutObjectCommand).callsFake(async () => {
    puts += 1;
    if (puts === 1) {
      await new Promise((done) => setTimeout(done, args.holdMs));
      throw Object.assign(
        new Error("holder's put was refused after holding the lock"),
        { $metadata: { httpStatusCode: 403 } },
      );
    }
    await new Promise((done) => setTimeout(done, args.followerPutMs));
    return { $metadata: { httpStatusCode: 200 } };
  });
}

/**
 * Race two captures of one game through the door under one budget, and answer
 * with what each said.
 *
 * The two callers race for the lock, so which of them is the holder is not
 * theirs to choose; the assertions read every outcome by what it says, never
 * by position. `count(text)` is how many callers ended with that text in their
 * rejection.
 */
async function raceCaptures(
  gameId: number,
  budget: ArchiveFenceBudget,
): Promise<{ count: (text: string) => number; matchId: RiotMatchId }> {
  const first = gameSeenAt(gameId, -30);
  const second = gameSeenAt(gameId, 45);
  const settled = await Promise.allSettled([
    archivePrematchReceipted(first, [], {
      database: prisma,
      fenceBudget: budget,
    }),
    archivePrematchReceipted(second, [], {
      database: prisma,
      fenceBudget: budget,
    }),
  ]);
  const reasons = settled.map((result) =>
    result.status === "rejected" ? String(result.reason) : "fulfilled",
  );
  return {
    count: (text) => reasons.filter((reason) => reason.includes(text)).length,
    matchId: prematchReceiptMatchId(first),
  };
}

/** The abort signal the SDK was handed on the n-th send, if any. */
function abortSignalOfSend(index: number): AbortSignal | undefined {
  const sendArgs = z.array(z.unknown()).parse(s3Mock.call(index).args);
  return SendOptionsSchema.safeParse(sendArgs[1]).data?.abortSignal;
}

/**
 * The door reads an already-archived object back to hand callers its canonical
 * contents, so this suite needs a store that returns what was actually put.
 */
let s3: S3ObjectStore;

beforeEach(() => {
  resetS3TestState();
  setS3TestBucket("scout-archive-fence-test");
  s3 = mockS3ObjectStore({ putDelayMs: SLOW_PUT_MS });
});

afterEach(() => {
  resetS3TestState();
  setS3TestBucket(undefined);
});

/**
 * The same live game, seen a moment apart.
 *
 * `gameLength` advances between spectator fetches, which is exactly what makes
 * this door's hazard real: the S3 key is deterministic but the bytes under it
 * are not, so two captures of one game write DIFFERENT content to the SAME
 * key. Using one fixture for both captures would hide the bug — identical
 * bytes produce identical digests and nothing could disagree.
 */
function gameSeenAt(gameId: number, gameLength: number): RawCurrentGameInfo {
  return { ...rawCurrentGameInfoFixture(), gameId, gameLength };
}

/**
 * The same completed match, fetched twice.
 *
 * A MatchV5 response is semantically stable once the game is over, but that is
 * stability of MEANING, not identity of bytes: serialization order and late
 * corrections both produce a different body under the same key. Using one
 * fixture for both would hide the bug exactly as it would for prematch.
 */
async function matchFetchedAs(gameDuration: number): Promise<RawMatch> {
  const match = await loadRawMatchFixture();
  return { ...match, info: { ...match.info, gameDuration } };
}

describe("two overlapping prematch captures", () => {
  test("cannot interleave put and attest", async () => {
    const first = gameSeenAt(5_500_000_101, -30);
    const second = gameSeenAt(5_500_000_101, 45);
    const matchId = prematchReceiptMatchId(first);

    const [a, b] = await Promise.all([
      archivePrematchReceipted(first, [], { database: prisma }),
      archivePrematchReceipted(second, [], { database: prisma }),
    ]);

    // The fence's whole job. Unfenced, the second capture would enter its put
    // during the first's — overwriting the object — and only then discover the
    // receipt mismatch, leaving S3 holding the second's bytes under the first's
    // attested digest.
    expect(s3.putCount()).toBe(1);

    const outcomes = [a.status, b.status].toSorted();
    expect(outcomes).toEqual(["already_archived", "archived"]);

    const receipts = await listReceipts(prisma, { matchId });
    const archived = receipts.filter(
      (record) => record.receipt.kind === rawArchiveReceiptKind("prematch"),
    );
    expect(archived).toHaveLength(1);

    // The invariant this table exists for: the one object that was stored is
    // the one every attestation describes, and both callers were told the same
    // identity rather than one of them being handed bytes that no longer exist.
    const evidence = archived[0]?.evidence;
    if (evidence == null) throw new Error("the receipt recorded no evidence");
    const attested = rawArchiveEvidenceCodec.parse(JSON.parse(evidence));
    for (const result of [a, b]) {
      if (result.status === "skipped_no_bucket") {
        throw new Error("the bucket was configured; this cannot be skipped");
      }
      expect(result.artifact.key).toBe(attested.key);
      expect(result.artifact.digest).toBe(attested.digest);
    }
  }, 30_000);

  test("hands a later caller the ARCHIVED bytes, not its own fresher ones", async () => {
    // The divergence this prevents: v1 archives the game at gameLength -30,
    // then a second capture arrives holding the same game at 600. If the door
    // answered with only a descriptor, that caller would stage rows derived
    // from ITS payload while the staging receipt named the archived object
    // they did not come from — the lake disagreeing with both its own receipt
    // and canonical S3.
    const archivedAt = gameSeenAt(5_500_000_103, -30);
    const first = await archivePrematchReceipted(archivedAt, [], {
      database: prisma,
    });
    expect(first.status).toBe("archived");

    const laterCapture = gameSeenAt(5_500_000_103, 600);
    const second = await archivePrematchReceipted(laterCapture, [], {
      database: prisma,
    });

    expect(second.status).toBe("already_archived");
    if (second.status !== "already_archived") return;
    // What a caller will stage from: the snapshot that is actually in S3.
    expect(second.canonical.gameLength).toBe(-30);
    expect(second.canonical.gameLength).not.toBe(laterCapture.gameLength);
    // And it is the object the descriptor names, digest included.
    const storedText = s3.objects.get(second.artifact.key);
    expect(storedText).toBeDefined();
    expect(JSON.parse(storedText ?? "{}")).toMatchObject({ gameLength: -30 });
    expect(s3.putCount()).toBe(1);
  }, 30_000);

  test("cancels a put that stalls past its fence deadline, recording nothing", async () => {
    // The zombie the deadline exists to prevent: a put still in flight when the
    // transaction times out is not cancelled by Prisma, so it can land AFTER a
    // rival has written and attested different bytes.
    const stalled = gameSeenAt(5_500_000_104, -30);
    // Never settles on its own: only the fence can end this.
    const stallForever = new Promise<never>(() => {
      // Deliberately never resolved or rejected.
    });
    s3Mock.on(PutObjectCommand).callsFake(() => stallForever);

    await expect(
      archivePrematchReceipted(stalled, [], {
        database: prisma,
        fenceBudget: { ...GENEROUS, externalDeadlineMs: 300 },
      }),
    ).rejects.toThrow(/fence deadline/);

    // Two distinct guarantees. The call SETTLED, so the caller never blocks
    // past the lock's lifetime...
    const matchId = prematchReceiptMatchId(stalled);
    const receipts = await listReceipts(prisma, { matchId });
    expect(receipts).toHaveLength(0);
    // ...and the request was actually CANCELLED rather than merely abandoned,
    // which is what stops it landing later. A race alone would leave it
    // running, so this reads the signal the SDK was actually handed.
    const sendArgs = z.array(z.unknown()).parse(s3Mock.call(0).args);
    const sendOptions = SendOptionsSchema.safeParse(sendArgs[1]);
    expect(sendOptions.data?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(sendOptions.data?.abortSignal?.aborted).toBe(true);
  }, 30_000);

  test("a later capture of a game already archived never puts again", async () => {
    const game = gameSeenAt(5_500_000_102, -30);

    const first = await archivePrematchReceipted(game, [], {
      database: prisma,
    });
    expect(first.status).toBe("archived");
    expect(s3.putCount()).toBe(1);

    // The gate is inside the lock, so it is answered from the standing receipt
    // rather than from anything the caller remembered.
    const again = await archivePrematchReceipted(
      gameSeenAt(5_500_000_102, 600),
      [],
      { database: prisma },
    );
    expect(again.status).toBe("already_archived");
    expect(s3.putCount()).toBe(1);
  }, 30_000);
});

describe("the fence's budget after a lock wait", () => {
  test("a follower that acquires late puts against its REMAINING lifetime, not a fresh deadline", async () => {
    // Lifetime 3000, margin 500. The holder keeps the lock for 1800 and
    // leaves with no receipt, so the follower acquires with ~1200 left and
    // may put for at most ~700 — a fresh 2000 would outlive the transaction,
    // and Prisma would release the lock under a put still in flight: the
    // zombie the fence exists to prevent.
    holderThenFollowerPuts({ holdMs: 1800, followerPutMs: 1500 });

    const race = await raceCaptures(5_500_000_201, {
      lockLifetimeMs: 3000,
      lockWaitMs: 2500,
      externalDeadlineMs: 2000,
      settleMarginMs: 500,
    });

    // The holder left on its refused put; the follower failed by the FENCE's
    // own deadline, before the transaction could lapse — not by Prisma's
    // timer after the put had already escaped it.
    expect(race.count("refused after holding")).toBe(1);
    expect(race.count("fence deadline")).toBe(1);
    expect(abortSignalOfSend(1)?.aborted).toBe(true);
    const receipts = await listReceipts(prisma, { matchId: race.matchId });
    expect(receipts).toHaveLength(0);
  }, 30_000);

  test("bounds the lock wait so a starved follower fails closed before it can put", async () => {
    // The holder keeps the lock for 1500; the follower may wait 300. It fails
    // at the lock, having put nothing and spent none of its lifetime.
    holderThenFollowerPuts({ holdMs: 1500, followerPutMs: 100 });

    const race = await raceCaptures(5_500_000_202, {
      ...GENEROUS,
      lockWaitMs: 300,
    });

    expect(race.count("refused after holding")).toBe(1);
    expect(race.count("could not acquire its fence")).toBe(1);
    // Exactly one put: the holder's. The follower never reached its own.
    expect(s3Mock.calls()).toHaveLength(1);
  }, 30_000);
});

describe("the fence's budget after a slow receipt lookup", () => {
  /**
   * Lifetime 6000, margin 1000, external deadline 4000. The read-gate lookup
   * stalls for 3000 AFTER the lock is held, so the external work may start
   * with ~3000 of lifetime left and must be bounded by ~2000 — a deadline
   * derived when the lock was acquired would grant it the full 4000, and
   * Prisma would release the lock under it at 6000 while it was still in
   * flight: the zombie the fence exists to prevent.
   */
  const AFTER_SLOW_LOOKUP: ArchiveFenceBudget = {
    lockLifetimeMs: 6000,
    lockWaitMs: 1000,
    externalDeadlineMs: 4000,
    settleMarginMs: 1000,
  };
  const LOOKUP_STALL_MS = 3000;

  test("bounds the put by what is left AFTER the lookup, not by the lock acquisition", async () => {
    const game = gameSeenAt(5_500_000_301, -30);
    // A put that would fit a fresh deadline but not the remainder.
    s3Mock.on(PutObjectCommand).callsFake(async () => {
      await new Promise((done) => setTimeout(done, 3500));
      return { $metadata: { httpStatusCode: 200 } };
    });
    lookup.stallOnceMs = LOOKUP_STALL_MS;

    const startedAt = Date.now();
    await expect(
      archivePrematchReceipted(game, [], {
        database: prisma,
        fenceBudget: AFTER_SLOW_LOOKUP,
      }),
    ).rejects.toThrow(/fence deadline/);

    // Failed by the FENCE, inside the lock's lifetime — not resolved after
    // Prisma's timer had already released the lock under a put that then
    // landed unfenced and was reported `archived` with a failed receipt.
    expect(Date.now() - startedAt).toBeLessThan(
      AFTER_SLOW_LOOKUP.lockLifetimeMs,
    );
    expect(abortSignalOfSend(0)?.aborted).toBe(true);
    const receipts = await listReceipts(prisma, {
      matchId: prematchReceiptMatchId(game),
    });
    expect(receipts).toHaveLength(0);
  }, 30_000);

  test("bounds the canonical read-back the same way", async () => {
    // The `already_archived` answer reads the object back under the same
    // lock, after the same lookup, and is exposed to the same zombie.
    const game = gameSeenAt(5_500_000_302, -30);
    const first = await archivePrematchReceipted(game, [], {
      database: prisma,
    });
    expect(first.status).toBe("archived");
    s3Mock.on(GetObjectCommand).callsFake(
      () =>
        new Promise<never>(() => {
          // Deliberately never resolved or rejected: only the fence ends it.
        }),
    );
    lookup.stallOnceMs = LOOKUP_STALL_MS;

    const startedAt = Date.now();
    await expect(
      archivePrematchReceipted(gameSeenAt(5_500_000_302, 600), [], {
        database: prisma,
        fenceBudget: AFTER_SLOW_LOOKUP,
      }),
    ).rejects.toThrow(/fence deadline/);

    expect(Date.now() - startedAt).toBeLessThan(
      AFTER_SLOW_LOOKUP.lockLifetimeMs,
    );
    expect(abortSignalOfSend(1)?.aborted).toBe(true);
  }, 30_000);
});

describe("a receipt recorder that fails inside the fence", () => {
  test("keeps the archive fail-open: the put stands and the receipt is reported failed", async () => {
    // The live v1 paths depend on this. A receipt write that aborts the
    // transaction must not turn a canonical put that already landed into an
    // ingest failure; the object is archived, the record of it is not, and
    // `failed` is the answer that has always meant exactly that.
    const game = gameSeenAt(5_500_000_203, -30);
    recorder.poison = true;

    const result = await archivePrematchReceipted(game, [], {
      database: prisma,
    });

    expect(result.status).toBe("archived");
    if (result.status !== "archived") return;
    expect(result.receipt).toBe("failed");
    expect(s3.objects.has(result.artifact.key)).toBe(true);
    const receipts = await listReceipts(prisma, {
      matchId: prematchReceiptMatchId(game),
    });
    expect(receipts).toHaveLength(0);
  }, 30_000);
});

describe("two overlapping match archives", () => {
  test("cannot interleave put and attest", async () => {
    const first = await matchFetchedAs(1800);
    const second = await matchFetchedAs(1801);
    const matchId = receiptMatchId(first.metadata.matchId);

    const [a, b] = await Promise.all([
      archiveMatchReceipted(first, [], { database: prisma }),
      archiveMatchReceipted(second, [], { database: prisma }),
    ]);

    // Unfenced, the loser's put lands over the winner's object and the standing
    // receipt then attests bytes S3 no longer holds — the drift the #2862 gate
    // found, which the immutability assumption had excused.
    expect(s3.putCount()).toBe(1);
    expect([a.status, b.status].toSorted()).toEqual([
      "already_archived",
      "archived",
    ]);

    const receipts = await listReceipts(prisma, { matchId });
    const archived = receipts.filter(
      (record) => record.receipt.kind === rawArchiveReceiptKind("match"),
    );
    expect(archived).toHaveLength(1);

    // The invariant, asserted directly: the object that is actually stored is
    // the one the standing receipt describes, byte for byte.
    const evidence = archived[0]?.evidence;
    if (evidence == null) throw new Error("the receipt recorded no evidence");
    const attested = rawArchiveEvidenceCodec.parse(JSON.parse(evidence));
    const storedText = s3.objects.get(attested.key);
    if (storedText === undefined) throw new Error("nothing was stored");
    expect(computeSha256Digest(new TextEncoder().encode(storedText))).toBe(
      attested.digest,
    );

    // And the loser was handed the canonical bytes rather than its own, so the
    // lake rows it stages describe the object the receipt names.
    const loser = a.status === "already_archived" ? a : b;
    if (loser.status !== "already_archived") {
      throw new Error(
        "one caller must have found the archive already standing",
      );
    }
    expect(loser.canonical.info.gameDuration).toBe(
      RawMatchSchema.parse(JSON.parse(storedText)).info.gameDuration,
    );
  }, 30_000);
});
