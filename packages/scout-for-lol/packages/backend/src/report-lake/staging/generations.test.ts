import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  commitStagingGeneration,
  generationFile,
  projectionKey,
  reclaimAbandonedPendingGenerations,
  removeFoldedGenerations,
  removeRebuiltGenerations,
  s3StagingSourceKey,
  snapshotStagingGenerations,
} from "#src/report-lake/staging/generations.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";
import { withLakeQueryRetry } from "#src/reports/duckdb/lake.ts";

const dirs: string[] = [];

function matchFiles(label: string) {
  return [
    { table: "matches" as const, content: `${label} match\n` },
    { table: "match_teams" as const, content: `${label} team\n` },
    { table: "match_team_bans" as const, content: `${label} ban\n` },
  ];
}

async function lakeDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "scout-staging-generations-"),
  );
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

test("a match generation appears with all three tables after commit", async () => {
  const dir = await lakeDir();
  const generation = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "match",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    source: { kind: "s3", key: "games/NA1_42/match.json", digest: "abc" },
    files: [
      { table: "matches", content: '{"id":1}\n' },
      { table: "match_teams", content: "\n" },
      { table: "match_team_bans", content: "\n" },
    ],
  });
  const snapshot = await snapshotStagingGenerations(dir);
  expect(snapshot.selected).toHaveLength(1);
  expect(await listStagingFiles(dir, "matches", snapshot)).toEqual([
    generationFile(generation, "matches"),
  ]);
  expect(await listStagingFiles(dir, "match_teams", snapshot)).toEqual([
    generationFile(generation, "match_teams"),
  ]);
  expect(await listStagingFiles(dir, "match_team_bans", snapshot)).toEqual([
    generationFile(generation, "match_team_bans"),
  ]);
  expect(await readdir(path.join(dir, ".staging-generations-pending"))).toEqual(
    [],
  );
});

test("a multi-table projection cannot commit only one relation", async () => {
  const dir = await lakeDir();
  await expect(
    commitStagingGeneration({
      lakeDir: dir,
      projectionKind: "match",
      naturalId: "NA1_42",
      observedAt: new Date("2026-09-30T00:00:00Z"),
      files: [{ table: "matches", content: "\n" }],
    }),
  ).rejects.toThrow();
  const snapshot = await snapshotStagingGenerations(dir);
  expect(snapshot.selected).toEqual([]);
});

test("compaction reclaims old pending writes and leaves recent writers alone", async () => {
  const dir = await lakeDir();
  const pending = path.join(dir, ".staging-generations-pending");
  const old = path.join(pending, "old");
  const recent = path.join(pending, "recent");
  await mkdir(pending, { recursive: true });
  await Promise.all([mkdir(old), mkdir(recent)]);
  const oldFile = path.join(old, "matches.jsonl");
  const recentFile = path.join(recent, "matches.jsonl");
  await Promise.all([
    Bun.write(oldFile, "old\n"),
    Bun.write(recentFile, "recent\n"),
  ]);
  const oldTime = new Date("2026-09-28T00:00:00Z");
  const recentTime = new Date("2026-09-30T00:00:00Z");
  await Promise.all([
    utimes(oldFile, oldTime, oldTime),
    utimes(old, oldTime, oldTime),
    utimes(recentFile, recentTime, recentTime),
    utimes(recent, recentTime, recentTime),
  ]);
  expect(
    await reclaimAbandonedPendingGenerations(
      dir,
      new Date("2026-09-30T01:00:00Z").getTime(),
    ),
  ).toBe(1);
  expect(await readdir(pending)).toEqual(["recent"]);
});

test("all relations select the same newest generation", async () => {
  const dir = await lakeDir();
  await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "match",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    files: matchFiles("old"),
  });
  const newest = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "match",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:01:00Z"),
    files: matchFiles("new"),
  });
  const snapshot = await snapshotStagingGenerations(dir);
  expect(snapshot.selected.map((item) => item.generationId)).toEqual([
    newest.generationId,
  ]);
  for (const table of newest.tables) {
    expect(await listStagingFiles(dir, table, snapshot)).toEqual([
      generationFile(newest, table),
    ]);
  }
});

test("fold removes only captured generations and keeps a later commit", async () => {
  const dir = await lakeDir();
  const first = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "prematch",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    files: [{ table: "prematch", content: "\n" }],
  });
  const snapshot = await snapshotStagingGenerations(dir);
  const second = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "prematch",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:01:00Z"),
    files: [{ table: "prematch", content: "\n" }],
  });
  expect(
    await removeFoldedGenerations(
      snapshot,
      new Set([projectionKey("prematch", "NA1_42")]),
    ),
  ).toBe(1);
  expect(await Bun.file(generationFile(first, "prematch")).exists()).toBe(
    false,
  );
  expect(await Bun.file(generationFile(second, "prematch")).exists()).toBe(
    true,
  );
  const remaining = await snapshotStagingGenerations(dir);
  expect(remaining.selected.map((item) => item.generationId)).toEqual([
    second.generationId,
  ]);
});

test("rebuild cleanup requires the exact source object and digest", async () => {
  const dir = await lakeDir();
  const generation = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "timeline",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    source: {
      kind: "s3",
      key: "games/NA1_42/timeline.json",
      digest: "original",
    },
    files: [
      { table: "timeline_events", content: "\n" },
      { table: "timeline_event_participants", content: "\n" },
      { table: "timeline_participant_frames", content: "\n" },
      { table: "timeline_coverage", content: "\n" },
    ],
  });
  const snapshot = await snapshotStagingGenerations(dir);
  expect(
    await removeRebuiltGenerations(
      snapshot,
      new Set([s3StagingSourceKey("games/NA1_42/timeline.json", "other")]),
    ),
  ).toBe(0);
  expect(
    await Bun.file(generationFile(generation, "timeline_coverage")).exists(),
  ).toBe(true);
  expect(
    await removeRebuiltGenerations(
      snapshot,
      new Set([s3StagingSourceKey("games/NA1_42/timeline.json", "original")]),
    ),
  ).toBe(1);
});

test("rebuild cleanup retires captured siblings only after rebuilding the selected source", async () => {
  const dir = await lakeDir();
  const options = {
    lakeDir: dir,
    projectionKind: "prematch" as const,
    naturalId: "NA1_42",
    files: [{ table: "prematch" as const, content: "\n" }],
  };
  const older = await commitStagingGeneration({
    ...options,
    observedAt: new Date("2026-09-30T00:00:00Z"),
    source: { kind: "s3", key: "games/NA1_42/prematch.json", digest: "old" },
  });
  const selected = await commitStagingGeneration({
    ...options,
    observedAt: new Date("2026-09-30T00:01:00Z"),
    source: { kind: "s3", key: "games/NA1_42/prematch.json", digest: "new" },
  });
  const snapshot = await snapshotStagingGenerations(dir);
  const later = await commitStagingGeneration({
    ...options,
    observedAt: new Date("2026-09-30T00:02:00Z"),
    source: { kind: "s3", key: "games/NA1_42/prematch.json", digest: "later" },
  });
  expect(
    await removeRebuiltGenerations(
      snapshot,
      new Set([s3StagingSourceKey("games/NA1_42/prematch.json", "new")]),
    ),
  ).toBe(2);
  expect(await Bun.file(generationFile(older, "prematch")).exists()).toBe(
    false,
  );
  expect(await Bun.file(generationFile(selected, "prematch")).exists()).toBe(
    false,
  );
  expect(await Bun.file(generationFile(later, "prematch")).exists()).toBe(true);
});

test("whole query retry resolves a new snapshot after cleanup", async () => {
  const dir = await lakeDir();
  await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "prematch",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    files: [{ table: "prematch", content: "first\n" }],
  });
  const firstSnapshot = await snapshotStagingGenerations(dir);
  let attempts = 0;
  const result = await withLakeQueryRetry(
    dir,
    async (files) => {
      attempts++;
      if (attempts === 1) {
        await commitStagingGeneration({
          lakeDir: dir,
          projectionKind: "prematch",
          naturalId: "NA1_42",
          observedAt: new Date("2026-09-30T00:01:00Z"),
          files: [{ table: "prematch", content: "second\n" }],
        });
        await removeFoldedGenerations(
          firstSnapshot,
          new Set([projectionKey("prematch", "NA1_42")]),
        );
        throw new Error("query file vanished");
      }
      const file = files.prematchStaging[0];
      if (file === undefined) throw new Error("missing prematch source");
      return await Bun.file(file).text();
    },
    { reportLakeAccess: true },
  );
  expect(result).toBe("second\n");
  expect(attempts).toBe(2);
});

test("whole query retry does not mask an unrelated query failure", async () => {
  const dir = await lakeDir();
  let attempts = 0;
  await expect(
    withLakeQueryRetry(
      dir,
      async () => {
        attempts++;
        throw new Error("invalid query");
      },
      { reportLakeAccess: true },
    ),
  ).rejects.toThrow("invalid query");
  expect(attempts).toBe(1);
});

test("exhausted snapshot retries preserve the missing manifest error", async () => {
  const dir = await lakeDir();
  const generation = await commitStagingGeneration({
    lakeDir: dir,
    projectionKind: "prematch",
    naturalId: "NA1_42",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    files: [{ table: "prematch", content: "\n" }],
  });
  await rm(path.join(generation.dir, "manifest.json"));
  await expect(snapshotStagingGenerations(dir)).rejects.toThrow();
  let failure: unknown;
  try {
    await withLakeQueryRetry(dir, async () => 0, { reportLakeAccess: true });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ cause: { code: "ENOENT" } });
});
