import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
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
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The prematch archive door's fence, against a real Postgres.
 *
 * The advisory lock is the whole subject here, so it cannot be faked: a double
 * would serialize by construction and prove nothing. The S3 client is still a
 * mock, because the hazard is about ORDER rather than about storage.
 */

const { prisma } = createTestDatabase("scout-prematch-archive-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

/** How long a put takes, so a second unfenced attempt would start inside it. */
const SLOW_PUT_MS = 250;

let puts = 0;

beforeEach(() => {
  puts = 0;
  resetS3TestState();
  setS3TestBucket("scout-prematch-fence-test");
  s3Mock.on(PutObjectCommand).callsFake(async () => {
    puts += 1;
    await new Promise((done) => setTimeout(done, SLOW_PUT_MS));
    return { $metadata: { httpStatusCode: 200 } };
  });
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
    expect(puts).toBe(1);

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

  test("a later capture of a game already archived never puts again", async () => {
    const game = gameSeenAt(5_500_000_102, -30);

    const first = await archivePrematchReceipted(game, [], {
      database: prisma,
    });
    expect(first.status).toBe("archived");
    expect(puts).toBe(1);

    // The gate is inside the lock, so it is answered from the standing receipt
    // rather than from anything the caller remembered.
    const again = await archivePrematchReceipted(
      gameSeenAt(5_500_000_102, 600),
      [],
      { database: prisma },
    );
    expect(again.status).toBe("already_archived");
    expect(puts).toBe(1);
  }, 30_000);
});
