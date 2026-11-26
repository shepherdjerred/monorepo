import { describe, expect, it } from "vitest";
import { ArtifactsError } from "#application/errors.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";
import { sha256Hex } from "#testing/client.ts";
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
