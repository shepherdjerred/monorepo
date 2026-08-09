import { describe, expect, it } from "bun:test";
import {
  DRIVER_FEED_HEADER_BYTES,
  DRIVER_FEED_KEYFRAME_FLAG,
} from "@discord-plays-mario-kart/common";
import {
  DriverFeedHub,
  frameDriverFeedMessage,
  type FeedClient,
} from "./hub.ts";
import type { AccessUnit } from "./annex-b.ts";

function unit(kind: "entry" | "keyframe-only" | "delta"): AccessUnit {
  return {
    bytes: Buffer.from([kind.length]),
    isKeyframe: kind !== "delta",
    isDecoderEntryPoint: kind === "entry",
  };
}

const ENTRY = unit("entry");
const DELTA = unit("delta");

/** What the hub actually puts on the wire: one-byte header, then the AU. */
const framed = frameDriverFeedMessage;

/** Test double for a `ws` socket: records sends and lets a test fake a backlog. */
class FakeClient implements FeedClient {
  readonly sent: Buffer[] = [];
  closedWith: string | undefined;
  bufferedBytes = 0;

  send(payload: Buffer): void {
    this.sent.push(payload);
  }

  close(reason: string): void {
    this.closedWith = reason;
  }
}

function hub(overrides?: Partial<{ maxClients: number; maxBuffer: number }>) {
  return new DriverFeedHub({
    maxClients: overrides?.maxClients ?? 4,
    maxClientBufferBytes: overrides?.maxBuffer ?? 1000,
  });
}

describe("frameDriverFeedMessage", () => {
  it("flags entry points so the client can pick the EncodedVideoChunk type", () => {
    // Mislabelling a chunk throws in VideoDecoder and kills the decoder, so the
    // header byte is the client's only safe source for this.
    expect(framed(ENTRY)[0]).toBe(DRIVER_FEED_KEYFRAME_FLAG);
    expect(framed(DELTA)[0]).toBe(0);
  });

  it("appends the access unit verbatim after the header", () => {
    expect(framed(ENTRY).subarray(DRIVER_FEED_HEADER_BYTES)).toEqual(
      ENTRY.bytes,
    );
  });

  it("does not flag a keyframe that lacks parameter sets", () => {
    // isKeyframe is true here, but a cold decoder cannot start on it.
    expect(framed(unit("keyframe-only"))[0]).toBe(0);
  });
});

describe("DriverFeedHub", () => {
  it("withholds deltas from a new client until a decoder entry point arrives", () => {
    const feed = hub();
    const client = new FakeClient();
    expect(feed.add(client)).toBe(true);

    feed.broadcast(DELTA);
    feed.broadcast(DELTA);
    expect(client.sent).toHaveLength(0);

    feed.broadcast(ENTRY);
    feed.broadcast(DELTA);
    expect(client.sent).toEqual([framed(ENTRY), framed(DELTA)]);
  });

  it("does not start a client on a keyframe that lacks parameter sets", () => {
    const feed = hub();
    const client = new FakeClient();
    feed.add(client);

    // IDR present but no SPS/PPS: a cold decoder cannot configure from this.
    feed.broadcast(unit("keyframe-only"));
    expect(client.sent).toHaveLength(0);

    feed.broadcast(ENTRY);
    expect(client.sent).toEqual([framed(ENTRY)]);
  });

  it("drops units for a backlogged client and resyncs it at the next entry point", () => {
    const feed = hub({ maxBuffer: 100 });
    const client = new FakeClient();
    feed.add(client);
    feed.broadcast(ENTRY);
    expect(client.sent).toHaveLength(1);

    // Socket falls behind: everything is withheld while the backlog drains.
    client.bufferedBytes = 500;
    feed.broadcast(DELTA);
    feed.broadcast(ENTRY);
    expect(client.sent).toHaveLength(1);

    // Backlog clears, but the client missed frames, so only an entry point
    // restarts it — not the next delta.
    client.bufferedBytes = 0;
    feed.broadcast(DELTA);
    expect(client.sent).toHaveLength(1);
    feed.broadcast(ENTRY);
    expect(client.sent).toEqual([framed(ENTRY), framed(ENTRY)]);
  });

  it("isolates clients from each other's backpressure", () => {
    const feed = hub({ maxBuffer: 100 });
    const slow = new FakeClient();
    const fast = new FakeClient();
    feed.add(slow);
    feed.add(fast);
    feed.broadcast(ENTRY);

    slow.bufferedBytes = 500;
    feed.broadcast(DELTA);
    feed.broadcast(DELTA);

    expect(slow.sent).toHaveLength(1);
    expect(fast.sent).toHaveLength(3);
  });

  it("refuses clients past the cap and keeps serving the existing ones", () => {
    const feed = hub({ maxClients: 2 });
    const first = new FakeClient();
    const second = new FakeClient();
    const third = new FakeClient();

    expect(feed.add(first)).toBe(true);
    expect(feed.add(second)).toBe(true);
    expect(feed.add(third)).toBe(false);
    expect(feed.clientCount).toBe(2);

    feed.broadcast(ENTRY);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
    expect(third.sent).toHaveLength(0);
  });

  it("stops sending to a removed client and frees its slot", () => {
    const feed = hub({ maxClients: 1 });
    const first = new FakeClient();
    feed.add(first);
    feed.broadcast(ENTRY);

    feed.remove(first);
    expect(feed.clientCount).toBe(0);
    feed.broadcast(ENTRY);
    expect(first.sent).toHaveLength(1);

    const second = new FakeClient();
    expect(feed.add(second)).toBe(true);
  });

  it("closes every client on teardown", () => {
    const feed = hub();
    const first = new FakeClient();
    const second = new FakeClient();
    feed.add(first);
    feed.add(second);

    feed.closeAll("session ended");

    expect(first.closedWith).toBe("session ended");
    expect(second.closedWith).toBe("session ended");
    expect(feed.clientCount).toBe(0);
  });
});
