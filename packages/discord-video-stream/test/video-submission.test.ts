import { describe, expect, test } from "vitest";
import { Client } from "discord.js-selfbot-v13";
import { Streamer } from "../src/client/Streamer.js";
import { VoiceConnection } from "../src/client/voice/VoiceConnection.js";

describe("video submission observations", () => {
  test("distinguishes skipped submissions, async native queuing and throwing sends", () => {
    const client = new Client();
    const streamer = new Streamer(client);
    const voice = new VoiceConnection(streamer, "guild", "bot", "channel", () => {});
    const wrapper = voice.webRtcConn;
    const outcomes: string[] = [];
    const dispose = wrapper.subscribeVideoSubmission((event) => outcomes.push(event.outcome));
    const frame = Buffer.from([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]);
    try {
      wrapper.sendVideoFrame(frame, 1000 / 30);
      wrapper["_webRtcConn"] = { state: () => "connected", close: () => {} };
      wrapper.sendVideoFrame(frame, 1000 / 30);
      voice["_webRtcParams"] = {
        address: "127.0.0.1", port: 50_000, audioSsrc: 11, videoSsrc: 12, rtxSsrc: 13, supportedEncryptionModes: [],
      };
      wrapper.setPacketizer("H264");
      wrapper.sendVideoFrame(frame, 1000 / 30);
      wrapper["_videoTrack"] = { sendMessageBinary: () => false };
      wrapper.sendVideoFrame(frame, 1000 / 30);
      wrapper["_videoTrack"] = { sendMessageBinary: () => { throw new Error("native send failed"); } };
      expect(() => wrapper.sendVideoFrame(frame, 1000 / 30)).toThrow("native send failed");
      expect(outcomes).toEqual(["not-ready", "missing-packetizer", "missing-track", "submitted", "error"]);
      dispose();
      wrapper["_videoTrack"] = { sendMessageBinary: () => false };
      wrapper.sendVideoFrame(frame, 1000 / 30);
      expect(outcomes).toHaveLength(5);
    } finally {
      wrapper.close();
      streamer.dispose();
      client.destroy();
    }
  });
});
