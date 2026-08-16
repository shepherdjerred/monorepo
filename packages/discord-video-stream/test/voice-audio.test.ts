import { describe, expect, test } from "bun:test";
import { Client } from "discord.js-selfbot-v13";
import {
  parseRtpPacket,
  prepareReceivedOpus,
  voiceAudioSdpDirection,
} from "../src/client/voice/BaseMediaConnection.ts";
import { VoiceConnection } from "../src/client/voice/VoiceConnection.ts";
import {
  Streamer,
  voiceStateAudioFlags,
} from "../src/client/Streamer.ts";
import {
  advanceRtpTimestamp,
  prepareAssistantOpus,
} from "../src/client/voice/WebRtcWrapper.ts";

function rtpPacket(options: {
  ssrc: number;
  payload: number[];
  extension?: number[];
  padding?: number;
}): Uint8Array {
  const extension = options.extension ?? [];
  const padding = options.padding ?? 0;
  const header = new Uint8Array(12 + (extension.length > 0 ? 4 + extension.length : 0));
  header[0] = 0x80 | (extension.length > 0 ? 0x10 : 0) | (padding > 0 ? 0x20 : 0);
  header[1] = 120;
  const view = new DataView(header.buffer);
  view.setUint32(8, options.ssrc);
  if (extension.length > 0) {
    view.setUint16(12, 0xbede);
    view.setUint16(14, extension.length / 4);
    header.set(extension, 16);
  }
  const packet = new Uint8Array(header.length + options.payload.length + padding);
  packet.set(header);
  packet.set(options.payload, header.length);
  if (padding > 0) packet[packet.length - 1] = padding;
  return packet;
}

describe("voice RTP parsing", () => {
  test("extracts SSRC and Opus payload", () => {
    expect(parseRtpPacket(rtpPacket({ ssrc: 42, payload: [1, 2, 3] }))).toEqual({
      ssrc: 42,
      payload: new Uint8Array([1, 2, 3]),
    });
  });

  test("skips header extensions and padding", () => {
    const parsed = parseRtpPacket(
      rtpPacket({ ssrc: 99, payload: [8, 9], extension: [1, 2, 3, 4], padding: 4 }),
    );
    expect(parsed).toEqual({ ssrc: 99, payload: new Uint8Array([8, 9]) });
  });

  test("returns the payload as a view over the packet, not a copy", () => {
    const packet = rtpPacket({ ssrc: 7, payload: [5, 6, 7] });
    const parsed = parseRtpPacket(packet);
    expect(parsed.payload.buffer).toBe(packet.buffer);
    parsed.payload.fill(0);
    // Zeroing the payload view erases exactly the voice bytes inside the packet.
    expect(packet.subarray(12)).toEqual(new Uint8Array([0, 0, 0]));
  });

  test("rejects short packets before reading the RTP header", () => {
    expect(() => parseRtpPacket(new Uint8Array([0x80]))).toThrow("Invalid RTP packet");
  });

  test("rejects invalid RTP header boundaries", () => {
    const wrongVersion = new Uint8Array(12);
    expect(() => parseRtpPacket(wrongVersion)).toThrow("Invalid RTP packet");

    const truncatedCsrcList = new Uint8Array(12);
    truncatedCsrcList[0] = 0x81;
    expect(() => parseRtpPacket(truncatedCsrcList)).toThrow("Invalid RTP CSRC list");

    const truncatedExtensionHeader = new Uint8Array(12);
    truncatedExtensionHeader[0] = 0x90;
    expect(() => parseRtpPacket(truncatedExtensionHeader)).toThrow(
      "Invalid RTP extension header",
    );

    const truncatedExtensionPayload = new Uint8Array(16);
    truncatedExtensionPayload[0] = 0x90;
    new DataView(truncatedExtensionPayload.buffer).setUint16(14, 1);
    expect(() => parseRtpPacket(truncatedExtensionPayload)).toThrow(
      "Invalid RTP payload offset",
    );
  });

  test("rejects invalid RTP padding boundaries", () => {
    const missingPaddingLength = new Uint8Array(12);
    missingPaddingLength[0] = 0xa0;
    expect(() => parseRtpPacket(missingPaddingLength)).toThrow("Invalid RTP padding");

    const excessivePadding = new Uint8Array(12);
    excessivePadding[0] = 0xa0;
    excessivePadding[11] = 13;
    expect(() => parseRtpPacket(excessivePadding)).toThrow(
      "Invalid RTP payload length",
    );
  });
});

describe("bidirectional voice policy", () => {
  test("preserves send-only defaults and opts into receive SDP/self-deaf state", () => {
    expect(voiceAudioSdpDirection(false)).toBe("inactive");
    expect(voiceAudioSdpDirection(true)).toBe("sendrecv");
    expect(voiceStateAudioFlags(false)).toEqual({ self_mute: false, self_deaf: true });
    expect(voiceStateAudioFlags(true)).toEqual({ self_mute: false, self_deaf: false });
  });

  test("maps an SSRC to its speaker and removes it on disconnect", () => {
    const streamer = new Streamer(new Client());
    const connection = new VoiceConnection(
      streamer,
      "guild-1",
      "bot-1",
      "channel-1",
      () => {},
      { receiveAudio: true },
    );
    const received: { userId: string; opus: Uint8Array }[] = [];
    connection.on("audio", ({ userId, opus }) => received.push({ userId, opus }));
    connection.handleSpeakingUpdate({
      speaking: 1,
      delay: 0,
      ssrc: 42,
      user_id: "speaker-1",
    });
    connection.handleIncomingAudioPacket(
      rtpPacket({ ssrc: 42, payload: [1, 2, 3] }),
    );
    expect(received).toEqual([
      { userId: "speaker-1", opus: new Uint8Array([1, 2, 3]) },
    ]);

    connection.handleClientDisconnect("speaker-1");
    connection.handleIncomingAudioPacket(
      rtpPacket({ ssrc: 42, payload: [4, 5, 6] }),
    );
    expect(received).toHaveLength(1);
  });

  test("prunes a speaker's stale SSRC on rejoin and clears all mappings on READY", () => {
    const streamer = new Streamer(new Client());
    const connection = new VoiceConnection(
      streamer,
      "guild-1",
      "bot-1",
      "channel-1",
      () => {},
      { receiveAudio: true },
    );
    const received: { userId: string }[] = [];
    connection.on("audio", ({ userId }) => received.push({ userId }));
    connection.handleSpeakingUpdate({
      speaking: 1,
      delay: 0,
      ssrc: 42,
      user_id: "speaker-1",
    });
    // speaker-1 rejoins with a fresh SSRC; Discord may recycle 42 for someone else without a
    // CLIENT_DISCONNECT, so the old row must not linger to mis-attribute their audio.
    connection.handleSpeakingUpdate({
      speaking: 1,
      delay: 0,
      ssrc: 43,
      user_id: "speaker-1",
    });
    connection.handleIncomingAudioPacket(
      rtpPacket({ ssrc: 42, payload: [1, 2, 3] }),
    );
    expect(received).toHaveLength(0);
    connection.handleIncomingAudioPacket(
      rtpPacket({ ssrc: 43, payload: [1, 2, 3] }),
    );
    expect(received).toEqual([{ userId: "speaker-1" }]);

    // A renegotiated session starts from a clean speaker table.
    connection.handleReady({
      ssrc: 1,
      ip: "127.0.0.1",
      port: 50_000,
      modes: [],
      experiments: [],
      streams: [{ ssrc: 2, rtx_ssrc: 3 }],
    });
    connection.handleIncomingAudioPacket(
      rtpPacket({ ssrc: 43, payload: [4, 5, 6] }),
    );
    expect(received).toHaveLength(1);
  });

  test("reports a malformed packet as audio_error instead of throwing", () => {
    const streamer = new Streamer(new Client());
    const connection = new VoiceConnection(
      streamer,
      "guild-1",
      "bot-1",
      "channel-1",
      () => {},
      { receiveAudio: true },
    );
    const errors: Error[] = [];
    connection.on("audio_error", (error) => errors.push(error));
    connection.handleIncomingAudioPacket(new Uint8Array(4));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("RTP");
  });

  test("decrypts and encrypts only across ready DAVE boundaries", () => {
    const opus = new Uint8Array([1, 2]);
    expect(
      prepareReceivedOpus({
        payload: opus,
        daveProtocolVersion: 0,
        daveReady: false,
      }),
    ).toBe(opus);
    expect(
      prepareReceivedOpus({
        payload: opus,
        daveProtocolVersion: 1,
        daveReady: false,
        decrypt: () => new Uint8Array([9]),
      }),
    ).toBeNull();
    expect(
      prepareReceivedOpus({
        payload: opus,
        daveProtocolVersion: 1,
        daveReady: true,
        decrypt: (payload) => new Uint8Array([...payload, 3]),
      }),
    ).toEqual(new Uint8Array([1, 2, 3]));

    const frame = Buffer.from([4, 5]);
    expect(prepareAssistantOpus(frame, false)).toBe(frame);
    expect(
      prepareAssistantOpus(frame, true, (payload) =>
        Buffer.concat([payload, Buffer.from([6])]),
      ),
    ).toEqual(Buffer.from([4, 5, 6]));
    expect(() => prepareAssistantOpus(frame, true)).toThrow("encryption session");
    expect(advanceRtpTimestamp(10_000, 20, 48_000)).toBe(10_960);
  });
});
