import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { populatePrematchFromS3 } from "#src/report-lake/rebuild-sources.ts";
import { stagingIdForPrematch } from "#src/report-lake/staging.ts";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";

/**
 * The prematch key qualification left two spellings in the bucket: objects
 * written before it sit under the bare numeric game id, objects written after
 * sit under `{platformId}_{gameId}`. This pins the property that makes the
 * rebuild indifferent to which one it meets — it enumerates the whole
 * `prematch/` prefix and takes a game's identity from the payload, never from
 * the key — and that the two platforms whose numbers collided fold as two
 * games rather than one.
 */

const s3Mock = mockClient(S3Client);

const PRE_QUALIFICATION_KEY =
  "prematch/2026/08/01/5500000001/spectator-data.json";
const QUALIFIED_KEY = "prematch/2026/09/16/NA1_5500000002/spectator-data.json";
// The collision the qualification exists for: the same number on a different
// platform, on the same day, which under the old spelling shared one key.
const COLLIDING_PLATFORM_KEY =
  "prematch/2026/09/16/EUW1_5500000002/spectator-data.json";

let tempDir: string;

function gameOn(platformId: string, gameId: number): RawCurrentGameInfo {
  return { ...rawCurrentGameInfoFixture(), platformId, gameId };
}

function seedPrematches(objects: { key: string; body: string }[]): void {
  s3Mock.reset();
  s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
    Contents: objects.map((object) => ({
      Key: object.key,
      LastModified: new Date("2026-09-16T12:00:00.000Z"),
    })),
  });
  for (const object of objects) {
    s3Mock.on(GetObjectCommand, { Key: object.key }).callsFake(() => ({
      Body: { transformToString: () => Promise.resolve(object.body) },
      $metadata: {},
    }));
  }
}

async function runRebuild(): Promise<{ foldedIds: Set<string>; rows: number }> {
  const writer = new NdjsonFileWriter(path.join(tempDir, "prematch.ndjson"));
  const foldedIds = new Set<string>();
  await populatePrematchFromS3({
    client: new S3Client({}),
    bucket: "test-bucket",
    writer,
    foldedIds,
    puuidRemap: new Map(),
  });
  const rows = writer.rows;
  await writer.close();
  return { foldedIds, rows };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rebuild-prematch-layouts-"));
});

afterEach(async () => {
  s3Mock.reset();
  await rm(tempDir, { recursive: true, force: true });
});

describe("rebuilding prematch rows from both key spellings", () => {
  test("folds objects under the numeric and the platform-qualified spelling alike", async () => {
    seedPrematches([
      {
        key: PRE_QUALIFICATION_KEY,
        body: JSON.stringify(gameOn("NA1", 5_500_000_001)),
      },
      {
        key: QUALIFIED_KEY,
        body: JSON.stringify(gameOn("NA1", 5_500_000_002)),
      },
    ]);

    const { foldedIds, rows } = await runRebuild();

    expect(foldedIds).toEqual(
      new Set([
        stagingIdForPrematch("NA1:5500000001"),
        stagingIdForPrematch("NA1:5500000002"),
      ]),
    );
    expect(rows).toBeGreaterThan(0);
  });

  test("keeps two platforms' games apart when their numbers collide", async () => {
    seedPrematches([
      {
        key: QUALIFIED_KEY,
        body: JSON.stringify(gameOn("NA1", 5_500_000_002)),
      },
      {
        key: COLLIDING_PLATFORM_KEY,
        body: JSON.stringify(gameOn("EUW1", 5_500_000_002)),
      },
    ]);

    const { foldedIds } = await runRebuild();

    // Identity is the payload's platform and game id, so the qualified keys
    // that let both objects exist also let both fold as distinct games.
    expect(foldedIds).toEqual(
      new Set([
        stagingIdForPrematch("NA1:5500000002"),
        stagingIdForPrematch("EUW1:5500000002"),
      ]),
    );
  });
});
