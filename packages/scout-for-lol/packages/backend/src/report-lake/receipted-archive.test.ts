import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  loadRawMatchFixture,
  rawCurrentGameInfoFixture,
  rawTimelineFixture,
} from "#src/testing/raw-capture-fixtures.ts";
import {
  ArtifactDescriptorSchema,
  ArtifactKindSchema,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { matchProcessingReceiptIdentityKey } from "@scout-for-lol/domain/match-processing/states.ts";
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
}));

vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  recordReceipt: mocks.recordReceipt,
}));

const ARTIFACT_KINDS = ArtifactKindSchema.options;

const {
  RECEIPTED_LAKE_RECEIPT_KINDS,
  lakeStagingReceiptKind,
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
} = await import("#src/report-lake/durable-receipts.ts");
const {
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

afterEach(resetS3TestState);

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
    expect(rawArchiveEvidenceCodec.parse(JSON.parse(receipt.evidence))).toEqual(
      ArtifactDescriptorSchema.parse(result.artifact),
    );
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
    const timeline = rawTimelineFixture("NA1_5370969615");
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
    ]);
  });

  test("staging kinds are distinct from archive kinds for the same artifact", () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(lakeStagingReceiptKind(kind)).not.toBe(
        rawArchiveReceiptKind(kind),
      );
    }
    expect(new Set(RECEIPTED_LAKE_RECEIPT_KINDS).size).toBe(
      ARTIFACT_KINDS.length * 2,
    );
  });
});
