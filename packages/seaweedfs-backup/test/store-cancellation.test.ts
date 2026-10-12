import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  S3ObjectStore,
  readObjectBytes,
} from "@shepherdjerred/seaweedfs-backup/store";

function clientFixture() {
  return new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
}

describe("S3 maintenance cancellation", () => {
  test("aborts an in-flight candidate-set upload at the HTTP transport", async () => {
    const cancellation = new AbortController();
    const requestStarted = Promise.withResolvers<boolean>();
    const client = new S3Client({
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      requestHandler: {
        handle(_request: unknown, options: unknown) {
          const { abortSignal } = z
            .object({ abortSignal: z.instanceof(AbortSignal) })
            .parse(options);
          requestStarted.resolve(true);
          expect(abortSignal).toBe(cancellation.signal);
          return new Promise((_resolve, reject) => {
            abortSignal.addEventListener(
              "abort",
              () => reject(new Error("Upload transport aborted")),
              { once: true },
            );
          });
        },
      },
    });
    const store = new S3ObjectStore(client, { signal: cancellation.signal });
    try {
      const writing = store.putObject({
        bucket: "backup",
        key: "candidate-set",
        body: new Uint8Array([1]),
        headers: { metadata: {} },
      });
      const assertion = expect(writing).rejects.toThrow(
        "Upload transport aborted",
      );
      await requestStarted.promise;
      cancellation.abort();
      await assertion;
    } finally {
      client.destroy();
    }
  });

  test("passes cancellation to requests and stops between listing pages", async () => {
    const client = clientFixture();
    const cancellation = new AbortController();
    const request = vi.fn(async (_command: unknown, _options: unknown) => ({
      Contents: [],
      IsTruncated: true,
      NextContinuationToken: "next-page",
    }));
    Object.defineProperty(client, "send", { value: request });
    let requests = 0;
    const store = new S3ObjectStore(client, {
      signal: cancellation.signal,
      onProgress: () => {
        requests += 1;
        if (requests === 2) cancellation.abort(new Error("Stop listing"));
      },
    });
    await expect(store.listObjects("backup")).rejects.toThrow("Stop listing");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({
      abortSignal: cancellation.signal,
    });
    client.destroy();
  });

  test("cancels a streaming manifest read after the response headers arrive", async () => {
    const client = clientFixture();
    const cancellation = new AbortController();
    const body = new Readable({
      read() {
        /* Keep the stream pending until cancellation. */
      },
    });
    Object.defineProperty(client, "send", {
      value: vi.fn(async () => ({
        Body: body,
        ContentLength: 1,
        ETag: '"test"',
        LastModified: new Date("2026-01-01"),
      })),
    });
    const store = new S3ObjectStore(client, { signal: cancellation.signal });
    const object = await store.getObject("backup", "manifest");
    const reading = readObjectBytes(object);
    const assertion = expect(reading).rejects.toThrow("aborted");
    cancellation.abort();
    await assertion;
    expect(body.destroyed).toBe(true);
    client.destroy();
  });

  test("rejects deletion and upload before sending when already cancelled", async () => {
    const client = clientFixture();
    const request = vi.spyOn(client, "send");
    const store = new S3ObjectStore(client, {
      signal: AbortSignal.abort(new Error("Activity no longer owns writes")),
    });
    await expect(store.deleteObject("backup", "object")).rejects.toThrow(
      "Activity no longer owns writes",
    );
    await expect(
      store.putObject({
        bucket: "backup",
        key: "candidate-set",
        body: new Uint8Array(),
        headers: { metadata: {} },
      }),
    ).rejects.toThrow("Activity no longer owns writes");
    expect(request).not.toHaveBeenCalled();
    client.destroy();
  });
});
