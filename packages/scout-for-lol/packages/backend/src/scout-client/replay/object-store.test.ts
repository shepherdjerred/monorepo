import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";
import { persistReplayFile } from "./object-store.ts";

test("uploads and reads back binary replay bytes through the real SDK transport", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-replay-sdk-"));
  const replayPath = path.join(directory, "fixture.rofl");
  const bytes = Buffer.concat([
    Buffer.from("RIOT"),
    Buffer.from([0, 255, 128, 1]),
    Buffer.alloc(70_000, 37),
  ]);
  await writeFile(replayPath, bytes);
  let stored = new Uint8Array();
  let contentType: string | null = null;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "PUT") {
        contentType = request.headers.get("content-type");
        stored = new Uint8Array(await request.arrayBuffer());
        return new Response(null, { headers: { ETag: '"fixture"' } });
      }
      return new Response(stored);
    },
  });
  const client = new S3Client({
    endpoint: server.url.toString(),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  try {
    await persistReplayFile(client, {
      bucket: "replays",
      key: "fixture",
      path: replayPath,
      bytes: bytes.length,
      digest: "a".repeat(64),
      gameId: "123",
    });
    const read = await client.send(
      new GetObjectCommand({ Bucket: "replays", Key: "fixture" }),
    );
    if (read.Body === undefined) throw new Error("Stored replay has no body");
    expect(Buffer.from(await read.Body.transformToByteArray())).toEqual(bytes);
    expect(contentType).toBe("application/vnd.riot.rofl");
  } finally {
    client.destroy();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
