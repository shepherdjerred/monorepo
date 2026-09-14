import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import {
  prematchReceiptMatchId,
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";
import { archivePrematchReceipted } from "#src/report-lake/receipted-archive.ts";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";
import {
  mockS3ObjectStore,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
  type S3ObjectStore,
} from "#src/storage/s3-test-helpers.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The prematch archive door's fence, against a real Postgres.
 *
 * The advisory lock is the whole subject here, so it cannot be faked: a double
 * would serialize by construction and prove nothing. The S3 client is still a
 * mock, because the hazard is about ORDER rather than about storage.
 */

/** The second argument to `client.send`, where the abort signal travels. */
const SendOptionsSchema = z.object({
  abortSignal: z.instanceof(AbortSignal).optional(),
});

const { prisma } = createTestDatabase("scout-prematch-archive-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

/** How long a put takes, so a second unfenced attempt would start inside it. */
const SLOW_PUT_MS = 250;

/**
 * The door reads an already-archived object back to hand callers its canonical
 * contents, so this suite needs a store that returns what was actually put.
 */
let s3: S3ObjectStore;

beforeEach(() => {
  resetS3TestState();
  setS3TestBucket("scout-prematch-fence-test");
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
        putDeadlineMs: 300,
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
