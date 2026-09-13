import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { MATCHES_STAGING_DIR } from "#src/report-lake/paths.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import {
  getValidatedPutCommand,
  mockSuccessfulPut,
  resetS3TestState,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

const mocks = vi.hoisted(() => ({ recordReceipt: vi.fn() }));

// The object store runs for real against a mocked S3 client, because the
// descriptor this suite is about is built from what the put actually stored.
// Only the receipt repository is stubbed; the durable table's own behaviour
// belongs to the repository suites.
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  recordReceipt: mocks.recordReceipt,
}));

const { ingestMatch } = await import("#src/report-store/store.ts");

let lakeDir: string;

/**
 * Read back what this ingest claimed, without the row codec: the architecture
 * rules keep `report-store/` out of `database/`, and the codec's own contract
 * is covered where the receipted doors are tested.
 */
const RecordedReceiptSchema = z.object({
  receipt: z.object({ kind: z.string() }),
});

function receiptKinds(): string[] {
  return mocks.recordReceipt.mock.calls.map(
    (call) => RecordedReceiptSchema.parse(call[1]).receipt.kind,
  );
}

beforeEach(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "report-store-ingest-"));
  Bun.env["REPORT_LAKE_DIR"] = lakeDir;
  resetS3TestState();
  mocks.recordReceipt.mockReset();
  mocks.recordReceipt.mockResolvedValue({ outcome: "applied" });
});

afterEach(async () => {
  resetS3TestState();
  await rm(lakeDir, { recursive: true, force: true });
});

describe("match ingest", () => {
  test("returns the descriptor of the object the archive actually wrote", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    const result = await ingestMatch(match, []);

    expect(result).toMatchObject({ staged: true, stored: true });
    // The identity comes from the put itself — the key it used and the digest
    // it stored as object metadata — so the bridge above can stamp the
    // observation with evidence rather than a reconstructed key.
    const put = getValidatedPutCommand();
    expect(result.artifact?.key).toBe(put.input.Key);
    expect(result.artifact?.digest).toBe(put.input.Metadata?.["sha256"]);
  });

  test("records the archive and the lake projection as two receipts", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();

    await ingestMatch(match, []);

    expect(receiptKinds()).toEqual(["raw-archive-match", "lake-staging-match"]);
  });

  test("reports a failed staging write without throwing, and receipts nothing for it", async () => {
    const match = await loadRawMatchFixture();
    mockSuccessfulPut();
    // Occupy the staging directory's path with a plain file so the scaffold's
    // mkdir fails: the real way staging returns false, not a stubbed one.
    await Bun.write(path.join(lakeDir, MATCHES_STAGING_DIR), "not a directory");

    const result = await ingestMatch(match, []);

    // A false match staging result is what blocks cursor advancement upstream,
    // so the receipted door's throw must never reach this caller.
    expect(result).toMatchObject({ staged: false, stored: true });
    expect(receiptKinds()).toEqual(["raw-archive-match"]);
  });

  test("preserves local staging while reporting unavailable S3 storage", async () => {
    const match = await loadRawMatchFixture();
    setS3TestBucket(undefined);
    mockSuccessfulPut();

    const result = await ingestMatch(match, []);

    expect(result).toEqual({ staged: true, stored: false });
    // Nothing was archived, so there is no source object a staging receipt
    // could name and no archive to attest to.
    expect(mocks.recordReceipt).not.toHaveBeenCalled();
  });
});
