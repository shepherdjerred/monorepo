import { afterEach, expect, test, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { fetchObject } from "./fetch-object.ts";

const cleanup: (() => Promise<void>)[] = [];
const missingBodyResponse = async () => ({
  response: {},
  output: { $metadata: {} },
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixture(respond: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: respond,
  });
  const client = new S3Client({
    endpoint: server.url.toString(),
    forcePathStyle: true,
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    maxAttempts: 1,
  });
  cleanup.push(async () => {
    client.destroy();
    await server.stop(true);
  });
  return client;
}

test("preserves the complete raw text and metadata", async () => {
  const text = ' {"puuid":"unchanged","unicode":"é"}\n';
  const client = fixture(
    () =>
      new Response(text, { headers: { "x-amz-meta-captured": "original" } }),
  );
  expect(await fetchObject(client, "fixture", "object.json")).toEqual({
    body: text,
    metadata: { captured: "original" },
  });
});

test("an actual empty body remains an empty body, not a missing read", async () => {
  const client = fixture(() => new Response(""));
  const result = await fetchObject(client, "fixture", "empty.json");
  expect(result.body).toBe("");
});

test("a hung body is cancelled on every bounded attempt, never counted as read", async () => {
  let requests = 0;
  let cancelled = 0;
  const client = fixture(() => {
    requests++;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        cancel() {
          cancelled++;
        },
      }),
    );
  });
  await expect(
    fetchObject(client, "fixture", "hung.json", 100),
  ).rejects.toThrow(/object read exceeded 100ms/);
  expect(requests).toBe(3);
  await vi.waitFor(() => expect(cancelled).toBe(3));
});

test("a timed-out body can recover through a fresh GET", async () => {
  let requests = 0;
  let cancelled = 0;
  const client = fixture(() => {
    requests++;
    if (requests > 1)
      return new Response("complete", {
        headers: { "x-amz-meta-state": "kept" },
      });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
        cancel() {
          cancelled++;
        },
      }),
    );
  });
  expect(await fetchObject(client, "fixture", "recover.json", 100)).toEqual({
    body: "complete",
    metadata: { state: "kept" },
  });
  expect(requests).toBe(2);
  await vi.waitFor(() => expect(cancelled).toBe(1));
});

test("headers that never arrive are bounded as well", async () => {
  const client = fixture(() => Promise.withResolvers<Response>().promise);
  await expect(
    fetchObject(client, "fixture", "headers.json", 50),
  ).rejects.toThrow(/object read exceeded 50ms/);
});

test("authorization failures are not retried or replaced with empty data", async () => {
  let requests = 0;
  const client = fixture(() => {
    requests++;
    return new Response("<Error><Code>AccessDenied</Code></Error>", {
      status: 403,
    });
  });
  await expect(fetchObject(client, "fixture", "denied.json")).rejects.toThrow();
  expect(requests).toBe(1);
});

test("missing SDK bodies still fail loudly", async () => {
  const client = fixture(() => new Response("unused"));
  client.middlewareStack.add(() => missingBodyResponse, {
    step: "initialize",
    name: "missingBodyFixture",
  });
  await expect(fetchObject(client, "fixture", "missing.json")).rejects.toThrow(
    /S3 returned no body/,
  );
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
  "rejects an invalid deadline %s before requesting anything",
  async (timeout) => {
    let requests = 0;
    const client = fixture(() => {
      requests++;
      return new Response("unused");
    });
    await expect(
      fetchObject(client, "fixture", "invalid.json", timeout),
    ).rejects.toThrow(/positive integral/);
    expect(requests).toBe(0);
  },
);
