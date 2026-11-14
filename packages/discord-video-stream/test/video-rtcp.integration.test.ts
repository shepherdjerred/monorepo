import { afterEach, describe, expect, test } from "vitest";
import { Audio, Video, PeerConnection } from "@lng2004/node-datachannel";
import { Client } from "discord.js-selfbot-v13";
import { Streamer } from "../src/client/Streamer.js";
import { VoiceConnection } from "../src/client/voice/VoiceConnection.js";
import { CodecPayloadType } from "../src/client/voice/CodecPayloadType.js";

const cleanup: Array<() => unknown> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

function connection() {
  const client = new Client();
  const streamer = new Streamer(client);
  const voice = new VoiceConnection(streamer, "guild", "user", "channel", () => {});
  voice["_webRtcParams"] = {
    address: "127.0.0.1", port: 50_000, audioSsrc: 1110, videoSsrc: 1111, rtxSsrc: 1112, supportedEncryptionModes: [],
  };
  cleanup.push(() => client.destroy(), () => streamer.dispose(), () => voice.webRtcConn.close());
  return voice;
}

function deferred<T>() {
  let fulfill: (value: T) => void = () => { throw new Error("Promise was not initialized"); };
  const promise = new Promise<T>((resolve) => { fulfill = resolve; });
  return { promise, fulfill };
}

describe("native video feedback and repair", () => {
  test("routes NACK into the production packetizer chain and sends the requested packet over RTX", async () => {
    const voice = connection();
    const wrapper = voice.webRtcConn;
    const sender = wrapper.initWebRtc();
    wrapper.setPacketizer("H264");
    const receiver = new PeerConnection("receiver", { iceServers: [] });
    cleanup.push(() => receiver.close());
    const audio = new Audio("0", "SendRecv");
    audio.addOpusCodec(CodecPayloadType.opus.payload_type);
    receiver.addTrack(audio);
    const video = new Video("1", "SendRecv");
    video.addH264Codec(CodecPayloadType.H264.payload_type);
    video.addRTXCodec(CodecPayloadType.H264.rtx_payload_type, CodecPayloadType.H264.payload_type, 90_000);
    const sink = receiver.addTrack(video);
    const sourceOpened = deferred<void>();
    const sinkOpened = deferred<void>();
    const source = wrapper["_videoTrack"];
    if (source === undefined) throw new Error("Missing source video track");
    source.onOpen(() => sourceOpened.fulfill());
    sink.onOpen(() => sinkOpened.fulfill());
    const original = deferred<Buffer>();
    const retransmitted = deferred<Buffer>();
    sink.onMessage((packet) => {
      const payload = packet[1] & 0x7f;
      if (payload === CodecPayloadType.H264.payload_type) original.fulfill(packet);
      if (payload === CodecPayloadType.H264.rtx_payload_type) retransmitted.fulfill(packet);
    });
    const feedback: string[] = [];
    const dispose = wrapper.subscribeVideoFeedback((event) => feedback.push(event.type));
    const submissions: string[] = [];
    cleanup.push(wrapper.subscribeVideoSubmission((event) => submissions.push(event.outcome)));
    cleanup.push(dispose);
    sender.onLocalDescription((sdp, type) => receiver.setRemoteDescription(sdp, type));
    receiver.onLocalDescription((sdp, type) => sender.setRemoteDescription(sdp, type));
    sender.onLocalCandidate((candidate, mid) => receiver.addRemoteCandidate(candidate, mid));
    receiver.onLocalCandidate((candidate, mid) => sender.addRemoteCandidate(candidate, mid));
    sender.setLocalDescription();
    await Promise.all([sourceOpened.promise, sinkOpened.promise]);
    receiver.registerIncomingSsrc(1111, sink.mid());
    receiver.registerIncomingSsrc(1112, sink.mid());
    // The send path queues this asynchronously in native PacingHandler. A false native return
    // does not mean a dropped frame; assert actual RTP receipt instead.
    wrapper.sendVideoFrame(Buffer.from([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]), 1000 / 30);
    const first = await original.promise;
    expect(submissions).toEqual(["submitted"]);
    const nack = Buffer.alloc(16);
    nack[0] = 0x81;
    nack[1] = 205;
    nack.writeUInt16BE(3, 2);
    nack.writeUInt32BE(9999, 4);
    nack.writeUInt32BE(1111, 8);
    nack.writeUInt16BE(first.readUInt16BE(2), 12);
    sink.sendMessageBinary(nack);
    const repaired = await retransmitted.promise;
    expect(repaired.readUInt32BE(8)).toBe(1112);
    const headerLength = 12 + (repaired[0] & 0x0f) * 4;
    const extensionLength = repaired[0] & 0x10 ? 4 + repaired.readUInt16BE(headerLength + 2) * 4 : 0;
    expect(repaired.readUInt16BE(headerLength + extensionLength)).toBe(first.readUInt16BE(2));
    expect(sender.localDescription()?.sdp).toContain("a=ssrc-group:FID 1111 1112");
    await expect.poll(() => feedback).toContain("nack");
    dispose();
    const afterDispose = deferred<void>();
    cleanup.push(wrapper.subscribeVideoFeedback(() => afterDispose.fulfill()));
    const pli = Buffer.alloc(12);
    pli[0] = 0x81;
    pli[1] = 206;
    pli.writeUInt16BE(2, 2);
    pli.writeUInt32BE(1111, 8);
    sink.sendMessageBinary(pli);
    await afterDispose.promise;
    expect(feedback).toEqual(["nack"]);
  }, 10_000);

  test("reconnect rebuilds descriptions and live audio/video packetizers for the new SSRCs", async () => {
    const voice = connection();
    const first = voice.webRtcConn.initWebRtc();
    voice.webRtcConn.setPacketizer("H264", 730);
    const previousPacketizer = voice.webRtcConn["_videoPacketizer"];
    first.setLocalDescription();
    expect(first.localDescription()?.sdp).toContain("a=ssrc-group:FID 1111 1112");
    first.close();
    const params = voice.webRtcParams;
    if (params === null) throw new Error("Missing test WebRTC parameters");
    voice["_webRtcParams"] = { ...params, audioSsrc: 2220, videoSsrc: 2221, rtxSsrc: 2222 };
    const next = voice.webRtcConn.initWebRtc();
    const receiver = new PeerConnection("replacement-receiver", { iceServers: [] });
    cleanup.push(() => receiver.close());
    const audio = new Audio("0", "SendRecv");
    audio.addOpusCodec(CodecPayloadType.opus.payload_type);
    const audioSink = receiver.addTrack(audio);
    const video = new Video("1", "SendRecv");
    video.addH264Codec(CodecPayloadType.H264.payload_type);
    const videoSink = receiver.addTrack(video);
    const ready = deferred<void>();
    const videoOpened = deferred<void>();
    const sourceVideo = voice.webRtcConn["_videoTrack"];
    if (sourceVideo === undefined) throw new Error("Missing source video track");
    videoSink.onOpen(() => ready.fulfill());
    sourceVideo.onOpen(() => videoOpened.fulfill());
    const audioPacket = deferred<Buffer>();
    const videoPacket = deferred<Buffer>();
    audioSink.onMessage((packet) => {
      if ((packet[1] & 0x7f) === CodecPayloadType.opus.payload_type) audioPacket.fulfill(packet);
    });
    videoSink.onMessage((packet) => {
      if ((packet[1] & 0x7f) === CodecPayloadType.H264.payload_type) videoPacket.fulfill(packet);
    });
    next.onLocalDescription((sdp, type) => receiver.setRemoteDescription(sdp, type));
    receiver.onLocalDescription((sdp, type) => next.setRemoteDescription(sdp, type));
    next.onLocalCandidate((candidate, mid) => receiver.addRemoteCandidate(candidate, mid));
    receiver.onLocalCandidate((candidate, mid) => next.addRemoteCandidate(candidate, mid));
    next.setLocalDescription();
    const description = next.localDescription()?.sdp;
    expect(description).toContain("a=ssrc-group:FID 2221 2222");
    expect(description).not.toContain("a=ssrc:1111");
    expect(description).not.toContain("a=ssrc:1112");
    expect(description).not.toContain("a=ssrc:1110");
    expect(voice.webRtcConn["_videoPacketizer"]).not.toBe(previousPacketizer);
    expect(voice.webRtcConn["_videoPacketizer"]?.rtpConfig.playoutDelayMax).toBe(73);
    await Promise.all([ready.promise, videoOpened.promise]);
    receiver.registerIncomingSsrc(2220, audioSink.mid());
    receiver.registerIncomingSsrc(2221, videoSink.mid());
    voice.webRtcConn.sendAudioFrame(Buffer.from([0xf8, 0xff, 0xfe]), 20);
    voice.webRtcConn.sendVideoFrame(Buffer.from([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]), 1000 / 30);
    expect((await audioPacket.promise).readUInt32BE(8)).toBe(2220);
    expect((await videoPacket.promise).readUInt32BE(8)).toBe(2221);
  }, 10_000);
});
