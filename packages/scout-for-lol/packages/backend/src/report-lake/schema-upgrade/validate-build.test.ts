import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  columnsForTable,
  writeFoldParquet,
} from "#src/report-lake/fold-parquet.ts";
import {
  STAGING_TABLES,
  snapshotStagingGenerations,
} from "#src/report-lake/staging/generations.ts";
import type { ReportLakeStagingTable } from "#src/report-lake/staging.ts";
import type { ReportLakeLayout } from "#src/report-lake/schema-upgrade/layout.ts";
import { validatePreparedBuild } from "#src/report-lake/schema-upgrade/validate-build.ts";

async function writeTable(
  buildDir: string,
  table: ReportLakeStagingTable,
  layout: ReportLakeLayout,
  overrides: Record<string, unknown> = {},
) {
  // Exercise the physical contract for every relation, independently of Riot
  // fixture coverage (Arena fixtures intentionally omit teams and bans).
  const values = Object.fromEntries(
    Object.entries(columnsForTable(table, layout)).map(([key, type]) => [
      key,
      type === "VARCHAR"
        ? "fixture"
        : type === "TIMESTAMP"
          ? "2026-10-01 00:00:00"
          : type === "BOOLEAN"
            ? true
            : 1,
    ]),
  );
  await writeFoldParquet({
    buildDir,
    buildId: "fixture",
    table,
    layout,
    staged: {
      rowsByMonth: new Map([
        ["2026-10", [{ ...values, month: "2026-10", ...overrides }]],
      ]),
      foldedIds: new Set(),
      rows: 1,
      skipped: 0,
    },
  });
}

test("validates the physical schema and projection keys of every lake relation", async () => {
  const lakeDir = await mkdtemp(
    path.join(tmpdir(), "prepared-lake-all-tables-"),
  );
  try {
    const previousDir = path.join(lakeDir, "builds", "old");
    const buildDir = path.join(lakeDir, "builds", "candidate");
    for (const table of STAGING_TABLES) {
      await writeTable(previousDir, table, "legacy-identity-map");
      await writeTable(buildDir, table, "current");
    }
    await validatePreparedBuild({
      lakeDir,
      previousDir,
      buildDir,
      layout: "current",
      staging: await snapshotStagingGenerations(lakeDir),
      abortSignal: new AbortController().signal,
      timeoutMs: 10_000,
    });
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});

test("validates the Prod pre-data-source layout before publishing current schema", async () => {
  const lakeDir = await mkdtemp(
    path.join(tmpdir(), "prepared-lake-prod-legacy-schema-"),
  );
  try {
    const previousDir = path.join(lakeDir, "builds", "old");
    const buildDir = path.join(lakeDir, "builds", "candidate");
    for (const table of STAGING_TABLES) {
      await writeTable(
        previousDir,
        table,
        "legacy-identity-map-pre-data-source",
      );
      await writeTable(buildDir, table, "current");
    }
    await validatePreparedBuild({
      lakeDir,
      previousDir,
      buildDir,
      layout: "current",
      staging: await snapshotStagingGenerations(lakeDir),
      abortSignal: new AbortController().signal,
      timeoutMs: 10_000,
    });
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});

test("rejects a candidate retaining the retired column despite a current-layout claim", async () => {
  const lakeDir = await mkdtemp(
    path.join(tmpdir(), "prepared-lake-wrong-schema-"),
  );
  try {
    const previousDir = path.join(lakeDir, "builds", "old");
    const buildDir = path.join(lakeDir, "builds", "candidate");
    await writeTable(previousDir, "raw_documents", "legacy-identity-map");
    await writeTable(buildDir, "raw_documents", "legacy-identity-map");
    await expect(
      validatePreparedBuild({
        lakeDir,
        previousDir,
        buildDir,
        layout: "current",
        staging: await snapshotStagingGenerations(lakeDir),
        abortSignal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("physical schema does not match");
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});

test("rejects a nonempty candidate that drops one published participant key", async () => {
  const lakeDir = await mkdtemp(
    path.join(tmpdir(), "prepared-lake-missing-key-"),
  );
  try {
    const previousDir = path.join(lakeDir, "builds", "old");
    const buildDir = path.join(lakeDir, "builds", "candidate");
    await writeTable(previousDir, "matches", "legacy-identity-map");
    await writeTable(buildDir, "matches", "current", { puuid: "different" });
    await expect(
      validatePreparedBuild({
        lakeDir,
        previousDir,
        buildDir,
        layout: "current",
        staging: await snapshotStagingGenerations(lakeDir),
        abortSignal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("lose 1 matches projection keys");
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});
