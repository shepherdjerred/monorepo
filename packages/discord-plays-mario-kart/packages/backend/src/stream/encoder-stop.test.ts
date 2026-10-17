import { expect, it } from "vitest";
import { Client } from "discord.js-selfbot-v13";
import { GameStreamer } from "./game-streamer.ts";
import { spaghettiFormat, frameBytes } from "#src/engine/format.ts";

class EncoderProbe extends GameStreamer {
  prepare(signal: AbortSignal) {
    return this.buildEncoder(signal);
  }
}

it.each(["stop", "abort"] as const)(
  "%s releases a real encoder before audio starts, with video still buffered",
  async (method) => {
    const format = spaghettiFormat(30);
    const streamer = new EncoderProbe({
      selfbotClient: new Client(),
      guildId: "encoder-probe",
      channelId: "encoder-probe",
      format,
      canvasHeight: 240,
      frameRate: 30,
      bitrateKbps: 500,
      bitrateMaxKbps: 750,
      hardwareAcceleration: false,
      vaapiDevice: "/dev/dri/renderD128",
      encoderAsyncDepth: 1,
      lowLatencyMux: true,
      lowDelayAudio: true,
      videoPlayoutDelayMaxMs: 20,
      onEncoderStarted: () => {
        /* No Discord broadcast in this probe. */
      },
    });
    const controller = new AbortController();
    const encoder = await streamer.prepare(controller.signal);
    try {
      const frame = Buffer.alloc(frameBytes(format));
      for (let i = 0; i < 10; i++) encoder.sink.write(frame);
      expect(encoder.sink.writableLength).toBeGreaterThan(0);
      if (method === "stop") encoder.stop();
      else controller.abort();
      await expect(encoder.playing).rejects.toThrow(/SIGKILL|signal 9/u);
      encoder.stop();
    } finally {
      encoder.stop();
      streamer.destroy();
    }
  },
  5000,
);
