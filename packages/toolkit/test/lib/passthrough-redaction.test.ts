import { expect, test } from "vitest";
import { Writable } from "node:stream";
import { forwardRedactedOutput } from "#lib/passthrough-redaction.ts";

const credential = "synthetic-operator-token";

test("redacts credentials across every byte boundary without changing other bytes", async () => {
  const raw = Buffer.from(`before ${credential} 💡 ${credential} after`);
  for (let split = 0; split <= raw.length; split += 1) {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(raw.subarray(0, split));
        controller.enqueue(raw.subarray(split));
        controller.close();
      },
    });
    await forwardRedactedOutput(input, output, credential);
    expect(Buffer.concat(chunks).toString()).toBe(
      "before [REDACTED] 💡 [REDACTED] after",
    );
  }
});

test("forwards an interactive prompt before the child produces more output", async () => {
  const chunks: Buffer[] = [];
  let sawPrompt: (() => void) | undefined;
  const prompt = new Promise<void>((resolve) => {
    sawPrompt = resolve;
  });
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).toString() === "Proceed? ") sawPrompt?.();
      callback();
    },
  });
  const input = new TransformStream<Uint8Array, Uint8Array>();
  const writer = input.writable.getWriter();
  const forwarding = forwardRedactedOutput(input.readable, output, credential);
  await writer.write(Buffer.from("Proceed? "));
  await prompt;
  await writer.write(Buffer.from(credential));
  await writer.write(Buffer.from(" partial synthe"));
  await writer.close();
  await forwarding;
  expect(Buffer.concat(chunks).toString()).toBe(
    "Proceed? [REDACTED] partial synthe",
  );
});

test("rejects an empty credential", async () => {
  await expect(
    forwardRedactedOutput(new ReadableStream(), new Writable(), ""),
  ).rejects.toThrow("Redaction requires a credential");
});
