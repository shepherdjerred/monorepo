import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { startSyncFixture } from "./server";
import {
  openPinnedSocket,
  pinnedV3,
  privateDirectory,
} from "./fixture.test-support";

async function multipart() {
  const frames = await pinnedV3();
  const header = frames[1],
    binary = frames[2];
  assert.ok(
    header !== undefined &&
      "text" in header &&
      binary !== undefined &&
      "binary" in binary,
  );
  // Transport-only opaque bytes: a pinned ciphertext prefix plus public padding.
  // The native integration separately checks authenticated encryption/decryption.
  const content = new Uint8Array(
    Buffer.concat([Uint8Array.from(binary.binary), new Uint8Array(2_097_152)]),
  );
  return {
    header: { ...header.text, size: content.length, pieces: 2 },
    content,
  };
}

test("two-piece transfer acknowledges each piece and returns the exact opaque ciphertext", async () => {
  const directory = await privateDirectory();
  const fixture = await startSyncFixture({
    directory,
    runID: crypto.randomUUID(),
    profile: "pinned-transcript-v3",
  });
  try {
    const sender = await openPinnedSocket(fixture, "Multipart sender");
    expect(await sender.json()).toEqual({ op: "ready", version: 5 });
    const { header, content } = await multipart();
    sender.send(header);
    expect(await sender.json()).toEqual({ res: "ready" });
    sender.binary(content.slice(0, 2_097_152));
    expect(await sender.json()).toEqual({ res: "continue" });
    expect(fixture.snapshot().files).toEqual([]);
    sender.binary(content.slice(2_097_152));
    expect(await sender.json()).toMatchObject({
      op: "push",
      uid: 6,
      size: content.length,
      pieces: 2,
    });
    expect(await sender.json()).toEqual({ res: "ok" });
    const receiver = await openPinnedSocket(fixture, "Multipart receiver");
    expect(await receiver.json()).toMatchObject({ op: "push", uid: 6 });
    expect(await receiver.json()).toEqual({ op: "ready", version: 6 });
    receiver.send({ op: "pull", uid: 6 });
    expect(await receiver.json()).toEqual({ size: content.length, pieces: 2 });
    expect(await receiver.next()).toEqual(content.slice(0, 2_097_152));
    expect(await receiver.next()).toEqual(content.slice(2_097_152));
    expect(fixture.snapshot().counters.committedUploads).toBe(1);
    await sender.close();
    await receiver.close();
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true });
  }
});

test.each(["truncated", "overrun"] as const)(
  "%s binary transfer closes without a durable revision",
  async (mode) => {
    const directory = await privateDirectory();
    const fixture = await startSyncFixture({
      directory,
      runID: crypto.randomUUID(),
      profile: "pinned-transcript-v3",
    });
    try {
      const sender = await openPinnedSocket(
        fixture,
        "Invalid multipart sender",
      );
      expect(await sender.json()).toEqual({ op: "ready", version: 5 });
      const { header, content } = await multipart();
      sender.send(header);
      expect(await sender.json()).toEqual({ res: "ready" });
      sender.binary(content.slice(0, 2_097_152));
      expect(await sender.json()).toEqual({ res: "continue" });
      const tail = content.slice(2_097_152);
      sender.binary(
        mode === "truncated"
          ? tail.slice(0, -1)
          : Buffer.concat([tail, new Uint8Array(1)]),
      );
      await sender.closed;
      expect(fixture.snapshot().latestUID).toBe(5);
      expect(fixture.snapshot().files).toEqual([]);
      expect(fixture.snapshot().counters.protocolErrors).toBe(1);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true });
    }
  },
);
