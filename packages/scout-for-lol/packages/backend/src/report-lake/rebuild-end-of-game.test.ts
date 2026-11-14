import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { populateMatchesFromS3 } from "#src/report-lake/rebuild-sources.ts";
import { stagingIdForMatch } from "#src/report-lake/staging.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

/**
 * A rebuild reads every stored match document from S3. An end-of-game record
 * sits under the same `games/` prefix as a Match-V5 one, so the rebuild must
 * fold it, not skip it as a document that failed validation.
 */

const s3Mock = mockClient(S3Client);
const MatchRowSchema = z.looseObject({
  coverage: z.string(),
  participant_id: z.null(),
});

let tempDir: string;
function file(name: string): string {
  return path.join(tempDir, `${name}.ndjson`);
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rebuild-end-of-game-"));
});
afterEach(async () => {
  s3Mock.reset();
  await rm(tempDir, { recursive: true, force: true });
});

test("a rebuild folds an end-of-game record with its coverage", async () => {
  const record = await classicEndOfGameMatch();
  const key = `games/2026/10/18/${record.metadata.matchId}/match.json`;
  s3Mock.on(ListObjectsV2Command, { Prefix: "games/" }).resolves({
    Contents: [{ Key: key, LastModified: new Date("2026-10-18T12:00:00Z") }],
  });
  s3Mock.on(GetObjectCommand, { Key: key }).callsFake(() => ({
    Body: { transformToString: () => Promise.resolve(JSON.stringify(record)) },
    $metadata: {},
  }));
  const writer = new NdjsonFileWriter(file("matches"));
  const teamWriter = new NdjsonFileWriter(file("teams"));
  const teamBanWriter = new NdjsonFileWriter(file("bans"));
  const foldedIds = new Set<string>();

  const skipped = await populateMatchesFromS3({
    client: new S3Client({}),
    bucket: "test-bucket",
    writer,
    teamWriter,
    teamBanWriter,
    foldedIds,
  });
  const counts = [writer.rows, teamWriter.rows, teamBanWriter.rows];
  await Promise.all([
    writer.close(),
    teamWriter.close(),
    teamBanWriter.close(),
  ]);

  expect(skipped).toBe(0);
  expect(foldedIds).toEqual(
    new Set([stagingIdForMatch(record.metadata.matchId)]),
  );
  expect(counts).toEqual([10, 2, 0]);
  const written = await readFile(file("matches"), "utf8");
  const rows = written
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => MatchRowSchema.parse(JSON.parse(line)));
  expect(rows.every((row) => row.coverage === "end_of_game")).toBe(true);
});
