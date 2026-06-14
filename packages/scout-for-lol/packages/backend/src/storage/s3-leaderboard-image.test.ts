/**
 * Tests for leaderboard chart PNG archival, using aws-sdk-client-mock.
 * Environment setup (S3_BUCKET_NAME) is handled by test-setup.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  loadLeaderboardImage,
  saveLeaderboardImage,
} from "#src/storage/s3-leaderboard-image.ts";

const s3Mock = mockClient(S3Client);

const PutObjectKeySchema = z.object({
  input: z.object({ Key: z.string(), ContentType: z.string() }),
});

beforeEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

describe("saveLeaderboardImage", () => {
  test("writes both current.png and a dated snapshot.png, returns the current key", async () => {
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    const key = await saveLeaderboardImage(
      99,
      new Date("2026-04-15T12:00:00Z"),
      Buffer.from("png"),
    );

    expect(key).toBe("leaderboards/competition-99/current.png");
    expect(s3Mock.calls().length).toBe(2);
    const keys = [0, 1].map(
      (i) => PutObjectKeySchema.parse(s3Mock.call(i)?.args?.[0]).input.Key,
    );
    expect(keys).toContain("leaderboards/competition-99/current.png");
    expect(keys).toContain(
      "leaderboards/competition-99/snapshots/2026-04-15.png",
    );
    for (const i of [0, 1]) {
      expect(
        PutObjectKeySchema.parse(s3Mock.call(i)?.args?.[0]).input.ContentType,
      ).toBe("image/png");
    }
  });
});

describe("loadLeaderboardImage", () => {
  test("returns null (not an error) when no chart has been cached yet", async () => {
    s3Mock
      .on(GetObjectCommand)
      .rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));

    const result = await loadLeaderboardImage(99);

    expect(result).toBeNull();
  });
});
