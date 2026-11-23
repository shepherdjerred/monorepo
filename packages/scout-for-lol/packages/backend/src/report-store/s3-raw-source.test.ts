import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, test, vi } from "vitest";
import {
  type RawObjectKind,
  classifyRawObjectKey,
  matchObjectKey,
  prematchObjectKey,
  readVerifiedRawObjectText,
  timelineObjectKey,
} from "#src/report-store/s3-raw-source.ts";

describe("classifyRawObjectKey", () => {
  const cases: [string, RawObjectKind][] = [
    ["games/2026/07/12/NA1_1/match.json", "match"],
    ["games/2026/07/12/NA1_1/timeline.json", "timeline"],
    ["prematch/2026/07/12/123/spectator-data.json", "prematch"],
    ["games/2026/07/12/NA1_1/report.png", "ignored"],
    ["games/2026/07/12/NA1_1/report.svg", "ignored"],
    // Evidence a client-sourced match was converted from; the lake reads the
    // converted match.json beside it, never the bundle.
    ["games/2026/07/12/NA1_1/client-bundle.json", "ignored"],
    ["failed-validations/2026/07/12/NA1_1/match.json", "ignored"],
    ["prematch/2026/07/12/123/loading-screen.png", "ignored"],
  ];
  test("classifies match/timeline/prematch keys and ignores the rest", () => {
    for (const [key, kind] of cases) {
      expect(classifyRawObjectKey(key)).toBe(kind);
    }
  });
});

test("cancels a body that exceeds its receipt even when S3 reports the expected length", async () => {
  const client = new S3Client({ region: "us-west-2" });
  const s3 = mockClient(client);
  const cancel = vi.fn();
  const chunks = [new Uint8Array([65, 66]), new Uint8Array([67, 68])];
  const pull = vi.fn(
    (controller: ReadableStreamDefaultController<Uint8Array>) => {
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  );
  const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  s3.on(GetObjectCommand).callsFake(() => ({
    ContentLength: 3,
    Body: { transformToWebStream: () => stream },
  }));

  await expect(
    readVerifiedRawObjectText({
      client,
      bucket: "bucket",
      key: "timeline.json",
      expectedDigest: "a".repeat(64),
      options: { expectedBytes: 3 },
    }),
  ).rejects.toThrow("Raw archive body exceeds its recorded length");
  expect(pull).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
  s3.restore();
});

test("an already-aborted bounded raw read does not request the object", async () => {
  const client = new S3Client({ region: "us-west-2" });
  const s3 = mockClient(client);
  const reason = new Error("request aborted");

  await expect(
    readVerifiedRawObjectText({
      client,
      bucket: "bucket",
      key: "timeline.json",
      expectedDigest: "a".repeat(64),
      options: { expectedBytes: 3, abortSignal: AbortSignal.abort(reason) },
    }),
  ).rejects.toThrow(reason.message);
  expect(s3.calls()).toHaveLength(0);
  s3.restore();
});

test("aborting a bounded read cancels the pending stream read and releases its lock", async () => {
  const client = new S3Client({ region: "us-west-2" });
  const s3 = mockClient(client);
  const cancel = vi.fn();
  const pending = Promise.withResolvers<boolean>();
  const stream = new ReadableStream(
    { pull: () => pending.resolve(true), cancel },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const reason = new Error("request disconnected");
  s3.on(GetObjectCommand).callsFake(() => ({
    Body: { transformToWebStream: () => stream },
  }));

  const reading = readVerifiedRawObjectText({
    client,
    bucket: "bucket",
    key: "timeline.json",
    expectedDigest: "a".repeat(64),
    options: { expectedBytes: 3, abortSignal: controller.signal },
  });
  await pending.promise;
  controller.abort(reason);
  await expect(reading).rejects.toThrow(reason.message);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
  expect(stream.locked).toBe(false);
  s3.restore();
});

describe("deterministic key builders (must mirror the live write paths)", () => {
  // Local-time construction so the date-fns `yyyy/MM/dd` (which formats in
  // local time, same as the write path) is timezone-independent in this test.
  const keyDate = new Date(2026, 6, 12, 12, 0, 0);

  test("match key mirrors storage/s3-helpers generateS3Key", () => {
    expect(matchObjectKey(RiotMatchIdSchema.parse("NA1_123"), keyDate)).toBe(
      "games/2026/07/12/NA1_123/match.json",
    );
  });

  test("timeline key mirrors storage/s3-helpers generateS3Key", () => {
    expect(timelineObjectKey(RiotMatchIdSchema.parse("NA1_123"), keyDate)).toBe(
      "games/2026/07/12/NA1_123/timeline.json",
    );
  });

  test("prematch key mirrors storage/s3-prematch generatePrematchS3Key", () => {
    expect(prematchObjectKey("NA1_456", keyDate)).toBe(
      "prematch/2026/07/12/NA1_456/spectator-data.json",
    );
  });

  test.each([
    {
      spelling: "platform-qualified",
      key: "prematch/2026/07/12/NA1_456/spectator-data.json",
    },
    {
      spelling: "pre-qualification numeric",
      key: "prematch/2026/07/12/456/spectator-data.json",
    },
  ])("classifies the $spelling prematch key as prematch", ({ key }) => {
    // Both spellings exist in the store, and the classifier must not care
    // which one it is looking at: identity comes from the payload.
    expect(classifyRawObjectKey(key)).toBe("prematch");
  });
});
