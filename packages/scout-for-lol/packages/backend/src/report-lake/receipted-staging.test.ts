import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  artifactDescriptorFixture,
  loadRawMatchFixture,
  rawCurrentGameInfoFixture,
  rawTimelineFixture,
} from "#src/testing/raw-capture-fixtures.ts";
import {
  MatchProcessingReceiptRecordSchema,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";
import { MATCHES_STAGING_DIR } from "#src/report-lake/paths.ts";
import type { Counter } from "prom-client";
import {
  scoutDurableDualwriteFailuresTotal,
  scoutDurableDualwriteRecordsTotal,
} from "#src/metrics/durable.ts";
import { prisma } from "#src/database/index.ts";
import {
  recordDurableWrite,
  type DurableFacts,
} from "#src/durable/match/durable-facts.ts";

const mocks = vi.hoisted(() => ({
  recordReceipt: vi.fn(),
}));

// The repository is mocked rather than exercised so these tests state the
// wrapper's contract — what it records, and what it refuses to record — without
// a Postgres connection. `receipt-repository.integration.test.ts` owns the
// repository's own behaviour.
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  recordReceipt: mocks.recordReceipt,
}));

const { lakeStagingEvidenceCodec } =
  await import("#src/report-lake/durable-receipts.ts");
const {
  ReceiptedStagingError,
  stageMatchReceipted,
  stagePrematchReceipted,
  stageTimelineReceipted,
} = await import("#src/report-lake/receipted-staging.ts");

let lakeDir: string;

function recordedReceipt(callIndex = 0): MatchProcessingReceiptRecord {
  const call: unknown = mocks.recordReceipt.mock.calls[callIndex]?.[1];
  if (call === undefined) throw new Error("no receipt was recorded");
  // Parsed, not asserted: this doubles as a check that the wrapper hands the
  // repository a record the row codec would actually accept.
  return MatchProcessingReceiptRecordSchema.parse(call);
}

async function counterValue(
  counter: Counter,
  labels: Record<string, string>,
): Promise<number> {
  const collected = await counter.get();
  const match = collected.values.find((value) =>
    Object.entries(labels).every(([key, want]) => value.labels[key] === want),
  );
  return match?.value ?? 0;
}

function failuresFor(writeKind: string): Promise<number> {
  return counterValue(scoutDurableDualwriteFailuresTotal, {
    write_kind: writeKind,
  });
}

function recordsFor(writeKind: string, outcome: string): Promise<number> {
  return counterValue(scoutDurableDualwriteRecordsTotal, {
    write_kind: writeKind,
    outcome,
  });
}

/**
 * Make the lake scaffold impossible to create by occupying a staging directory
 * path with a plain file, so `mkdir` fails with EEXIST and the underlying
 * `write*StagingFile` returns false — the real failure mode, not a stubbed one.
 */
async function blockStagingScaffold(): Promise<void> {
  await Bun.write(path.join(lakeDir, MATCHES_STAGING_DIR), "not a directory");
}

function parsedEvidence(callIndex = 0): unknown {
  const evidence = recordedReceipt(callIndex).evidence;
  if (evidence === null) throw new Error("receipt carried no evidence");
  return lakeStagingEvidenceCodec.parse(JSON.parse(evidence));
}

beforeEach(async () => {
  mocks.recordReceipt.mockReset();
  mocks.recordReceipt.mockResolvedValue({ outcome: "applied" });
  lakeDir = await mkdtemp(path.join(tmpdir(), "receipted-staging-"));
});

afterEach(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("receipted match staging", () => {
  test("identifies the projection by source object and digest", async () => {
    const match = await loadRawMatchFixture();
    const source = artifactDescriptorFixture("match");

    const result = await stageMatchReceipted(lakeDir, match, { source });

    expect(result.receipt).toBe("recorded");
    expect(mocks.recordReceipt).toHaveBeenCalledTimes(1);
    const receipt = recordedReceipt();
    expect(receipt.matchId).toBe(match.metadata.matchId);
    expect(receipt.receipt.kind).toBe("lake-staging-match");
    expect(receipt.receipt.scope).toEqual({ kind: "global" });
    expect(parsedEvidence()).toEqual({
      objectKind: "match",
      sourceObjectKey: source.key,
      digest: source.digest,
      fileCount: 3,
    });
    expect(result.files).toHaveLength(3);
  });

  test("keeps local staging paths out of the receipt entirely", async () => {
    const match = await loadRawMatchFixture();

    const result = await stageMatchReceipted(lakeDir, match, {
      source: artifactDescriptorFixture("match"),
    });

    // The paths exist and are returned to the caller, but a receipt that named
    // them would be a claim about one role's RWO volume.
    expect(result.files.every((file) => file.startsWith(lakeDir))).toBe(true);
    const serialized = recordedReceipt().evidence ?? "";
    expect(serialized).not.toContain(lakeDir);
    for (const file of result.files) {
      expect(serialized).not.toContain(file);
    }
  });

  test("refuses to receipt staging against a mismatched artifact kind", async () => {
    const match = await loadRawMatchFixture();

    await expect(
      stageMatchReceipted(lakeDir, match, {
        source: artifactDescriptorFixture("timeline"),
      }),
    ).rejects.toThrow("does not describe what was staged");
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });

  test("throws typed and records nothing when staging fails", async () => {
    const match = await loadRawMatchFixture();
    await blockStagingScaffold();

    await expect(
      stageMatchReceipted(lakeDir, match, {
        source: artifactDescriptorFixture("match"),
      }),
    ).rejects.toBeInstanceOf(ReceiptedStagingError);
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });

  test("names the object kind and match on the typed error", async () => {
    const match = await loadRawMatchFixture();
    await blockStagingScaffold();

    await expect(
      stageMatchReceipted(lakeDir, match, {
        source: artifactDescriptorFixture("match"),
      }),
    ).rejects.toThrow(match.metadata.matchId);
  });

  test("succeeds when the receipt write fails, reporting the gap", async () => {
    const match = await loadRawMatchFixture();
    mocks.recordReceipt.mockRejectedValue(new Error("database is down"));

    const result = await stageMatchReceipted(lakeDir, match, {
      source: artifactDescriptorFixture("match"),
    });

    expect(result.receipt).toBe("failed");
    expect(result.files).toHaveLength(3);
  });

  test("reports a conflicting replay as a conflict, never as a failure", async () => {
    const match = await loadRawMatchFixture();
    mocks.recordReceipt.mockResolvedValue({
      outcome: "conflict",
      reason: "receipt-evidence-mismatch",
    });

    // A conflict is a definite answer from a write that SUCCEEDED, so it must
    // stay out of the failures counter that alerts on a broken recorder —
    // otherwise every benign retry pages someone.
    await expect(
      stageMatchReceipted(lakeDir, match, {
        source: artifactDescriptorFixture("match"),
      }),
    ).resolves.toMatchObject({
      receipt: "conflict",
    });
  });

  test("keeps conflicts out of the failures counter and thrown writes in it", async () => {
    const match = await loadRawMatchFixture();
    const source = artifactDescriptorFixture("match");
    const before = await failuresFor("lake-staging");

    mocks.recordReceipt.mockResolvedValue({
      outcome: "conflict",
      reason: "receipt-evidence-mismatch",
    });
    await stageMatchReceipted(lakeDir, match, { source });
    expect(await failuresFor("lake-staging")).toBe(before);

    mocks.recordReceipt.mockRejectedValue(new Error("database is down"));
    await stageMatchReceipted(lakeDir, match, { source });
    expect(await failuresFor("lake-staging")).toBe(before + 1);
  });

  test("counts every completed write on the records counter by outcome", async () => {
    const match = await loadRawMatchFixture();
    const source = artifactDescriptorFixture("match");
    const before = await recordsFor("lake-staging", "conflict");

    mocks.recordReceipt.mockResolvedValue({
      outcome: "conflict",
      reason: "receipt-evidence-mismatch",
    });
    await stageMatchReceipted(lakeDir, match, { source });

    expect(await recordsFor("lake-staging", "conflict")).toBe(before + 1);
  });

  test("reports an idempotent replay as recorded", async () => {
    const match = await loadRawMatchFixture();
    mocks.recordReceipt.mockResolvedValue({ outcome: "already-applied" });

    await expect(
      stageMatchReceipted(lakeDir, match, {
        source: artifactDescriptorFixture("match"),
      }),
    ).resolves.toMatchObject({
      receipt: "recorded",
    });
  });

  test("staging a match and its timeline records two distinct identities", async () => {
    // Staging shares the collision hazard archival has: one match id covers all
    // three artifacts, so a single `lake-staging` kind would make the timeline's
    // projection the same receipt as the match's.
    const match = await loadRawMatchFixture();
    const timeline = rawTimelineFixture(match.metadata.matchId);

    await stageMatchReceipted(lakeDir, match, {
      source: artifactDescriptorFixture("match"),
    });
    await stageTimelineReceipted(
      lakeDir,
      timeline,
      new Date("2026-09-12T00:00:00.000Z"),
      { source: artifactDescriptorFixture("timeline") },
    );

    expect(mocks.recordReceipt).toHaveBeenCalledTimes(2);
    const forMatch = recordedReceipt(0);
    const forTimeline = recordedReceipt(1);
    expect(forMatch.matchId).toBe(forTimeline.matchId);
    expect(forMatch.receipt.kind).toBe("lake-staging-match");
    expect(forTimeline.receipt.kind).toBe("lake-staging-timeline");
  });
});

describe("receipted timeline staging", () => {
  test("counts all four timeline tables as the projection's shape", async () => {
    const timeline = rawTimelineFixture("NA1_5370969615");
    const source = artifactDescriptorFixture("timeline");

    const result = await stageTimelineReceipted(
      lakeDir,
      timeline,
      new Date("2026-09-12T00:00:00.000Z"),
      { source },
    );

    expect(result.receipt).toBe("recorded");
    expect(result.files).toHaveLength(4);
    expect(parsedEvidence()).toEqual({
      objectKind: "timeline",
      sourceObjectKey: source.key,
      digest: source.digest,
      fileCount: 4,
    });
    expect(recordedReceipt().matchId).toBe("NA1_5370969615");
  });
});

describe("the receipt wrapper and the durable bridge", () => {
  test("refuse to record one fact from inside the other", async () => {
    const match = await loadRawMatchFixture();
    const before = await recordsFor("lake-staging", "applied");
    const facts: DurableFacts = { db: prisma, now: () => new Date() };
    let refusal: unknown;

    await recordDurableWrite(facts, "observation", async () => {
      try {
        await stageMatchReceipted(lakeDir, match, {
          source: artifactDescriptorFixture("match"),
        });
      } catch (error) {
        refusal = error;
      }
      return { outcome: "applied" };
    });

    // Both wrappers increment scout_durable_dualwrite_records_total, so a
    // receipt recorded inside a durable write would report one projection as
    // two recorded facts. The connector keeps them sequential; this is what
    // makes a future nesting fail instead of silently inflating the counter.
    expect(String(refusal)).toContain("double-count");
    expect(await recordsFor("lake-staging", "applied")).toBe(before);
  });
});

describe("receipted prematch staging", () => {
  test("keys the receipt by the match id the snapshot will belong to", async () => {
    const gameInfo = rawCurrentGameInfoFixture();
    const source = artifactDescriptorFixture("prematch");

    const result = await stagePrematchReceipted(
      lakeDir,
      gameInfo,
      new Date("2026-09-12T00:00:00.000Z"),
      { source },
    );

    expect(result.receipt).toBe("recorded");
    expect(recordedReceipt().matchId).toBe("NA1_5500000001");
    expect(parsedEvidence()).toEqual({
      objectKind: "prematch",
      sourceObjectKey: source.key,
      digest: source.digest,
      fileCount: 1,
    });
  });
});
