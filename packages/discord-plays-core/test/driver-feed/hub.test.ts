import { afterEach, describe, expect, it } from "vitest";
import {
  driverFeedClients,
  driverFeedClientBufferBytes,
} from "#src/driver-feed/metrics.ts";
import {
  DRIVER_FEED_AUDIO_FLAG,
  DRIVER_FEED_HEADER_BYTES,
  DRIVER_FEED_KEYFRAME_FLAG,
} from "#src/driver-feed/protocol.ts";
import {
  DriverFeedHub,
  frameDriverFeedAudioMessage,
  frameDriverFeedMessage,
  type FeedClient,
} from "#src/driver-feed/hub.ts";
import type { AccessUnit } from "#src/driver-feed/annex-b.ts";

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

const feeds: DriverFeedHub[] = [];
afterEach(() => {
  for (const feed of feeds.splice(0)) feed.closeAll("test complete");
});
function hub(overrides?: Partial<{ maxClients: number; maxBuffer: number }>) {
  const feed = new DriverFeedHub({
    maxClients: overrides?.maxClients ?? 4,
    maxClientBufferBytes: overrides?.maxBuffer ?? 1000,
  });
  feeds.push(feed);
  return feed;
}

async function metricValue(gauge: typeof driverFeedClients) {
  const metric = await gauge.get();
  return metric.values[0]?.value;
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
  it("preserves another feed's clients and worst backlog when a session closes", async () => {
    const first = hub();
    const second = hub();
    const a = new FakeClient();
    const b = new FakeClient();
    a.bufferedBytes = 600;
    b.bufferedBytes = 300;
    first.add(a);
    second.add(b);
    first.broadcast(ENTRY);
    second.broadcast(ENTRY);
    expect(await metricValue(driverFeedClients)).toBe(2);
    expect(await metricValue(driverFeedClientBufferBytes)).toBe(600);
    first.closeAll("session ended");
    expect(await metricValue(driverFeedClients)).toBe(1);
    expect(await metricValue(driverFeedClientBufferBytes)).toBe(300);
    second.closeAll("session ended");
    expect(await metricValue(driverFeedClients)).toBe(0);
    expect(await metricValue(driverFeedClientBufferBytes)).toBe(0);
  });
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

  it("requires existing clients to resync at a decoder entry point after restart", () => {
    const feed = hub();
    const client = new FakeClient();
    feed.add(client);
    feed.broadcast(ENTRY);

    feed.resetAllToKeyframe();
    feed.broadcast(DELTA);
    feed.broadcast(ENTRY);

    expect(client.sent).toEqual([framed(ENTRY), framed(ENTRY)]);
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

describe("broadcastAudio", () => {
  const PCM = Buffer.from([1, 0, 2, 0]);

  it("frames audio with the audio flag and the PCM untouched", () => {
    const message = frameDriverFeedAudioMessage(PCM);
    expect(message[0]).toBe(DRIVER_FEED_AUDIO_FLAG);
    expect(message.subarray(DRIVER_FEED_HEADER_BYTES)).toEqual(PCM);
  });

  it("sends audio to a client still waiting for its first keyframe", () => {
    const feed = hub();
    const client = new FakeClient();
    feed.add(client);

    feed.broadcast(DELTA);
    feed.broadcastAudio(PCM);

    expect(client.sent).toEqual([frameDriverFeedAudioMessage(PCM)]);
  });

  it("withholds audio from a client over the backlog ceiling", () => {
    const feed = hub({ maxBuffer: 10 });
    const slow = new FakeClient();
    const fast = new FakeClient();
    feed.add(slow);
    feed.add(fast);
    slow.bufferedBytes = 11;

    feed.broadcastAudio(PCM);

    expect(slow.sent).toEqual([]);
    expect(fast.sent).toEqual([frameDriverFeedAudioMessage(PCM)]);
  });
});
