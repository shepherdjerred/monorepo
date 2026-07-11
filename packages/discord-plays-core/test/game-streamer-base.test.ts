import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Client } from "discord.js-selfbot-v13";
import type { EncoderHandles } from "@shepherdjerred/discord-stream-lifecycle/types.ts";
import { GameStreamerBase } from "#src/stream/game-streamer-base.ts";
import { streamActive } from "#src/observability/metrics.ts";
import type { AudioTransport } from "#src/stream/audio-transport.ts";

const silentLogger = {
  info: () => {
    /* silent */
  },
  warn: () => {
    /* silent */
  },
  error: () => {
    /* silent */
  },
};

// Minimal concrete subclass: buildEncoder is never invoked in these tests (they
// don't drive the machine to `streaming`, which needs a live voice connection),
// so it just satisfies the abstract contract.
class TestStreamer extends GameStreamerBase {
  pushFrame(): void {
    // not exercised here
  }

  protected buildEncoder(): Promise<EncoderHandles> {
    return Promise.reject(new Error("buildEncoder not used in this test"));
  }

  /** Test seam: attach a fake audio transport so teardown can be observed. */
  setAudioTransport(transport: AudioTransport): void {
    this.audioTransport = transport;
  }
}

function makeStreamer(): TestStreamer {
  return new TestStreamer({
    selfbotClient: new Client(),
    guildId: "guild-1",
    channelId: "channel-1",
    logger: silentLogger,
  });
}

// Read a single-series gauge's current value out of the shared registry.
async function gaugeValue(name: string): Promise<number | undefined> {
  const { registry } = await import("#src/observability/metrics.ts");
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  return metric?.values[0]?.value;
}

describe("GameStreamerBase", () => {
  test("starts idle: not streaming and the stream_active gauge reads 0", async () => {
    const streamer = makeStreamer();
    try {
      expect(streamer.isStreaming).toBe(false);
      // The snapshot subscription fires on start with a null frame sink.
      expect(await gaugeValue("stream_active")).toBe(0);
      // streamActive is the shared gauge the subscription drives.
      expect(streamActive).toBeDefined();
    } finally {
      streamer.destroy();
    }
  });

  test("pushAudio is a no-op while idle (no transport wired)", () => {
    const streamer = makeStreamer();
    try {
      expect(() => {
        streamer.pushAudio(Buffer.from([1, 2, 3, 4]));
      }).not.toThrow();
    } finally {
      streamer.destroy();
    }
  });

  test("start() and stop() resolve immediately (desired-state, fire-and-forget)", async () => {
    const streamer = makeStreamer();
    try {
      await expect(streamer.start()).resolves.toBeUndefined();
      await expect(streamer.stop()).resolves.toBeUndefined();
    } finally {
      streamer.destroy();
    }
  });

  test("destroy() tears down a wired audio transport", () => {
    const streamer = makeStreamer();
    let closed = 0;
    const fakeTransport: AudioTransport = {
      sink: new PassThrough(),
      source: "tcp://127.0.0.1:1",
      inputOptions: [],
      close: () => {
        closed++;
      },
    };
    streamer.setAudioTransport(fakeTransport);
    streamer.destroy();
    expect(closed).toBe(1);
  });
});
