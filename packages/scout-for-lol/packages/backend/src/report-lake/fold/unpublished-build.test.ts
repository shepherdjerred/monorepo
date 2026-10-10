import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { withUnpublishedBuildCleanup } from "./unpublished-build.ts";

test("removes a build directory when fold work is canceled before publish", async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "lake-fold-cancel-"));
  const buildDir = path.join(lakeDir, "builds", "unpublished");
  try {
    await mkdir(buildDir, { recursive: true });
    await expect(
      withUnpublishedBuildCleanup(buildDir, async () => {
        await writeFile(path.join(buildDir, "partial.parquet"), "partial");
        throw new Error("fold canceled");
      }),
    ).rejects.toThrow("fold canceled");
    await expect(rm(buildDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});

test("keeps a build directory after its pointer has been published", async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "lake-fold-published-"));
  const buildDir = path.join(lakeDir, "builds", "published");
  try {
    await mkdir(buildDir, { recursive: true });
    await withUnpublishedBuildCleanup(buildDir, async (markPublished) => {
      await writeFile(path.join(buildDir, "manifest.json"), "{}");
      markPublished();
    });
    expect(await Bun.file(path.join(buildDir, "manifest.json")).exists()).toBe(
      true,
    );
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});
