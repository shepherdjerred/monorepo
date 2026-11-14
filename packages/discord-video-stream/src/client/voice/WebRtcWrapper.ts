import {
  PeerConnection,
  Audio,
  Video,
  PacingHandler,
  RtpPacketizer,
  H264RtpPacketizer,
  H265RtpPacketizer,
  AV1RtpPacketizer,
  RtpPacketizationConfig,
  RtcpNackResponder,
  RtcpReceivingSession,
  RtcpSrReporter,
  type MediaHandler,
  type Track,
} from "@lng2004/node-datachannel";
import { CodecPayloadType } from "./CodecPayloadType.js";
import { normalizeVideoCodec, type SupportedVideoCodec } from "../../utils.js";
import {
  splitNalu,
  H264Helpers,
  H264NalUnitTypes,
  startCode3,
} from "../processing/AnnexBHelper.js";
import { rewriteSPSVUI } from "../processing/SPSVUIRewriter.js";
import type { BaseMediaConnection } from "./BaseMediaConnection.js";
import { parseVideoFeedback, type VideoFeedback, type VideoSubmission } from "./VideoFeedback.js";

/**
 * Fail loud if the loaded @lng2004/node-datachannel binding lacks the patched
 * `PeerConnection.registerIncomingSsrc` method. That method is what routes a
 * Discord speaker's lazily-announced SSRC to the audio track; without it,
 * inbound voice is silently dropped (the exact production bug this fork fixes).
 * A node-datachannel version bump that invalidated the vendored patched prebuild
 * — or a botched install that fell back to the registry's unpatched binary —
 * would otherwise regress receive to silently-broken. Call this once at startup
 * wherever voice receive is enabled.
 */
export function assertIncomingAudioSupported(): void {
  const ctor: unknown = PeerConnection;
  const prototype =
    typeof ctor === "function" ? Reflect.get(ctor, "prototype") : undefined;
  const method =
    typeof prototype === "object" && prototype !== null
      ? Reflect.get(prototype, "registerIncomingSsrc")
      : undefined;
  if (typeof method !== "function") {
    throw new Error(
      "@lng2004/node-datachannel is missing PeerConnection.registerIncomingSsrc: " +
        "the patched prebuild was not installed, so Discord voice receive would be " +
        "silently broken. Verify the node-datachannel entry in patchedDependencies " +
        "(overlay of packages/discord-video-stream/prebuilds-patched) applied for this platform.",
    );
  }
}

// The playout-delay header extension carries min/max as 12-bit fields counted
// in 10ms units (0..40950ms). https://webrtc.googlesource.com/src/+/main/docs/native-code/rtp-hdrext/playout-delay
const PLAYOUT_DELAY_UNIT_MS = 10;
const PLAYOUT_DELAY_MAX_UNITS = 0xfff;
const DEFAULT_VIDEO_PLAYOUT_DELAY_MAX_MS = 100;

/** Milliseconds -> the extension's 10ms units, rejecting unrepresentable values. */
function toPlayoutDelayUnits(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`playout delay must be a non-negative number, got ${ms}`);
  }
  const units = Math.round(ms / PLAYOUT_DELAY_UNIT_MS);
  if (units > PLAYOUT_DELAY_MAX_UNITS) {
    throw new RangeError(
      `playout delay ${ms}ms exceeds the ${PLAYOUT_DELAY_MAX_UNITS * PLAYOUT_DELAY_UNIT_MS}ms the extension can encode`,
    );
  }
  return units;
}

const DAVE_MEDIA_TYPE_VIDEO = 1;
const DAVE_CODEC = {
  UNKNOWN: 0,
  VP8: 2,
  VP9: 3,
  H264: 4,
  H265: 5,
  AV1: 6,
} as const;

export function prepareAssistantOpus(
  frame: Buffer,
  daveReady: boolean,
  encrypt?: (payload: Buffer) => Buffer,
): Buffer {
  if (!daveReady) return frame;
  if (encrypt === undefined) {
    throw new Error("DAVE audio is ready without an encryption session");
  }
  return encrypt(frame);
}

export function advanceRtpTimestamp(
  timestamp: number,
  frametimeMs: number,
  clockRate: number,
): number {
  return timestamp + Math.round((frametimeMs * clockRate) / 1000);
}

export class WebRtcConnWrapper {
  private _mediaConn: BaseMediaConnection;

  private _webRtcConn?: PeerConnection;
  private _audioDef?: Audio;
  private _audioTrack?: Track;
  private _videoTrack?: Track;
  private _audioPacketizer?: RtpPacketizer;
  // Receive depacketization wraps the outbound audio chain; sending-only tracks bind the
  // packetizer directly. Rebuild this together with the packetizer on transport replacement.
  private _audioMediaHandler?: MediaHandler;
  private _videoPacketizer?: RtpPacketizer;
  private _videoCodec?: SupportedVideoCodec;
  private _videoPlayoutDelayMaxMs = DEFAULT_VIDEO_PLAYOUT_DELAY_MAX_MS;
  private readonly _videoFeedbackListeners = new Set<(event: VideoFeedback) => void>();
  private readonly _videoSubmissionListeners = new Set<(event: VideoSubmission) => void>();

  constructor(mediaConn: BaseMediaConnection) {
    this._mediaConn = mediaConn;
  }

  public initWebRtc() {
    const params = this._mediaConn.webRtcParams;
    if (params === undefined || params === null) throw new Error("WebRTC parameters not set");
    // addTrack copies each description. Declare the negotiated outbound SSRCs BEFORE that copy:
    // native RTCP dispatch uses these mappings, and the NACK responder needs FID to generate RTX
    // rather than replaying the original SRTP sequence. Fresh descriptions avoid stale SSRCs after
    // reconnect. Without this, RR/NACK/PLI are silently discarded while sends still look healthy.
    this._audioDef = new Audio("0", "SendRecv");
    this._audioDef.addOpusCodec(CodecPayloadType.opus.payload_type);
    this._audioDef.addSSRC(params.audioSsrc);
    const videoDef = new Video("1", "SendRecv");
    videoDef.addSSRC(params.videoSsrc);
    videoDef.addSSRC(params.rtxSsrc);
    videoDef.parseSdpLine(`a=ssrc-group:FID ${params.videoSsrc} ${params.rtxSsrc}`);
    for (const {
      name,
      payload_type,
      rtx_payload_type,
      clockRate,
    } of Object.values(CodecPayloadType).filter((el) => el.type === "video")) {
      switch (name) {
        case "H264":
          videoDef.addH264Codec(payload_type);
          break;
        case "H265":
          videoDef.addH265Codec(payload_type);
          break;
        case "VP8":
          videoDef.addVP8Codec(payload_type);
          break;
        case "VP9":
          videoDef.addVP9Codec(payload_type);
          break;
        case "AV1":
          videoDef.addAV1Codec(payload_type);
          break;
      }
      videoDef.addRTXCodec(rtx_payload_type, payload_type, clockRate);
    }
    const peer = new PeerConnection("", {
      iceServers: ["stun:stun.l.google.com:19302"],
    });
    this._webRtcConn = peer;
    this._audioTrack = peer.addTrack(this._audioDef);
    if (this._mediaConn.receiveAudio) {
      this._audioTrack.onMessage((packet) => {
        this._mediaConn.handleIncomingAudioPacket(packet);
      });
    }
    this._videoTrack = peer.addTrack(videoDef);
    this._videoTrack.onMessage((packet) => {
      if (this._webRtcConn !== peer || this._videoFeedbackListeners.size === 0) return;
      for (const event of parseVideoFeedback(packet, params.videoSsrc)) {
        for (const listener of this._videoFeedbackListeners) listener(event);
      }
    });
    // A transport reconnect may renegotiate every SSRC while the playback segment remains alive.
    // Its packetizers must match the new descriptions, not keep writing the previous source IDs.
    if (this._videoCodec !== undefined) {
      this.setPacketizer(this._videoCodec, this._videoPlayoutDelayMaxMs);
    } else if (this._audioPacketizer !== undefined) {
      this.setAudioPacketizer();
    }
    return this._webRtcConn;
  }

  /** Segment-owned subscriptions survive transport reconnects and must be disposed on teardown. */
  public subscribeVideoFeedback(listener: (event: VideoFeedback) => void): () => void {
    this._videoFeedbackListeners.add(listener);
    return () => { this._videoFeedbackListeners.delete(listener); };
  }

  public subscribeVideoSubmission(listener: (event: VideoSubmission) => void): () => void {
    this._videoSubmissionListeners.add(listener);
    return () => { this._videoSubmissionListeners.delete(listener); };
  }

  private _reportVideoSubmission(outcome: VideoSubmission["outcome"]): void {
    for (const listener of this._videoSubmissionListeners) listener({ outcome });
  }

  private _setMediaHandler() {
    const audioHandler = this._audioMediaHandler ?? this._audioPacketizer;
    if (audioHandler) this._audioTrack?.setMediaHandler(audioHandler);
    if (this._videoPacketizer)
      this._videoTrack?.setMediaHandler(this._videoPacketizer);
  }

  /**
   * Register a remote speaker's audio SSRC so libdatachannel routes its incoming
   * RTP to our audio track. Discord announces each speaker's SSRC lazily over the
   * gateway (the SPEAKING op), not in the SDP, so without this the transport
   * demuxes the packet, finds no track owning the SSRC, and drops it before any
   * media handler runs.
   */
  public registerIncomingAudioSsrc(ssrc: number): void {
    const mid = this._audioTrack?.mid();
    if (this._webRtcConn === undefined || mid === undefined) return;
    // Map the speaker's SSRC to our audio track in libdatachannel's live routing
    // table. libdatachannel only builds that table from the SDP at negotiation
    // time and drops RTP whose SSRC it doesn't recognise; Discord announces
    // speaker SSRCs lazily over the gateway, so we register each one here as it
    // is learned. Keeping the description SSRC in sync lets any later
    // renegotiation rebuild the same mapping.
    if (this._audioDef === undefined) throw new Error("Audio track definition not set");
    if (!this._audioDef.hasSSRC(ssrc)) this._audioDef.addSSRC(ssrc);
    this._webRtcConn.registerIncomingSsrc(ssrc, mid);
  }

  public close() {
    this._videoFeedbackListeners.clear();
    this._videoSubmissionListeners.clear();
    this._webRtcConn?.close();
  }

  public get webRtcConn() {
    return this._webRtcConn;
  }

  public get ready() {
    return this._webRtcConn?.state() === "connected";
  }

  /** Whether normal voice media is currently protected by a ready DAVE session. */
  public get daveReady(): boolean {
    return this._mediaConn.daveReady;
  }

  public get mediaConnection() {
    return this._mediaConn;
  }

  /**
   * @returns whether the frame reached the transport. `false` means it was dropped on the floor:
   *   the peer connection is not connected yet, or no audio packetizer is installed (the join did
   *   not ask for `receiveAudio`/`sendAudio`, see {@link ../Streamer.js VoiceJoinOptions}). Both
   *   are silent failures from the sender's point of view — the pacer keeps feeding frames at
   *   realtime and playback reports a clean end — so callers that own a whole track should treat a
   *   run of `false` as a failed segment rather than as playback.
   */
  public sendAudioFrame(frame: Buffer, frametime: number): boolean {
    if (!this.ready) return false;
    if (!this._audioPacketizer) return false;
    const { rtpConfig } = this._audioPacketizer;
    const { clockRate } = rtpConfig;
    const daveSession = this.mediaConnection.daveSession;
    frame = prepareAssistantOpus(
      frame,
      Boolean(this.mediaConnection.daveReady),
      daveSession === undefined
        ? undefined
        : (payload) => daveSession.encryptOpus(payload),
    );
    this._audioTrack?.sendMessageBinary(frame);
    rtpConfig.timestamp = advanceRtpTimestamp(
      rtpConfig.timestamp,
      frametime,
      clockRate,
    );
    return true;
  }

  public setAudioPacketizer(): void {
    if (!this.mediaConnection.webRtcParams)
      throw new Error("WebRTC connection not ready");
    const rtpConfig = new RtpPacketizationConfig(
      this.mediaConnection.webRtcParams.audioSsrc,
      "streambot-assistant",
      CodecPayloadType.opus.payload_type,
      CodecPayloadType.opus.clockRate,
    );
    this._audioPacketizer = new RtpPacketizer(rtpConfig);
    this._audioPacketizer.addToChain(new RtcpSrReporter(rtpConfig));
    this._audioPacketizer.addToChain(new RtcpNackResponder());
    this._setAudioMediaHandler();
    this._setMediaHandler();
  }

  private _setAudioMediaHandler(): void {
    if (this._audioPacketizer === undefined) throw new Error("Audio packetizer not set");
    // Receive depacketization belongs ahead of the outbound packetizer. Rebuild this root when
    // replacing the packetizer so it cannot retain a previous transport's RTP source or clock.
    if (this._mediaConn.receiveAudio) {
      const receivingSession = new RtcpReceivingSession();
      receivingSession.addToChain(this._audioPacketizer);
      this._audioMediaHandler = receivingSession;
    } else {
      this._audioMediaHandler = this._audioPacketizer;
    }
  }

  public sendVideoFrame(frame: Buffer, frametime: number) {
    if (!this.ready) { this._reportVideoSubmission("not-ready"); return; }
    if (!this._videoPacketizer) { this._reportVideoSubmission("missing-packetizer"); return; }
    if (!this._videoTrack) { this._reportVideoSubmission("missing-track"); return; }
    const { rtpConfig } = this._videoPacketizer;
    const { clockRate } = rtpConfig;
    if (this._videoCodec === "H264") {
      let spsRewritten = false;
      const nalus = splitNalu(frame).map((el) => {
        if (H264Helpers.getUnitType(el) === H264NalUnitTypes.SPS) {
          spsRewritten = true;
          return rewriteSPSVUI(el);
        }
        return el;
      });
      if (spsRewritten)
        frame = Buffer.concat(nalus.flatMap((el) => [startCode3, el]));
    }
    const daveSession = this.mediaConnection.daveSession;
    if (this.mediaConnection.daveReady && daveSession) {
      let daveCodec: number = DAVE_CODEC.UNKNOWN;
      switch (this._videoCodec) {
        case "H264":
          daveCodec = DAVE_CODEC.H264;
          break;
        case "H265":
          daveCodec = DAVE_CODEC.H265;
          break;
        case "VP8":
          daveCodec = DAVE_CODEC.VP8;
          break;
        case "VP9":
          daveCodec = DAVE_CODEC.VP9;
          break;
        case "AV1":
          daveCodec = DAVE_CODEC.AV1;
          break;
      }
      frame = daveSession.encrypt(DAVE_MEDIA_TYPE_VIDEO, daveCodec, frame);
    }
    try {
      // PacingHandler moves RTP into its asynchronous queue and returns false even on healthy
      // sends. Record the submission, never reinterpret that boolean as delivery failure.
      this._videoTrack.sendMessageBinary(frame);
    } catch (error) {
      this._reportVideoSubmission("error");
      throw error;
    }
    this._reportVideoSubmission("submitted");
    rtpConfig.timestamp += Math.round((frametime * clockRate) / 1000);
  }

  /**
   * @param videoPlayoutDelayMaxMs Upper bound advertised to the receiver via the
   *   `playout-delay` RTP header extension, in milliseconds. Receivers size their
   *   jitter buffer within [min, max]; Chrome sits at the ceiling on a clean
   *   link, so this value is close to a floor on the client-side delay an
   *   interactive stream pays. Defaults to 100 ms — the historical value — so
   *   existing consumers are unaffected. Lower it only when the link is known
   *   to be low-jitter: less headroom means a burst of jitter becomes a visible
   *   freeze instead of being absorbed.
   */
  public setPacketizer(
    videoCodec: string,
    videoPlayoutDelayMaxMs = DEFAULT_VIDEO_PLAYOUT_DELAY_MAX_MS,
  ): void {
    if (!this.mediaConnection.webRtcParams)
      throw new Error("WebRTC connection not ready");
    this._videoPlayoutDelayMaxMs = videoPlayoutDelayMaxMs;
    const { audioSsrc, videoSsrc } = this.mediaConnection.webRtcParams;
    const rtpConfigAudio = new RtpPacketizationConfig(
      audioSsrc,
      "",
      CodecPayloadType.opus.payload_type,
      CodecPayloadType.opus.clockRate,
    );
    rtpConfigAudio.playoutDelayId = 5;
    rtpConfigAudio.playoutDelayMin = 0;
    rtpConfigAudio.playoutDelayMax = 1;
    this._audioPacketizer = new RtpPacketizer(rtpConfigAudio);
    this._audioPacketizer.addToChain(new RtcpSrReporter(rtpConfigAudio));
    this._audioPacketizer.addToChain(new RtcpNackResponder());

    this._videoCodec = normalizeVideoCodec(videoCodec);
    const rtpConfigVideo = new RtpPacketizationConfig(
      videoSsrc,
      "",
      CodecPayloadType[this._videoCodec].payload_type,
      CodecPayloadType[this._videoCodec].clockRate,
    );
    rtpConfigVideo.playoutDelayId = 5;
    rtpConfigVideo.playoutDelayMin = 0;
    rtpConfigVideo.playoutDelayMax = toPlayoutDelayUnits(
      videoPlayoutDelayMaxMs,
    );
    switch (this._videoCodec) {
      case "H264":
        this._videoPacketizer = new H264RtpPacketizer(
          "StartSequence",
          rtpConfigVideo,
        );
        break;
      case "H265":
        this._videoPacketizer = new H265RtpPacketizer(
          "StartSequence",
          rtpConfigVideo,
        );
        break;
      case "AV1":
        this._videoPacketizer = new AV1RtpPacketizer("Obu", rtpConfigVideo);
        break;
      default:
        throw new Error(`Packetizer not implemented for ${this._videoCodec}`);
    }
    this._videoPacketizer.addToChain(new RtcpSrReporter(rtpConfigVideo));
    this._videoPacketizer.addToChain(new RtcpNackResponder());
    this._videoPacketizer.addToChain(new PacingHandler(25 * 1000 * 1000, 1));

    this._setAudioMediaHandler();
    this._setMediaHandler();
  }
}
