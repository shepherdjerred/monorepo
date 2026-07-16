import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import {
  buildAudioInputOptions,
  createAudioTransport,
} from "#src/stream/audio-transport.ts";

describe("buildAudioInputOptions", () => {
  test("emits the ffmpeg raw-PCM flags for pokemon's f32le format", () => {
    expect(
      buildAudioInputOptions({
        format: "f32le",
        sampleRate: 13_379,
        channels: 2,
      }),
    ).toEqual(["-f", "f32le", "-ar", "13379", "-ac", "2"]);
  });

  test("emits the ffmpeg raw-PCM flags for mario-kart's s16le format", () => {
    expect(
      buildAudioInputOptions({
        format: "s16le",
        sampleRate: 44_100,
        channels: 2,
      }),
    ).toEqual(["-f", "s16le", "-ar", "44100", "-ac", "2"]);
  });
});

describe("createAudioTransport", () => {
  test("binds a loopback source and carries the configured input options", async () => {
    const transport = await createAudioTransport({
      format: "s16le",
      sampleRate: 44_100,
      channels: 2,
    });
    try {
      expect(transport.source).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
      expect(transport.inputOptions).toEqual([
        "-f",
        "s16le",
        "-ar",
        "44100",
        "-ac",
        "2",
      ]);
    } finally {
      transport.close();
    }
  });

  test("pipes sink bytes to the connected ffmpeg-side socket", async () => {
    const transport = await createAudioTransport({
      format: "f32le",
      sampleRate: 13_379,
      channels: 2,
    });
    const port = Number(new URL(transport.source).port);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = connect(port, "127.0.0.1", () => {
        transport.sink.write(Buffer.from([1, 2, 3, 4]));
      });
      client.once("data", (chunk: Buffer | string) => {
        client.destroy();
        resolve(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      client.once("error", reject);
    });

    expect([...received]).toEqual([1, 2, 3, 4]);
    transport.close();
  });

  test("close() is idempotent", async () => {
    const transport = await createAudioTransport({
      format: "s16le",
      sampleRate: 44_100,
      channels: 2,
    });
    transport.close();
    expect(() => {
      transport.close();
    }).not.toThrow();
  });
});
