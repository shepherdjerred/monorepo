import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  loadRawMatchFixture,
  rawCurrentGameInfoFixture,
  rawTimelineFixture,
} from "#src/testing/raw-capture-fixtures.ts";
import {
  ArtifactDescriptorSchema,
  ArtifactKindSchema,
  LakeArtifactKindSchema,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { matchProcessingReceiptIdentityKey } from "@scout-for-lol/domain/match-processing/states.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts";
import { SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS } from "#src/temporal/notification-lane/notification-receipts.ts";
import { SCOUT_RECOVERY_CONFLICT_RECEIPT_KIND } from "#src/temporal/recovery/recovery-receipts.ts";
import { MATCH_RECEIPT_KINDS } from "#src/durable/match/receipt-evidence.ts";
import {
  MatchProcessingReceiptRecordSchema,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";
import {
  getValidatedPutCommand,
  mockFailedPut,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  recordReceipt: vi.fn(),
  /** No receipt stands, so every door's gate falls through to its put. */
  listReceipts: vi.fn(() => []),
  /** Whether the database can open a transaction at all. */
  database: { available: true },
}));

// These tests are about which receipts each artifact produces, so the door's
// transaction is only scaffolding here; see `fenced-door-doubles.ts`.
vi.mock("#src/database/index.ts", async () => {
  const doubles = await import("#src/testing/fenced-door-doubles.ts");
  return {
    prisma: doubles.transactionRunningPrismaDouble({
      available: () => mocks.database.available,
    }),
  };
});
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  recordReceipt: mocks.recordReceipt,
  listReceipts: mocks.listReceipts,
}));

const ARTIFACT_KINDS = ArtifactKindSchema.options;
const LAKE_ARTIFACT_KINDS = LakeArtifactKindSchema.options;

const {
  RECEIPTED_LAKE_RECEIPT_KINDS,
  lakeStagingReceiptKind,
  rawArchiveDescriptorOf,
  rawArchiveEvidenceCodec,
  rawArchiveEvidenceOf,
  rawArchiveReceiptKind,
} = await import("#src/report-lake/durable-receipts.ts");
const {
  archiveClientBundleReceipted,
  archiveMatchReceipted,
  archivePrematchReceipted,
  archiveTimelineReceipted,
} = await import("#src/report-lake/receipted-archive.ts");

function recordedReceipt(callIndex = 0): MatchProcessingReceiptRecord {
  const call: unknown = mocks.recordReceipt.mock.calls[callIndex]?.[1];
  if (call === undefined) throw new Error("no receipt was recorded");
  return MatchProcessingReceiptRecordSchema.parse(call);
}

/**
 * The `(kind, version, scope)` identity `recordReceipt` enforces as unique
 * within one match. Two receipts sharing it are the same receipt, so this is
 * what has to differ between a match and its timeline.
 */
function receiptIdentity(record: MatchProcessingReceiptRecord): string {
  return matchProcessingReceiptIdentityKey({
    kind: record.receipt.kind,
    version: record.receipt.version,
    scope: record.receipt.scope,
  });
}

beforeEach(() => {
  resetS3TestState();
  mocks.recordReceipt.mockReset();
  mocks.recordReceipt.mockResolvedValue({ outcome: "applied" });
});

afterEach(() => {
  mocks.database.available = true;
  resetS3TestState();
});

describe("the no-bucket path", () => {
  test.each([
    {
      family: "match",
      archive: async () =>
        await archiveMatchReceipted(await loadRawMatchFixture(), []),
    },
    {
      family: "timeline",
      archive: async () =>
        await archiveTimelineReceipted(
          rawTimelineFixture(RiotMatchIdSchema.parse("NA1_5370969615")),
          [],
          new Date(),
        ),
    },
    {
      family: "prematch",
      archive: async () =>
        await archivePrematchReceipted(rawCurrentGameInfoFixture(), []),
    },
  ])(
    "answers $family archival as skipped without opening a transaction",
    async ({ archive }) => {
      // The documented dev/test no-op: nothing can be archived, so nothing is
      // read, locked or written. Proved against a database that refuses to
      // open a transaction, not one that quietly would have.
      setS3TestBucket(undefined);
      mocks.database.available = false;

      await expect(archive()).resolves.toEqual({ status: "skipped_no_bucket" });
      expect(mocks.listReceipts).not.toHaveBeenCalled();
      expect(mocks.recordReceipt).not.toHaveBeenCalled();
    },
  );
});

describe("receipted match archival", () => {
  test("records a raw-archive receipt carrying the stored descriptor", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await archiveMatchReceipted(match, []);

    expect(result.status).toBe("archived");
    if (result.status !== "archived") throw new Error("expected an archive");
    expect(result.receipt).toBe("recorded");

    const receipt = recordedReceipt();
    expect(receipt.matchId).toBe(match.metadata.matchId);
    expect(receipt.receipt.kind).toBe("raw-archive-match");
    expect(receipt.receipt.scope).toEqual({ kind: "global" });
    if (receipt.evidence === null) throw new Error("receipt had no evidence");
    // The evidence is the artifact's identity; the capture instant travels as
    // the receipt's own observational column, so the descriptor round-trips.
    expect(rawArchiveEvidenceCodec.parse(JSON.parse(receipt.evidence))).toEqual(
      rawArchiveEvidenceOf(ArtifactDescriptorSchema.parse(result.artifact)),
    );
    expect(receipt.receipt.recordedAt).toBe(result.artifact.capturedAt);
    expect(rawArchiveDescriptorOf(receipt)).toEqual(result.artifact);
  });

  test("the receipted descriptor points at the object that was really written", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await archiveMatchReceipted(match, []);

    if (result.status !== "archived") throw new Error("expected an archive");
    expect(result.artifact.key).toBe(getValidatedPutCommand().input.Key);
    expect(getValidatedPutCommand().input.Metadata?.["sha256"]).toBe(
      result.artifact.digest,
    );
  });

  test("a failed receipt write does not fail the archive", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();
    mocks.recordReceipt.mockRejectedValue(new Error("database is down"));

    const result = await archiveMatchReceipted(match, []);

    expect(result.status).toBe("archived");
    if (result.status !== "archived") throw new Error("expected an archive");
    expect(result.receipt).toBe("failed");
    expect(s3Mock.calls()).toHaveLength(1);
  });

  test("a failed archive throws and records nothing", async () => {
    const match = await loadRawMatchFixture();
    mockFailedPut("S3 upload failed");

    await expect(archiveMatchReceipted(match, [])).rejects.toThrow(
      `Failed to save match ${match.metadata.matchId} to S3`,
    );
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });

  test("records nothing when there is no bucket to archive into", async () => {
    const match = await loadRawMatchFixture();
    setS3TestBucket(undefined);
    mockSuccessfulPut();

    await expect(archiveMatchReceipted(match, [])).resolves.toEqual({
      status: "skipped_no_bucket",
    });
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });
});

describe("receipted timeline archival", () => {
  test("receipts the timeline against its own match id", async () => {
    const timeline = rawTimelineFixture(
      RiotMatchIdSchema.parse("NA1_5370969615"),
    );
    mockSuccessfulPut();

    const result = await archiveTimelineReceipted(
      timeline,
      [],
      new Date("2026-01-01T00:00:00.000Z"),
    );

    if (result.status !== "archived") throw new Error("expected an archive");
    expect(result.artifact.kind).toBe("timeline");
    expect(recordedReceipt().matchId).toBe("NA1_5370969615");
  });
});

describe("receipted client bundle archival", () => {
  test("stores the bundle beside the match it was converted from", async () => {
    const match = await loadRawMatchFixture();
    const matchId = match.metadata.matchId;
    const payload = { resource: "post_game", data: { matchHistory: {} } };
    mockSuccessfulPut();

    const result = await archiveClientBundleReceipted({
      matchId,
      payload,
      gameCreatedAt: new Date(match.info.gameCreation),
      observationId: "00000000-0000-4000-8000-000000000001",
    });

    if (result.status !== "archived") throw new Error("expected an archive");
    expect(result.artifact.kind).toBe("client_bundle");
    const put = getValidatedPutCommand().input;
    expect(put.Key).toMatch(
      new RegExp(
        String.raw`^games/\d{4}/\d{2}/\d{2}/${matchId}/client-bundle\.json$`,
        "u",
      ),
    );
    expect(put.Metadata?.["source"]).toBe("SCOUT_CLIENT");
    expect(recordedReceipt().receipt.kind).toBe("raw-archive-client-bundle");
  });

  test("records the match's own source in its archive metadata", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    await archiveMatchReceipted(
      { ...match, metadata: { ...match.metadata, dataVersion: "local-1" } },
      [],
    );

    expect(getValidatedPutCommand().input.Metadata?.["source"]).toBe(
      "SCOUT_CLIENT",
    );
  });
});

describe("a full ingest receipts every one of its artifacts", () => {
  test("match and timeline record two distinct receipt identities", async () => {
    // All three artifacts of a game share one match id, so a single
    // `raw-archive` kind would make them the SAME receipt and the second
    // archive of a normal ingest would land as a conflict.
    const match = await loadRawMatchFixture();
    const timeline = rawTimelineFixture(match.metadata.matchId);
    mockSuccessfulPut();

    await archiveMatchReceipted(match, []);
    await archiveTimelineReceipted(
      timeline,
      [],
      new Date(match.info.gameCreation),
    );

    expect(mocks.recordReceipt).toHaveBeenCalledTimes(2);
    const forMatch = recordedReceipt(0);
    const forTimeline = recordedReceipt(1);

    expect(forMatch.matchId).toBe(forTimeline.matchId);
    expect(forMatch.receipt.kind).toBe("raw-archive-match");
    expect(forTimeline.receipt.kind).toBe("raw-archive-timeline");
    expect(receiptIdentity(forMatch)).not.toBe(receiptIdentity(forTimeline));
  });

  test("a prematch snapshot is a third distinct identity for the same match", async () => {
    const gameInfo = rawCurrentGameInfoFixture();
    mockSuccessfulPut();

    await archivePrematchReceipted(gameInfo, []);

    const receipt = recordedReceipt();
    expect(receipt.matchId).toBe("NA1_5500000001");
    expect(receipt.receipt.kind).toBe("raw-archive-prematch");
  });

  test("every artifact kind maps to its own receipt kind", () => {
    const kinds = ARTIFACT_KINDS.map((kind) => rawArchiveReceiptKind(kind));

    expect(new Set(kinds).size).toBe(ARTIFACT_KINDS.length);
    expect(kinds).toEqual([
      "raw-archive-match",
      "raw-archive-timeline",
      "raw-archive-prematch",
      "raw-archive-client-bundle",
    ]);
  });

  test("staging kinds are distinct from archive kinds for the same artifact", () => {
    for (const kind of LAKE_ARTIFACT_KINDS) {
      expect(lakeStagingReceiptKind(kind)).not.toBe(
        rawArchiveReceiptKind(kind),
      );
    }
    // A client bundle is archived but never staged: the lake reads the match
    // converted from it, so it has an archive receipt and no staging one.
    expect(LAKE_ARTIFACT_KINDS).not.toContain("client_bundle");
    expect(new Set(RECEIPTED_LAKE_RECEIPT_KINDS).size).toBe(
      ARTIFACT_KINDS.length + LAKE_ARTIFACT_KINDS.length,
    );
  });

  test("no receipt kind is owned by two vocabularies", () => {
    // A shared kind would put two evidence shapes behind one receipt identity,
    // and whichever producer wrote second would lose to an evidence mismatch.
    // Nothing else prevents that: the migration's `kind` CHECK is a kebab-case
    // SHAPE constraint, not an enumeration, so a colliding kind inserts
    // happily and this assertion is the only place it can be caught.
    //
    // Pairwise over every vocabulary rather than between two of them, so a
    // fourth is one entry here instead of a new test someone has to remember
    // to write.
    const vocabularies: readonly {
      owner: string;
      kinds: readonly string[];
    }[] = [
      { owner: "lake projection", kinds: RECEIPTED_LAKE_RECEIPT_KINDS },
      { owner: "match bridge", kinds: Object.values(MATCH_RECEIPT_KINDS) },
      {
        owner: "V2 per-match core",
        kinds: Object.values(SCOUT_MATCH_RECEIPT_KINDS),
      },
      {
        owner: "V2 notification lane",
        kinds: Object.values(SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS),
      },
      {
        owner: "V2 recovery lane",
        kinds: [SCOUT_RECOVERY_CONFLICT_RECEIPT_KIND],
      },
    ];

    const collisions = vocabularies.flatMap((left, index) =>
      vocabularies
        .slice(index + 1)
        .flatMap((right) =>
          left.kinds
            .filter((kind) => right.kinds.includes(kind))
            .map((kind) => `${kind}: ${left.owner} and ${right.owner}`),
        ),
    );

    expect(collisions).toEqual([]);
  });
});
