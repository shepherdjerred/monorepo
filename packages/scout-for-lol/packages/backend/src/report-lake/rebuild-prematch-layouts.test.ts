import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
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

/** Only the fields this file asserts on; the row's full shape is pinned elsewhere. */
const PrematchRowSchema = z.looseObject({ observed_at: z.string() });

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

function seedPrematches(
  objects: { key: string; body: string; lastModified?: string }[],
): void {
  s3Mock.reset();
  s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
    Contents: objects.map((object) => ({
      Key: object.key,
      LastModified: new Date(object.lastModified ?? "2026-09-16T12:00:00.000Z"),
    })),
  });
  for (const object of objects) {
    s3Mock.on(GetObjectCommand, { Key: object.key }).callsFake(() => ({
      Body: { transformToString: () => Promise.resolve(object.body) },
      $metadata: {},
    }));
  }
}

async function runRebuild(): Promise<{
  foldedIds: Set<string>;
  rows: number;
  observedAts: string[];
}> {
  const file = path.join(tempDir, "prematch.ndjson");
  const writer = new NdjsonFileWriter(file);
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
  const written = await readFile(file, "utf8");
  const observedAts = written
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => PrematchRowSchema.parse(JSON.parse(line)).observed_at);
  return { foldedIds, rows, observedAts };
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

  test("folds one game once when the cutover left it under both spellings", async () => {
    // A game captured before the qualification and RECAPTURED after it has
    // two surviving objects, both valid snapshots of the same game. Replaying
    // both emitted two row sets for one game, and which one a query saw
    // depended on the order S3 listed them in. Newest wins, as it does for the
    // timeline cutover: a recapture exists because the first was superseded.
    const duplicated = gameOn("NA1", 5_500_000_003);
    seedPrematches([
      {
        key: "prematch/2026/08/01/5500000003/spectator-data.json",
        body: JSON.stringify(duplicated),
        lastModified: "2026-08-01T10:00:00.000Z",
      },
      {
        key: "prematch/2026/09/16/NA1_5500000003/spectator-data.json",
        body: JSON.stringify(duplicated),
        lastModified: "2026-09-16T12:00:00.000Z",
      },
    ]);

    const { foldedIds, observedAts } = await runRebuild();

    expect(foldedIds).toEqual(
      new Set([stagingIdForPrematch("NA1:5500000003")]),
    );
    // One row set, and it is the recapture's: every row carries the newer
    // object's LastModified rather than the superseded one's.
    expect(new Set(observedAts)).toEqual(new Set(["2026-09-16 12:00:00.000"]));
  });

  test("resolves the duplicate the same way whichever order S3 lists it", async () => {
    // The property the finding is about. Listing order is not something a
    // rebuild may depend on, so the reversed listing must produce the same
    // lake as the forward one.
    const duplicated = gameOn("NA1", 5_500_000_004);
    const older = {
      key: "prematch/2026/08/01/5500000004/spectator-data.json",
      body: JSON.stringify(duplicated),
      lastModified: "2026-08-01T10:00:00.000Z",
    };
    const newer = {
      key: "prematch/2026/09/16/NA1_5500000004/spectator-data.json",
      body: JSON.stringify(duplicated),
      lastModified: "2026-09-16T12:00:00.000Z",
    };

    seedPrematches([older, newer]);
    const forward = await runRebuild();
    seedPrematches([newer, older]);
    const reversed = await runRebuild();

    expect(reversed.rows).toBe(forward.rows);
    expect(new Set(reversed.observedAts)).toEqual(new Set(forward.observedAts));
    expect(new Set(forward.observedAts)).toEqual(
      new Set(["2026-09-16 12:00:00.000"]),
    );
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
