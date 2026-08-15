import { afterEach, describe, expect, test } from "bun:test";
import { createTempoForwarder } from "#src/forwarder.ts";

const ERROR_BODY_LIMIT = 2000;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createTempoForwarder", () => {
  test("bounds an unending error body instead of buffering it", async () => {
    let cancelled = false;
    let chunksProduced = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    // A body that never ends: reading it to completion would hang this test
    // and, in the ingest pod, exhaust memory.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = Object.assign(
      () => Promise.resolve(new Response(body, { status: 503 })),
      { preconnect: (url: string | URL) => void url },
    );

    const forwarder = createTempoForwarder("https://tempo.test/v1/traces");
    const failure = forwarder.forward("{}");

    await expect(failure).rejects.toThrow(
      /^Tempo OTLP forwarding failed \(503\): x+$/,
    );
    expect(cancelled).toBe(true);
    // One 64 KiB chunk already passes the limit, so the reader stops there
    // rather than draining an infinite stream.
    expect(chunksProduced).toBeLessThanOrEqual(2);
  });

  test("truncates the diagnostic body to the declared limit", async () => {
    const oversized = "y".repeat(10 * ERROR_BODY_LIMIT);
    globalThis.fetch = Object.assign(
      () => Promise.resolve(new Response(oversized, { status: 500 })),
      { preconnect: (url: string | URL) => void url },
    );

    const forwarder = createTempoForwarder("https://tempo.test/v1/traces");
    let message = "";
    try {
      await forwarder.forward("{}");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    const prefix = "Tempo OTLP forwarding failed (500): ";
    expect(message.startsWith(prefix)).toBe(true);
    expect(message.length - prefix.length).toBe(ERROR_BODY_LIMIT);
  });

  test("resolves without inspecting the body on success", async () => {
    globalThis.fetch = Object.assign(
      () => Promise.resolve(new Response("ok", { status: 200 })),
      { preconnect: (url: string | URL) => void url },
    );

    const forwarder = createTempoForwarder("https://tempo.test/v1/traces");
    await expect(forwarder.forward("{}")).resolves.toBeUndefined();
  });
});
