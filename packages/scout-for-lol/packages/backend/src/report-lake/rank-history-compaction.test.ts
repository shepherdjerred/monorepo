import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  close: vi.fn(),
  populate: vi.fn(),
  write: vi.fn(),
  duckDb: vi.fn(),
}));

vi.mock("#src/configuration.ts", () => ({
  default: { s3BucketName: "scout-test" },
}));
vi.mock("#src/report-lake/ndjson-writer.ts", () => ({
  NdjsonFileWriter: class {
    rows = 1;
    write = mocks.write;
    close = mocks.close;
    abort = mocks.abort;
  },
}));
vi.mock("#src/report-lake/rebuild-sources.ts", () => ({
  populateCompetitionRankHistoryFromS3: mocks.populate,
}));
vi.mock("#src/reports/duckdb/instance.ts", () => ({
  withDuckDBConnection: mocks.duckDb,
}));
vi.mock("#src/storage/s3-client.ts", () => ({ createS3Client: () => ({}) }));

const { writeCompetitionRankHistoryParquet } =
  await import("#src/report-lake/rank-history-compaction.ts");

let buildDir: string | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (buildDir !== undefined) {
    await rm(buildDir, { recursive: true, force: true });
    buildDir = undefined;
  }
});

describe("writeCompetitionRankHistoryParquet", () => {
  test("aborts the writer and removes its temp file when canceled during population", async () => {
    buildDir = await mkdtemp(path.join(tmpdir(), "rank-history-compaction-"));
    const controller = new AbortController();
    mocks.populate.mockImplementation(
      async ({
        abortSignal,
        writer,
      }: {
        abortSignal?: AbortSignal;
        writer: { write: (row: object) => Promise<void> };
      }) => {
        await writer.write({ id: "snapshot" });
        controller.abort(new Error("attempt canceled"));
        abortSignal?.throwIfAborted();
        return 0;
      },
    );

    await expect(
      writeCompetitionRankHistoryParquet({
        buildDir,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow("attempt canceled");
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.duckDb).not.toHaveBeenCalled();
    expect(await readdir(buildDir)).toEqual([]);
  });
});
