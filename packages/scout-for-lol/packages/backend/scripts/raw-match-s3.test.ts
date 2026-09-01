import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

import { createRawMatchS3Source, rawMatchS3Region } from "./raw-match-s3.ts";

const s3Mock = mockClient(S3Client);
const ORIGINAL_AWS_REGION = Bun.env["AWS_REGION"];
const ORIGINAL_S3_REGION = Bun.env["S3_REGION"];
const FIXTURE_URL = new URL(
  "../src/league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
  import.meta.url,
);

function setEnvironment(name: string, value: string | undefined): boolean {
  return value === undefined
    ? Reflect.deleteProperty(Bun.env, name)
    : Reflect.set(Bun.env, name, value);
}

function createSource() {
  return createRawMatchS3Source({
    bucket: "test-bucket",
    startDate: "2026-07-10",
    endDate: "2026-07-10",
  });
}

function mockBody(content: string) {
  return {
    Body: { transformToString: () => Promise.resolve(content) },
    $metadata: {},
  };
}

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
  setEnvironment("AWS_REGION", ORIGINAL_AWS_REGION);
  setEnvironment("S3_REGION", ORIGINAL_S3_REGION);
});

describe("rawMatchS3Region", () => {
  test("prefers a trimmed AWS_REGION over S3_REGION", () => {
    Bun.env["AWS_REGION"] = " us-west-2 ";
    Bun.env["S3_REGION"] = "us-east-1";

    expect(rawMatchS3Region()).toBe("us-west-2");
  });

  test("uses a trimmed S3_REGION when AWS_REGION is unset", () => {
    setEnvironment("AWS_REGION", undefined);
    Bun.env["S3_REGION"] = " eu-west-1 ";

    expect(rawMatchS3Region()).toBe("eu-west-1");
  });

  test("defaults to us-east-1 when neither region is configured", () => {
    setEnvironment("AWS_REGION", undefined);
    setEnvironment("S3_REGION", undefined);

    expect(rawMatchS3Region()).toBe("us-east-1");
  });
});

describe("createRawMatchS3Source", () => {
  test("lists paginated match keys and filters unrelated objects", async () => {
    const prefix = "games/2026/07/10/";
    s3Mock
      .on(ListObjectsV2Command, { Bucket: "test-bucket", Prefix: prefix })
      .resolves({
        Contents: [
          { Key: `${prefix}first/match.json` },
          { Key: `${prefix}first/metadata.json` },
        ],
        NextContinuationToken: "second-page",
      })
      .on(ListObjectsV2Command, {
        Bucket: "test-bucket",
        Prefix: prefix,
        ContinuationToken: "second-page",
      })
      .resolves({ Contents: [{ Key: `${prefix}second/match.json` }] });

    await expect(createSource().listMatchKeys()).resolves.toEqual([
      `${prefix}first/match.json`,
      `${prefix}second/match.json`,
    ]);
  });

  test("rejects an inverted date range before listing S3", async () => {
    const source = createRawMatchS3Source({
      bucket: "test-bucket",
      startDate: "2026-07-11",
      endDate: "2026-07-10",
    });

    await expect(source.listMatchKeys()).rejects.toThrow(
      "startDate 2026-07-11 is after endDate 2026-07-10",
    );
  });

  test("fails loudly when a match object has no body", async () => {
    s3Mock.on(GetObjectCommand).callsFake(() => ({ $metadata: {} }));

    await expect(
      createSource().fetchMatch("games/missing/match.json"),
    ).rejects.toThrow("S3 object games/missing/match.json has no body");
  });

  test("rejects malformed JSON and values outside the RawMatch contract", async () => {
    for (const content of ["not JSON", "{}"]) {
      s3Mock.reset();
      s3Mock.on(GetObjectCommand).callsFake(() => mockBody(content));

      await expect(
        createSource().fetchMatch("games/invalid/match.json"),
      ).rejects.toThrow();
    }
  });

  test("visits each fetched match sequentially", async () => {
    const prefix = "games/2026/07/10/";
    const firstKey = `${prefix}first/match.json`;
    const secondKey = `${prefix}second/match.json`;
    const fixture = await Bun.file(FIXTURE_URL).text();
    let firstVisitorFinished = false;
    let visits = 0;

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: firstKey }, { Key: secondKey }],
    });
    s3Mock
      .on(GetObjectCommand, { Key: firstKey })
      .callsFake(() => mockBody(fixture));
    s3Mock.on(GetObjectCommand, { Key: secondKey }).callsFake(() => {
      expect(firstVisitorFinished).toBe(true);
      return mockBody(fixture);
    });

    await createSource().visitMatches(async () => {
      visits += 1;
      await Promise.resolve();
      if (visits === 1) {
        firstVisitorFinished = true;
      }
    });

    expect(visits).toBe(2);
  });
});
