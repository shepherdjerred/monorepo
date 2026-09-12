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
import { z } from "zod";
import { RawTimelineSchema, type RawTimeline } from "@scout-for-lol/data";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { populateTimelinesFromS3 } from "#src/report-lake/rebuild-sources.ts";

/**
 * The timeline partition cutover (2026-09-12) left two layouts in the bucket:
 * objects written before it sit under their UPLOAD day, objects written after
 * sit under the match's gameCreation day. This pins the property that makes the
 * rebuild indifferent to which one it meets — it enumerates the whole `games/`
 * prefix and takes match identity from the payload, never from the key.
 */

const s3Mock = mockClient(S3Client);

// Same match, same payload, filed under two different days. Under the OLD
// layout this object was keyed by the day it was fetched; under the NEW one it
// is keyed by the day the game was created.
const OLD_LAYOUT_KEY = "games/2026/08/01/NA1_1111111111/timeline.json";
const NEW_LAYOUT_KEY = "games/2026/09/12/NA1_2222222222/timeline.json";

let tempDir: string;

function timelineFixture(matchId: string, gameId: number): RawTimeline {
  return RawTimelineSchema.parse({
    metadata: { dataVersion: "2", matchId, participants: ["puuid-1"] },
    info: {
      frameInterval: 60_000,
      gameId,
      participants: [{ participantId: 1, puuid: "puuid-1" }],
      frames: [
        {
          timestamp: 0,
          events: [{ type: "PAUSE_END", timestamp: 0 }],
          participantFrames: {},
        },
      ],
    },
  });
}

function seedTimelines(
  objects: { key: string; body: string; lastModified?: Date }[],
): void {
  s3Mock.reset();
  s3Mock.on(ListObjectsV2Command, { Prefix: "games/" }).resolves({
    Contents: objects.map((object) => ({
      Key: object.key,
      ...(object.lastModified === undefined
        ? {}
        : { LastModified: object.lastModified }),
    })),
  });
  for (const object of objects) {
    s3Mock.on(GetObjectCommand, { Key: object.key }).callsFake(() => ({
      Body: { transformToString: () => Promise.resolve(object.body) },
      $metadata: {},
    }));
  }
}

const CoverageRowSchema = z.object({
  match_id: z.string(),
  frame_interval_ms: z.number(),
});

async function runRebuild(): Promise<{
  foldedIds: Set<string>;
  coverageRows: number;
  coverage: z.infer<typeof CoverageRowSchema>[];
}> {
  const writers = {
    events: new NdjsonFileWriter(path.join(tempDir, "events.ndjson")),
    eventParticipants: new NdjsonFileWriter(
      path.join(tempDir, "event-participants.ndjson"),
    ),
    participantFrames: new NdjsonFileWriter(
      path.join(tempDir, "participant-frames.ndjson"),
    ),
    coverage: new NdjsonFileWriter(path.join(tempDir, "coverage.ndjson")),
  };
  const foldedIds = new Set<string>();
  await populateTimelinesFromS3({
    client: new S3Client({}),
    bucket: "test-bucket",
    writers,
    foldedIds,
  });
  const coverageRows = writers.coverage.rows;
  await Promise.all([
    writers.events.close(),
    writers.eventParticipants.close(),
    writers.participantFrames.close(),
    writers.coverage.close(),
  ]);
  const coverageText = await Bun.file(writers.coverage.filePath).text();
  const coverage = coverageText
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line))
    .map((row) => CoverageRowSchema.parse(row));
  return { foldedIds, coverageRows, coverage };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rebuild-timeline-layouts-"));
});

afterEach(async () => {
  s3Mock.reset();
  await rm(tempDir, { recursive: true, force: true });
});

describe("timeline rebuild across both partition layouts", () => {
  test("reads timelines filed under the old upload-date prefix", async () => {
    seedTimelines([
      {
        key: OLD_LAYOUT_KEY,
        body: JSON.stringify(timelineFixture("NA1_1111111111", 1_111_111_111)),
      },
    ]);

    const { foldedIds } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_1111111111"]);
  });

  test("reads timelines filed under the new game-date prefix", async () => {
    seedTimelines([
      {
        key: NEW_LAYOUT_KEY,
        body: JSON.stringify(timelineFixture("NA1_2222222222", 2_222_222_222)),
      },
    ]);

    const { foldedIds } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_2222222222"]);
  });

  test("reads both layouts in one pass", async () => {
    seedTimelines([
      {
        key: OLD_LAYOUT_KEY,
        body: JSON.stringify(timelineFixture("NA1_1111111111", 1_111_111_111)),
      },
      {
        key: NEW_LAYOUT_KEY,
        body: JSON.stringify(timelineFixture("NA1_2222222222", 2_222_222_222)),
      },
    ]);

    const { foldedIds, coverageRows } = await runRebuild();

    expect([...foldedIds].toSorted()).toEqual([
      "NA1_1111111111",
      "NA1_2222222222",
    ]);
    expect(coverageRows).toBe(2);
  });

  test("takes match identity from the payload, not the key's date", async () => {
    // A payload deliberately filed under a date prefix that has nothing to do
    // with its match: the rebuild must still fold it under its real match id.
    seedTimelines([
      {
        key: "games/1999/12/31/NA1_9999999999/timeline.json",
        body: JSON.stringify(timelineFixture("NA1_2222222222", 2_222_222_222)),
      },
    ]);

    const { foldedIds } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_2222222222"]);
  });

  test("keeps only the newest object when one match survives in both layouts", async () => {
    // The cutover's real hazard: a timeline written pre-cutover under its
    // upload day, then retried post-cutover under its game day. Both parse, so
    // replaying both would emit two sets of rows for one match.
    const body = JSON.stringify(
      timelineFixture("NA1_3333333333", 3_333_333_333),
    );
    seedTimelines([
      {
        key: "games/2026/08/01/NA1_3333333333/timeline.json",
        body,
        lastModified: new Date("2026-08-01T10:00:00.000Z"),
      },
      {
        key: "games/2026/09/12/NA1_3333333333/timeline.json",
        body,
        lastModified: new Date("2026-09-12T10:00:00.000Z"),
      },
    ]);

    const { foldedIds, coverageRows } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_3333333333"]);
    expect(coverageRows).toBe(1);
  });

  test("the newer object wins, whichever layout it happens to sit in", async () => {
    // Same pair, recency reversed: the OLD-layout object is the newer write, so
    // it must win. The tie-break is LastModified, never the layout and never
    // the listing order.
    const newer = timelineFixture("NA1_4444444444", 4_444_444_444);
    newer.info.frameInterval = 15_000;
    const older = timelineFixture("NA1_4444444444", 4_444_444_444);
    older.info.frameInterval = 60_000;
    seedTimelines([
      {
        key: "games/2026/08/01/NA1_4444444444/timeline.json",
        body: JSON.stringify(newer),
        lastModified: new Date("2026-09-20T10:00:00.000Z"),
      },
      {
        key: "games/2026/09/12/NA1_4444444444/timeline.json",
        body: JSON.stringify(older),
        lastModified: new Date("2026-09-12T10:00:00.000Z"),
      },
    ]);

    const { coverageRows, coverage } = await runRebuild();

    expect(coverageRows).toBe(1);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.frame_interval_ms).toBe(15_000);
  });

  test("dedupes on the payload's match id even when the keys disagree", async () => {
    // Two objects under different key match ids that both parse to the same
    // match. Key-level grouping cannot catch this, so the payload guard must.
    const body = JSON.stringify(
      timelineFixture("NA1_2222222222", 2_222_222_222),
    );
    seedTimelines([
      {
        key: "games/1999/12/31/NA1_9999999999/timeline.json",
        body,
        lastModified: new Date("2026-08-01T10:00:00.000Z"),
      },
      {
        key: NEW_LAYOUT_KEY,
        body,
        lastModified: new Date("2026-09-12T10:00:00.000Z"),
      },
    ]);

    const { foldedIds, coverageRows } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_2222222222"]);
    expect(coverageRows).toBe(1);
  });

  test("falls back to the key's date only when S3 omits LastModified", async () => {
    seedTimelines([
      {
        key: NEW_LAYOUT_KEY,
        body: JSON.stringify(timelineFixture("NA1_2222222222", 2_222_222_222)),
        lastModified: new Date("2026-09-13T08:00:00.000Z"),
      },
    ]);

    const { foldedIds } = await runRebuild();

    expect([...foldedIds]).toEqual(["NA1_2222222222"]);
  });
});
