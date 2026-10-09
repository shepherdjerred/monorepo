import { expect, test } from "vitest";
import { OUTPUT_TAIL_LIMIT, teeOutputTail } from "./command-output.ts";

test("shows progress before command completion and retains only a bounded tail", async () => {
  const firstWrite = Promise.withResolvers<boolean>();
  const finish = Promise.withResolvers<boolean>();
  const encoder = new TextEncoder();
  let bytesWritten = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("x".repeat(OUTPUT_TAIL_LIMIT * 2)));
      await finish.promise;
      controller.enqueue(encoder.encode("\nfinal error\n"));
      controller.close();
    },
  });
  const result = teeOutputTail(stream, async (chunk) => {
    bytesWritten += chunk.byteLength;
    firstWrite.resolve(true);
  });
  await firstWrite.promise;
  expect(bytesWritten).toBe(OUTPUT_TAIL_LIMIT * 2);
  finish.resolve(true);
  const tail = await result;
  expect(tail.length).toBe(OUTPUT_TAIL_LIMIT);
  expect(tail.endsWith("\nfinal error\n")).toBe(true);
  expect(bytesWritten).toBe(
    OUTPUT_TAIL_LIMIT * 2 + encoder.encode("\nfinal error\n").byteLength,
  );
});

test("decodes UTF-8 across chunks without changing streamed bytes", async () => {
  const bytes = new TextEncoder().encode("build 🎉 complete");
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
  const written: number[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const tail = await teeOutputTail(stream, async (chunk) => {
    written.push(...chunk);
  });
  expect(tail).toBe("build 🎉 complete");
  expect(written).toEqual([...bytes]);
});

test("propagates output failures", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(65));
      controller.close();
    },
  });
  await expect(
    teeOutputTail(stream, async () => {
      throw new Error("output failed");
    }),
  ).rejects.toThrow("output failed");
});

test("bounds multibyte output by encoded bytes without splitting a character", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(`${"🎉é".repeat(OUTPUT_TAIL_LIMIT)}\nerror\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  let written = 0;
  const tail = await teeOutputTail(stream, async (chunk) => {
    written += chunk.byteLength;
  });
  expect(written).toBe(bytes.byteLength);
  expect(encoder.encode(tail).byteLength).toBeLessThanOrEqual(
    OUTPUT_TAIL_LIMIT,
  );
  expect(tail).not.toContain("�");
  expect(tail.endsWith("\nerror\n")).toBe(true);
  expect(new TextDecoder().decode(encoder.encode(tail))).toBe(tail);
});

test("includes decoder flush output in the byte budget", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("x".repeat(OUTPUT_TAIL_LIMIT)));
      controller.enqueue(Uint8Array.of(0xf0, 0x9f));
      controller.close();
    },
  });
  let written = 0;
  const tail = await teeOutputTail(stream, async (chunk) => {
    written += chunk.byteLength;
  });
  expect(written).toBe(OUTPUT_TAIL_LIMIT + 2);
  expect(encoder.encode(tail).byteLength).toBe(OUTPUT_TAIL_LIMIT);
  expect(tail.endsWith("�")).toBe(true);
});
