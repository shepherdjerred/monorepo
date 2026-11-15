import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  MATCH_PREFIX,
  PREMATCH_PREFIX,
  classifyRawObjectKey,
  enumerateRawObjects,
} from "#src/report-store/s3-raw-source.ts";
import { CRAWL_OBJECT_PREFIX, crawlSegmentKey } from "./crawl-segment.ts";

/**
 * The crawl's raw segments must stay invisible to every tracked-match reader:
 * the competition scan (`storage/s3-query.ts`), the nightly rebuild's `games/`
 * read (`report-lake/rebuild-sources.ts` through `report-store/s3-raw-source.ts`)
 * and `database/durable/recovery-scan.ts`. Each reader is proven separately.
 */

const SRC = path.resolve(import.meta.dirname, "../..");
const CRAWL_KEY = crawlSegmentKey({
  route: "na1",
  dt: "2026-11-14",
  sha256: "a".repeat(64),
});

async function source(relative: string): Promise<string> {
  return await Bun.file(path.join(SRC, relative)).text();
}

let crawlSources: { name: string; text: string }[] = [];

beforeAll(async () => {
  const names = [
    ...new Bun.Glob("*.ts").scanSync({ cwd: import.meta.dirname }),
  ].filter((name) => !name.endsWith(".test.ts"));
  crawlSources = await Promise.all(
    names.map(async (name) => ({
      name,
      text: await Bun.file(path.join(import.meta.dirname, name)).text(),
    })),
  );
});

/** Serve a bucket holding `keys` over HTTP; ListObjectsV2 honours `prefix` like S3. */
function serveBucket(keys: string[]) {
  return Bun.serve({
    port: 0,
    fetch: (request) => {
      const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
      const contents = keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => `<Contents><Key>${key}</Key></Contents>`)
        .join("");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>bucket</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        { headers: { "content-type": "application/xml" } },
      );
    },
  });
}

function clientFor(server: ReturnType<typeof serveBucket>): S3Client {
  return new S3Client({
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${server.port?.toString() ?? ""}`,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
}

async function listed(client: S3Client, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const object of enumerateRawObjects(client, "bucket", prefix)) {
    keys.push(object.key);
  }
  return keys;
}

describe("crawl storage isolation", () => {
  test("crawl objects live under crawl/v1/, which no tracked prefix covers", () => {
    expect(CRAWL_KEY.startsWith(CRAWL_OBJECT_PREFIX)).toBe(true);
    for (const prefix of [MATCH_PREFIX, PREMATCH_PREFIX, "leaderboards/"]) {
      expect(CRAWL_KEY.startsWith(prefix)).toBe(false);
      expect(prefix.startsWith(CRAWL_OBJECT_PREFIX)).toBe(false);
    }
  });

  test("the nightly rebuild's games/ and prematch/ listings never return a crawl object", async () => {
    const server = serveBucket([
      CRAWL_KEY,
      "games/2026/11/14/NA1_1/match.json",
      "games/2026/11/14/NA1_1/timeline.json",
      "prematch/2026/11/14/x/spectator-data.json",
    ]);
    try {
      const client = clientFor(server);
      expect(await listed(client, MATCH_PREFIX)).toEqual([
        "games/2026/11/14/NA1_1/match.json",
        "games/2026/11/14/NA1_1/timeline.json",
      ]);
      expect(await listed(client, PREMATCH_PREFIX)).toEqual([
        "prematch/2026/11/14/x/spectator-data.json",
      ]);
      // Control: the crawl object is in the bucket and a crawl listing sees it.
      expect(await listed(client, CRAWL_OBJECT_PREFIX)).toEqual([CRAWL_KEY]);
    } finally {
      await server.stop(true);
    }
  });

  test("a crawl object classifies as ignored, never as a match, timeline or prematch", () => {
    expect(classifyRawObjectKey(CRAWL_KEY)).toBe("ignored");
  });

  test("the rebuild reads only through the games/ and prematch/ constants", async () => {
    expect(await source("report-lake/rebuild-sources.ts")).not.toContain(
      "crawl",
    );
    expect(MATCH_PREFIX).toBe("games/");
    expect(PREMATCH_PREFIX).toBe("prematch/");
  });

  test("the competition scan lists only games/YYYY/MM/DD/ prefixes", async () => {
    const query = await source("storage/s3-query.ts");
    expect(query).not.toContain("crawl");
    const prefixes = [...query.matchAll(/Prefix:\s*([^,}\n]+)/gu)].map(
      (match) => match[1]?.trim(),
    );
    // Both listings take the caller's `prefix`, built only by generateDatePrefixes.
    expect(new Set(prefixes)).toEqual(new Set(["prefix"]));
    expect(query).toContain("return `games/${year}/${month}/${dayStr}/`;");
  });

  test("recovery-scan reads receipts and observations only: no object store, no crawl", async () => {
    const scan = await source("database/durable/recovery-scan.ts");
    expect(scan).not.toContain("@aws-sdk");
    expect(scan).not.toContain("ListObjects");
    expect(scan).not.toContain("crawl");
  });

  test("the crawl writes no receipt and no MatchObservation", () => {
    const forbidden =
      /matchProcessingReceipt\b|matchEvidenceAdmission\b|matchObservation\.(?:create|upsert|update|delete)|observeMatch|recordReceipt|MatchProcessingReceipt|durable\/observation/u;
    expect(crawlSources.length).toBeGreaterThan(5);
    for (const { name, text } of crawlSources) {
      expect(forbidden.exec(text), name).toBeNull();
    }
  });

  test("the crawl reads tracked observations but never lists the games/ prefix", () => {
    for (const { name, text } of crawlSources) {
      expect(text, name).not.toContain("ListObjectsV2Command");
      expect(text, name).not.toContain("enumerateRawObjects");
    }
  });
});
