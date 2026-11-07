import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { startSyncFixture } from "./server";
import {
  FixtureSocket,
  openPinnedSocket,
  pinnedV3,
  post,
  privateDirectory,
} from "./fixture.test-support";

function binarySHA(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

test("the exact source-pinned v3 client transcript uses real JSON/binary transport and survives server restart", async () => {
  const directory = await privateDirectory();
  const runID = crypto.randomUUID();
  let fixture = await startSyncFixture({
    directory,
    runID,
    profile: "pinned-transcript-v3",
  });
  try {
    const frames = await pinnedV3();
    const first = frames[0];
    assert.ok(first !== undefined && "text" in first);
    const socket = await FixtureSocket.open(fixture.identity.webSocketURL);
    socket.send(first.text);
    expect(await socket.json()).toMatchObject({ res: "ok" });
    expect(await socket.json()).toEqual({ op: "ready", version: 5 });
    let uid = 5;
    for (const frame of frames.slice(1)) {
      if ("binary" in frame) {
        socket.binary(Uint8Array.from(frame.binary));
        uid += 1;
        expect(await socket.json()).toMatchObject({ op: "push", uid });
        expect(await socket.json()).toEqual({ res: "ok" });
      } else if (frame.text["op"] === "pull") {
        socket.send(frame.text);
        expect(await socket.json()).toEqual({ size: 36, pieces: 1 });
        const original = frames[2];
        assert.ok(original !== undefined && "binary" in original);
        expect(await socket.next()).toEqual(Uint8Array.from(original.binary));
      } else {
        socket.send(frame.text);
        if ((frame.text["size"] ?? 0) === 0) {
          uid += 1;
          expect(await socket.json()).toMatchObject({ ...frame.text, uid });
          expect(await socket.json()).toEqual({ res: "ok" });
        } else expect(await socket.json()).toEqual({ res: "ready" });
      }
    }
    expect(fixture.snapshot().latestUID).toBe(10);
    const before = fixture.snapshot().files;
    expect(before).toHaveLength(5);
    const original = frames[2];
    assert.ok(original !== undefined && "binary" in original);
    expect(before[0]?.contentSHA256).toBe(
      binarySHA(Uint8Array.from(original.binary)),
    );
    expect(before[1]).toMatchObject({
      uid: 7,
      size: 0,
      pieces: 0,
      folder: false,
      deleted: false,
    });
    expect(before[1]?.hash).not.toBe("");
    socket.send({ op: "pull", uid: 7 });
    expect(await socket.json()).toEqual({ size: 0, pieces: 0 });
    await socket.close();
    await fixture.close();
    fixture = await startSyncFixture({
      directory,
      runID,
      profile: "pinned-transcript-v3",
    });
    expect(fixture.snapshot().files).toEqual(before);
    const resumed = await openPinnedSocket(fixture, "Restarted client", 9);
    expect(await resumed.json()).toMatchObject({ op: "push", uid: 10 });
    expect(await resumed.json()).toEqual({ op: "ready", version: 10 });
    resumed.send({ op: "pull", uid: 10 });
    expect(await resumed.json()).toEqual({ size: 36, pieces: 1 });
    expect(await resumed.next()).toEqual(Uint8Array.from(original.binary));
    await resumed.close();
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true });
  }
});

test.each(["before-commit", "after-commit"] as const)(
  "%s disconnect preserves the exact commit boundary and retry identity",
  async (fault) => {
    const directory = await privateDirectory();
    const fixture = await startSyncFixture({
      directory,
      runID: crypto.randomUUID(),
      profile: "pinned-transcript-v3",
    });
    try {
      const frames = await pinnedV3();
      const header = frames[1],
        binary = frames[2];
      assert.ok(
        header !== undefined &&
          "text" in header &&
          binary !== undefined &&
          "binary" in binary,
      );
      const observer = await openPinnedSocket(fixture, "Second replica");
      expect(await observer.json()).toEqual({ op: "ready", version: 5 });
      const sender = await openPinnedSocket(fixture, "First replica");
      expect(await sender.json()).toEqual({ op: "ready", version: 5 });
      const control = await post(fixture, "/__fixture/control", {
        runID: fixture.identity.runID,
        action:
          fault === "before-commit"
            ? "fail-next-push-before-commit"
            : "fail-next-push-after-commit",
      });
      expect(control.status).toBe(200);
      sender.send(header.text);
      expect(await sender.json()).toEqual({ res: "ready" });
      sender.binary(Uint8Array.from(binary.binary));
      await sender.closed;
      expect(fixture.snapshot().latestUID).toBe(
        fault === "before-commit" ? 5 : 6,
      );
      expect(fixture.snapshot().counters.committedUploads).toBe(
        fault === "before-commit" ? 0 : 1,
      );
      const resumed = await openPinnedSocket(fixture, "First replica");
      if (fault === "after-commit") {
        expect(await observer.json()).toMatchObject({ op: "push", uid: 6 });
        expect(await resumed.json()).toMatchObject({ op: "push", uid: 6 });
      }
      expect(await resumed.json()).toEqual({
        op: "ready",
        version: fault === "before-commit" ? 5 : 6,
      });
      resumed.send(header.text);
      if (fault === "before-commit") {
        expect(await resumed.json()).toEqual({ res: "ready" });
        resumed.binary(Uint8Array.from(binary.binary));
        expect(await observer.json()).toMatchObject({ op: "push", uid: 6 });
        expect(await resumed.json()).toMatchObject({ op: "push", uid: 6 });
      }
      expect(await resumed.json()).toEqual({ res: "ok" });
      expect(fixture.snapshot().latestUID).toBe(6);
      expect(fixture.snapshot().counters.committedUploads).toBe(1);
      expect(fixture.snapshot().files[0]?.contentSHA256).toBe(
        binarySHA(Uint8Array.from(binary.binary)),
      );
      await resumed.close();
      await observer.close();
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true });
    }
  },
);
