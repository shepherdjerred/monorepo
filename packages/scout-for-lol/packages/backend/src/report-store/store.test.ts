import { expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const saveMatchToS3 = vi.fn(() => Promise.resolve("skipped_no_bucket"));
const writeMatchStagingFile = vi.fn(() => Promise.resolve(true));

vi.doMock("#src/storage/s3.ts", () => ({ saveMatchToS3 }));
vi.doMock("#src/report-lake/paths.ts", () => ({
  resolveLakeDir: () => "/test/report-lake",
}));
vi.doMock("#src/report-lake/staging.ts", () => ({ writeMatchStagingFile }));

const { ingestMatch } = await import("#src/report-store/store.ts");
const match = RawMatchSchema.parse(
  await Bun.file(
    new URL(
      "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370986469.json",
      import.meta.url,
    ),
  ).json(),
);

test("preserves local staging while reporting unavailable S3 storage", async () => {
  await expect(ingestMatch(match, [])).resolves.toEqual({
    staged: true,
    stored: false,
  });
  expect(saveMatchToS3).toHaveBeenCalledOnce();
  expect(writeMatchStagingFile).toHaveBeenCalledOnce();
});
