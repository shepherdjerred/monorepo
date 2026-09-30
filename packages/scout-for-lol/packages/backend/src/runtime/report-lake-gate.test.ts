/**
 * The lake boot gate, in both directions, against real directories.
 *
 * The gate had no test at all, which matters more than usual here: it is the
 * only thing standing between a worker pod with an unmounted volume and an
 * hour of report runs, parlay generations and dare settlements that each
 * "succeed" while finding nothing. Nothing below stubs `readCurrentBuildDir` —
 * the publish protocol it reads (a `CURRENT` pointer naming a non-empty build
 * directory) is exactly what a mounted volume does or does not have.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  buildDirPath,
  ensureLakeScaffold,
  newBuildId,
  publishBuild,
} from "#src/report-lake/paths.ts";
import { assertPublishedReportLake } from "#src/runtime/report-lake-gate.ts";

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function emptyLake(): Promise<string> {
  const lakeDir = await tempDir("scout-lake-gate-");
  await ensureLakeScaffold(lakeDir);
  return lakeDir;
}

/** A lake with one published build, written through the real publish path. */
async function publishedLake(): Promise<string> {
  const lakeDir = await emptyLake();
  const buildId = newBuildId();
  const dir = buildDirPath(lakeDir, buildId);
  await mkdir(dir, { recursive: true });
  await Bun.write(path.join(dir, "manifest.json"), "{}");
  await publishBuild(lakeDir, buildId);
  return lakeDir;
}

afterAll(async () => {
  for (const root of roots) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("assertPublishedReportLake", () => {
  test("refuses to continue when the lake holds no published build", async () => {
    const lakeDir = await emptyLake();
    await expect(assertPublishedReportLake({ lakeDir })).rejects.toThrow(
      "no published build",
    );
  });

  test("refuses a directory that was never a lake at all", async () => {
    // The unmounted-volume case: the path exists because the container created
    // it, and holds nothing.
    const lakeDir = await tempDir("scout-lake-gate-bare-");
    await expect(assertPublishedReportLake({ lakeDir })).rejects.toThrow(
      "no published build",
    );
  });

  test("the refusal names the directory, so the fix is the mount", async () => {
    const lakeDir = await emptyLake();
    await expect(assertPublishedReportLake({ lakeDir })).rejects.toThrow(
      lakeDir,
    );
  });

  test("passes once a build has been published", async () => {
    const lakeDir = await publishedLake();
    await expect(
      assertPublishedReportLake({ lakeDir }),
    ).resolves.toBeUndefined();
  });
});

describe("the dev fold-skip policy", () => {
  test("warns instead of refusing when the fold was skipped", async () => {
    // `SCOUT_DEV_SKIP_REPORT_LAKE_FOLD` is dev-only (configuration.ts refuses
    // it anywhere else) and exists so a laptop with no S3 bucket can boot. It
    // used to skip this check entirely and in silence; the absence is now
    // still said out loud.
    const lakeDir = await emptyLake();
    await expect(
      assertPublishedReportLake({ lakeDir, onUnpublished: "warn" }),
    ).resolves.toBeUndefined();
  });

  test("a published build is verified under the dev policy as well", async () => {
    const lakeDir = await publishedLake();
    await expect(
      assertPublishedReportLake({ lakeDir, onUnpublished: "warn" }),
    ).resolves.toBeUndefined();
  });

  test("a CORRUPT lake still fails loudly under the dev policy", async () => {
    // Absence is negotiable in dev; corruption is not. A CURRENT pointer
    // naming a build that is gone is a broken internal contract, and the dev
    // flag is not a licence to serve from one.
    const lakeDir = await emptyLake();
    await publishBuild(lakeDir, "a-build-that-was-never-written");
    await expect(
      assertPublishedReportLake({ lakeDir, onUnpublished: "warn" }),
    ).rejects.toThrow();
  });

  test("an empty CURRENT pointer fails under the dev policy too", async () => {
    const lakeDir = await emptyLake();
    await Bun.write(path.join(lakeDir, "CURRENT"), "   \n");
    await expect(
      assertPublishedReportLake({ lakeDir, onUnpublished: "warn" }),
    ).rejects.toThrow("CURRENT pointer");
  });
});
