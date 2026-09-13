import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ApplicationFailure } from "@temporalio/common";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  buildReceipt,
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import {
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";
import { resumeArchivedPrematchContext } from "#src/temporal/v2/prematch-resume.ts";

/**
 * Resuming a capture from what it already archived.
 *
 * The scenario is a run that stored the snapshot and then died before staging
 * it or minting its intents. By the time the retry lands the game is over, so
 * the live spectator endpoint has nothing — and a capture that asked Riot
 * first would report an empty result, complete, and leave its game-scoped
 * Workflow ID sealing the loss. These tests pin the read that avoids that.
 */

const { prisma } = createTestDatabase("scout-prematch-resume");

afterAll(async () => {
  await prisma.$disconnect();
});

const ARCHIVED_KEY = "prematch/2026/09/13/5500000201/spectator-data.json";

beforeEach(() => {
  resetS3TestState();
  setS3TestBucket("scout-prematch-resume-test");
});

afterEach(() => {
  resetS3TestState();
  setS3TestBucket(undefined);
});

/**
 * Serve the archived object, exactly as S3 would.
 *
 * A GetObject Body carries an SdkStream that cannot be constructed in test
 * code, so this returns the partial mock the rest of the suite uses:
 * `callsFake` accepts any return type where `resolves` would not.
 */
function mockArchivedObject(text: string): void {
  s3Mock.on(GetObjectCommand).callsFake(() => ({
    Body: { transformToString: () => Promise.resolve(text) },
    $metadata: {},
  }));
}

async function standingArchiveReceipt(args: {
  matchId: string;
  key: string;
  digest: string;
}): Promise<void> {
  const descriptor = ArtifactDescriptorSchema.parse({
    kind: "prematch",
    key: args.key,
    digest: args.digest,
    bytes: 2048,
    contentType: "application/json",
    capturedAt: "2026-09-13T00:00:00.000Z",
  });
  await recordReceipt(
    prisma,
    buildReceipt({
      matchId: RiotMatchIdSchema.parse(args.matchId),
      kind: rawArchiveReceiptKind("prematch"),
      evidence: rawArchiveEvidenceCodec.serialize(descriptor),
      recordedAt: new Date("2026-09-13T00:00:00.000Z"),
    }),
  );
}

describe("resumeArchivedPrematchContext", () => {
  test("is null when nothing was ever archived", async () => {
    // The only state in which a live read may be consulted and its answer
    // believed: there is no snapshot, so there is nothing to resume from.
    const resumed = await resumeArchivedPrematchContext(
      RiotMatchIdSchema.parse("NA1_5500000200"),
      prisma,
    );
    expect(resumed).toBeNull();
  });

  test("rebuilds the capture context from the archived bytes", async () => {
    const matchId = "NA1_5500000201";
    const archived = { ...rawCurrentGameInfoFixture(), gameId: 5_500_000_201 };
    const text = JSON.stringify(archived, null, 2);
    await standingArchiveReceipt({
      matchId,
      key: ARCHIVED_KEY,
      digest: computeSha256Digest(new TextEncoder().encode(text)),
    });
    mockArchivedObject(text);

    const resumed = await resumeArchivedPrematchContext(
      RiotMatchIdSchema.parse(matchId),
      prisma,
    );

    // Riot was never asked. S3 is the canonical raw store, so the archived
    // payload is as good as a live one and is the only one still available
    // once the game has ended.
    expect(resumed?.riotMatchId).toBe(matchId);
    expect(resumed?.gameInfo.gameId).toBe(5_500_000_201);
    expect(resumed?.gameInfo.participants).toHaveLength(
      archived.participants.length,
    );
  });

  test("refuses bytes that do not match the digest the receipt attested", async () => {
    const matchId = "NA1_5500000202";
    const archived = { ...rawCurrentGameInfoFixture(), gameId: 5_500_000_202 };
    await standingArchiveReceipt({
      matchId,
      key: ARCHIVED_KEY,
      digest: computeSha256Digest(
        new TextEncoder().encode("the bytes we archived"),
      ),
    });
    // Something overwrote the object since the receipt was written.
    mockArchivedObject(JSON.stringify(archived, null, 2));

    // Staging rows and minting notifications from content nothing attested to
    // would be worse than failing: the receipt would go on vouching for bytes
    // that are gone. Non-retryable because no retry changes what is stored.
    const settled = await resumeArchivedPrematchContext(
      RiotMatchIdSchema.parse(matchId),
      prisma,
    ).then(
      (value) => value,
      (error: unknown) => error,
    );

    expect(settled).toBeInstanceOf(ApplicationFailure);
    if (!(settled instanceof ApplicationFailure)) return;
    expect(settled.type).toBe("MissingArchivedSnapshot");
    expect(settled.nonRetryable).toBe(true);
  });
});
