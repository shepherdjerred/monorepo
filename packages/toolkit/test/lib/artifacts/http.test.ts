import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createArtifactsClient } from "#lib/artifacts/client.ts";
import { streamLive } from "#lib/artifacts/live.ts";
import { buildSource } from "#lib/artifacts/manifest.ts";
import { uploadVersion } from "#lib/artifacts/upload.ts";
import { waitForFeedback } from "#lib/artifacts/wait.ts";
import {
  ACTOR,
  feedbackItem,
  IDS,
  tempDirectory,
} from "#test/support/artifacts.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});

/** Real sockets: streamed request bodies, Content-Length, and an aborted SSE read. */
function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  servers.push(server);
  return createArtifactsClient({
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    actor: ACTOR,
  });
}

test("a file streams from disk with its Content-Length over a real socket", async () => {
  const dir = await tempDirectory();
  const file = path.join(dir, "clip.bin");
  const bytes = new Uint8Array(3 * 1024 * 1024).map(
    (_value, index) => index % 251,
  );
  await writeFile(file, bytes);
  const source = await buildSource(file);
  const received: { length: string | null; size: number; sha: string }[] = [];
  const client = serve(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/uploads")
      return Response.json({
        uploadId: IDS.upload,
        missing: [source.files[0]?.sha256],
        expiresAt: "2026-11-27T00:00:00.000Z",
        deduplicated: false,
      });
    if (request.method === "PUT") {
      const body = new Uint8Array(await request.arrayBuffer());
      received.push({
        length: request.headers.get("content-length"),
        size: body.length,
        sha: new Bun.CryptoHasher("sha256").update(body).digest("hex"),
      });
      return new Response(null, { status: 204 });
    }
    return Response.json({
      artifactId: IDS.artifact,
      versionId: IDS.version,
      number: 1,
      reviewUrl: "https://artifacts.test/a/x",
      boardUrl: "https://artifacts.test/b/x",
      deduplicated: false,
    });
  });
  const result = await uploadVersion(client, source, {
    board: "demo",
    title: "Clip",
    kind: "file",
    expectedCurrentVersionId: null,
    idempotencyKey: "k".repeat(32),
  });
  expect(result.number).toBe(1);
  expect(received).toEqual([
    {
      length: String(bytes.length),
      size: bytes.length,
      sha: source.files[0]?.sha256,
    },
  ]);
});

test("aborting a real SSE connection ends the generator promptly", async () => {
  const client = serve(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": hello\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const controller = new AbortController();
  const seen: string[] = [];
  const done = (async () => {
    try {
      for await (const event of streamLive(client, {}, controller.signal))
        seen.push(event.type);
    } catch {
      // The abort ends the stream with an AbortError.
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await done;
  expect(seen).toEqual(["open"]);
});

test("a wait over real sockets survives the server dropping its stream", async () => {
  let streams = 0;
  let claims = 0;
  const client = serve((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/feedback/stream") {
      streams += 1;
      // The first connection closes immediately; later ones stay open.
      return new Response(
        streams === 1
          ? new ReadableStream({
              start(controller) {
                controller.close();
              },
            })
          : new ReadableStream({
              start() {
                // Stays open until the waiter goes away.
              },
            }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (url.pathname === "/trpc/feedback.claim") {
      claims += 1;
      return Response.json({
        result: {
          data: {
            items: claims >= 3 ? [feedbackItem()] : [],
            nextDeliverableAt: null,
          },
        },
      });
    }
    return Response.json({ result: { data: { acked: 1 } } });
  });
  const printed: number[] = [];
  const result = await waitForFeedback(
    {
      claim: (signal) => client.trpc.feedback.claim.mutate({}, { signal }),
      ack: async (commentIds) => {
        await client.trpc.feedback.ack.mutate({ commentIds });
      },
      stream: (signal) => streamLive(client, {}, signal),
      present: (items) => {
        printed.push(items.length);
        return Promise.resolve();
      },
    },
    {
      backoff: { baseMs: 5, maxMs: 20 },
      pollMs: 30,
      timeoutMs: 5000,
      connectGraceMs: 100,
    },
  );
  expect(result.outcome).toBe("feedback");
  expect(streams).toBeGreaterThanOrEqual(2);
  expect(printed).toEqual([1]);
});
