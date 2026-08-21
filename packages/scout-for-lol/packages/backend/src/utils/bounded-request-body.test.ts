import { describe, expect, test } from "vitest";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";

/**
 * The point of this helper is what it refuses to allocate, so the tests

 * assert how much of the body was produced — not only the returned verdict.
 * A read-then-check implementation passes every verdict assertion here while
 * still buffering the whole body, which is the bug this replaced.
 */

function streamOf(
  chunk: Uint8Array,
  count: number,
): { body: ReadableStream<Uint8Array>; produced: () => number } {
  let produced = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= count) {
        controller.close();
        return;
      }
      produced += 1;
      controller.enqueue(chunk);
    },
  });
  return { body, produced: () => produced };
}

function post(body: ReadableStream<Uint8Array> | string | null): Request {
  return new Request("http://localhost/", {
    method: "POST",
    body,
    duplex: "half",
  });
}

describe("readBodyWithinLimit", () => {
  test("returns a body that fits", async () => {
    const result = await readBodyWithinLimit(post("hello"), 1024);
    expect(result).toEqual({ ok: true, text: "hello" });
  });

  test("treats a missing body as empty rather than failing", async () => {
    const result = await readBodyWithinLimit(post(null), 1024);
    expect(result).toEqual({ ok: true, text: "" });
  });

  test("stops reading once the limit is passed", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const { body, produced } = streamOf(chunk, 100);

    const result = await readBodyWithinLimit(post(body), 4096);

    expect(result.ok).toBe(false);
    // 4 KiB limit, 1 KiB chunks: it must abandon the read near the limit
    // instead of draining all 100 KiB the caller offered.
    expect(produced()).toBeLessThanOrEqual(5);
  });

  test("accepts a body exactly at the limit", async () => {
    const result = await readBodyWithinLimit(post("abcd"), 4);
    expect(result).toEqual({ ok: true, text: "abcd" });
  });

  test("decodes a multi-byte character split across chunks", async () => {
    // "€" is E2 82 AC; splitting it means a per-chunk decode would corrupt it.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xe2, 0x82]));
        controller.enqueue(new Uint8Array([0xac]));
        controller.close();
      },
    });

    const result = await readBodyWithinLimit(post(body), 1024);

    expect(result).toEqual({ ok: true, text: "€" });
  });
});
