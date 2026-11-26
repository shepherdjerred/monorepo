import { describe, expect, it, vi } from "vitest";
import { ArtifactsError } from "#application/errors.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";
import { sha256Hex } from "#testing/client.ts";
import { watchStream } from "./stream-errors.ts";
import { receiveBlob, type BlobSink } from "./uploads-route.ts";

const text = (value: string) => new TextEncoder().encode(value);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function sinkOf(store = memoryObjectStore(), recorded = true) {
  const bytes: number[] = [];
  const sink: BlobSink = {
    uploadId: "upload-1",
    store,
    recordBlob: () => Promise.resolve(recorded),
    onBytes: (count) => {
      bytes.push(count);
    },
  };
  return { sink, store, bytes };
}

async function rejection(work: Promise<unknown>): Promise<ArtifactsError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ArtifactsError) return error;
    throw error;
  }
  throw new Error("expected the upload to be refused");
}

describe("receiveBlob", () => {
  const body = text("hello artifacts");

  it("stores a body whose size and sha256 match, however it is chunked", async () => {
    const { sink, store, bytes } = sinkOf();
    const digest = await sha256Hex(body);
    const outcome = await receiveBlob(
      sink,
      streamOf(body.slice(0, 4), body.slice(4)),
      digest,
      body.length,
    );
    expect(outcome).toEqual({ status: "stored" });
    expect(store.keys()).toHaveLength(1);
    expect(store.bytes(store.keys()[0] ?? "")).toEqual(body);
    expect(bytes).toEqual([body.length]);
  });

  it("deletes the object and fails with 422 on a sha256 mismatch", async () => {
    const { sink, store } = sinkOf();
    const error = await rejection(
      receiveBlob(
        sink,
        streamOf(text("hello artifactz")),
        await sha256Hex(body),
        body.length,
      ),
    );
    expect(error.code).toBe("UNPROCESSABLE_CONTENT");
    expect(store.keys()).toEqual([]);
  });

  it("deletes the object on a short or long body", async () => {
    const digest = await sha256Hex(body);
    for (const sent of [body.slice(1), text("hello artifacts!!")]) {
      const { sink, store } = sinkOf();
      const error = await rejection(
        receiveBlob(sink, streamOf(sent), digest, body.length),
      );
      expect(error.code).toBe("UNPROCESSABLE_CONTENT");
      expect(store.keys()).toEqual([]);
    }
  });

  it("deletes the object when the stream fails mid-body", async () => {
    const { sink, store } = sinkOf();
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.slice(0, 3));
        controller.error(new Error("connection reset"));
      },
    });
    await expect(
      receiveBlob(sink, failing, await sha256Hex(body), body.length),
    ).rejects.toThrow("connection reset");
    expect(store.keys()).toEqual([]);
  });

  it("deletes its own object when another upload recorded the digest first", async () => {
    const { sink, store, bytes } = sinkOf(memoryObjectStore(), false);
    const outcome = await receiveBlob(
      sink,
      streamOf(body),
      await sha256Hex(body),
      body.length,
    );
    expect(outcome).toEqual({ status: "exists" });
    expect(store.keys()).toEqual([]);
    expect(bytes).toEqual([body.length]);
  });

  it("accepts an empty file", async () => {
    const { sink, store } = sinkOf();
    const empty = new Uint8Array(0);
    expect(await receiveBlob(sink, null, await sha256Hex(empty), 0)).toEqual({
      status: "stored",
    });
    expect(store.keys()).toHaveLength(1);
  });
});

describe("failure logs", () => {
  it("names the upload and digest when a blob fails, and nothing secret", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const { sink } = sinkOf();
      await rejection(
        receiveBlob(sink, streamOf(text("short")), "a".repeat(64), 99),
      );
      const logged = error.mock.calls.flat().join("\n");
      expect(logged).toContain("artifacts_blob_upload_failed");
      expect(logged).toContain('"uploadId":"upload-1"');
      expect(logged).toContain('"declaredSize":99');
    } finally {
      error.mockRestore();
    }
  });

  it("reports a failing content stream with the version, then fails the stream", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("rewriter exploded"));
        },
      });
      const watched = watchStream(broken, { versionId: "v-1", op: "html" });
      await expect(new Response(watched).text()).rejects.toThrow(
        "rewriter exploded",
      );
      const logged = error.mock.calls.flat().join("\n");
      expect(logged).toContain("artifacts_content_stream_failed");
      expect(logged).toContain('"versionId":"v-1"');
      expect(logged).toContain('"op":"html"');
    } finally {
      error.mockRestore();
    }
  });
});
