import Davey from "@snazzah/davey";
import EventEmitter from "node:events";
import { Log } from "debug-level";
import { randomUUID } from "node:crypto";
import { CodecPayloadType } from "./CodecPayloadType.js";
import { WebRtcConnWrapper } from "./WebRtcWrapper.js";
import { VoiceOpCodes, VoiceOpCodesBinary } from "./VoiceOpCodes.js";
import {
  STREAMS_SIMULCAST,
  type SupportedEncryptionModes,
} from "../../utils.js";
import type {
  Message,
  GatewayRequest,
  GatewayResponse,
} from "./VoiceMessageTypes.js";
import type { Streamer } from "../Streamer.js";

type VoiceConnectionStatus = {
  hasSession: boolean;
  hasToken: boolean;
  started: boolean;
  resuming: boolean;
};

type WebRtcParameters = {
  address: string;
  port: number;
  audioSsrc: number;
  videoSsrc: number;
  rtxSsrc: number;
  supportedEncryptionModes: SupportedEncryptionModes[];
};

type ValueOf<T> = T extends (infer U)[]
  ? U
  : T extends Record<string, infer U>
    ? U
    : never;

export type VideoAttributes = {
  width: number;
  height: number;
  fps: number;
};

/**
 * Payload of the `close` event, emitted when the voice gateway websocket closes and the
 * connection will NOT internally resume (i.e. the connection is dead). `deliberate` marks
 * Discord's 4014 "disconnected" close — sent when the client is removed from the channel
 * (e.g. a moderator disconnect) — as opposed to session loss (4006, network failures, ...).
 */
export type MediaConnectionCloseInfo = {
  code: number;
  canResume: boolean;
  deliberate: boolean;
};

type MediaConnectionEvents = {
  select_protocol_ack: [];
  close: [MediaConnectionCloseInfo];
  audio: [ReceivedVoiceAudio];
  audio_error: [Error];
};

export type ReceivedVoiceAudio = {
  userId: string;
  ssrc: number;
  opus: Uint8Array;
};

export type MediaConnectionOptions = {
  receiveAudio?: boolean;
};

export function voiceAudioSdpDirection(receiveAudio: boolean): "sendrecv" | "inactive" {
  return receiveAudio ? "sendrecv" : "inactive";
}

export function prepareReceivedOpus(options: {
  payload: Uint8Array;
  daveProtocolVersion: number;
  daveReady: boolean;
  decrypt?: (payload: Uint8Array) => Uint8Array;
}): Uint8Array | null {
  if (options.daveProtocolVersion === 0) return options.payload;
  if (!options.daveReady || options.decrypt === undefined) return null;
  return options.decrypt(options.payload);
}

/** The subset of the WebSocket surface the voice gateway uses — narrow so tests can inject a fake. */
export type VoiceGatewaySocket = Pick<
  WebSocket,
  "binaryType" | "readyState" | "send" | "close" | "addEventListener"
>;

export abstract class BaseMediaConnection extends EventEmitter<MediaConnectionEvents> {
  private interval: NodeJS.Timeout | null = null;
  public guildId: string | null = null;
  public channelId: string;
  public botId: string;
  public ws: VoiceGatewaySocket | null = null;
  public status: VoiceConnectionStatus;
  public server: string | null = null; //websocket url
  public token: string | null = null;
  public session_id: string | null = null;

  private _webRtcWrapper;
  private _webRtcParams: WebRtcParameters | null = null;
  private _closed = false;
  private _deliberateCloseEmitted = false;
  public ready: (conn: WebRtcConnWrapper) => void;

  private _streamer: Streamer;
  private _sequenceNumber = -1;

  private _daveSession: Davey.DaveSession | undefined;
  private _connectedUsers = new Set<string>();
  private _daveProtocolVersion = 0;
  private _davePendingTransitions = new Map<number, number>();
  private _daveDowngraded = false;
  private readonly _receiveAudio: boolean;
  private readonly _audioUsersBySsrc = new Map<number, string>();

  private _logger = new Log("conn");
  private _loggerDave = new Log("conn:dave");
  constructor(
    streamer: Streamer,
    guildId: string | null,
    botId: string,
    channelId: string,
    callback: (conn: WebRtcConnWrapper) => void,
    options: MediaConnectionOptions = {},
  ) {
    super();
    this._streamer = streamer;
    this.status = {
      hasSession: false,
      hasToken: false,
      started: false,
      resuming: false,
    };

    this.guildId = guildId;
    this.channelId = channelId;
    this.botId = botId;
    this.ready = callback;
    this._receiveAudio = options.receiveAudio ?? false;
    this._webRtcWrapper = new WebRtcConnWrapper(this);
  }

  public abstract get serverId(): string | null;

  public get type(): "guild" | "call" {
    return this.guildId ? "guild" : "call";
  }

  public get webRtcConn() {
    return this._webRtcWrapper;
  }

  public get webRtcParams() {
    return this._webRtcParams;
  }

  public get streamer() {
    return this._streamer;
  }

  public get receiveAudio(): boolean {
    return this._receiveAudio;
  }

  public abstract get daveChannelId(): string;

  stop(): void {
    this._closed = true;
    this._webRtcWrapper.close();
    this.ws?.close();
    this._audioUsersBySsrc.clear();
  }

  /** Seam for tests to inject a fake websocket; production returns a real one. */
  protected createWebSocket(url: string): VoiceGatewaySocket {
    return new WebSocket(url);
  }

  setSession(session_id: string): void {
    this.session_id = session_id;

    this.status.hasSession = true;
    this.start();
  }

  setTokens(server: string, token: string): void {
    this.token = token;
    this.server = server;

    this.status.hasToken = true;
    this.start();
  }

  start(): void {
    /*
     ** Connection can only start once both
     ** session description and tokens have been gathered
     */
    if (this.status.hasSession && this.status.hasToken) {
      if (this.status.started) return;
      this.status.started = true;

      this.ws = this.createWebSocket(`wss://${this.server}/?v=8`);
      this.ws.binaryType = "arraybuffer";
      this.ws.addEventListener("open", () => {
        if (this.status.resuming) {
          this.status.resuming = false;
          this.resume();
        } else {
          this.identify();
        }
      });
      this.ws.addEventListener("error", (err) => {
        this._logger.error({ err }, "voice gateway websocket error");
      });
      this.ws.addEventListener("close", (e) => {
        const wasStarted = this.status.started;

        this.interval && clearInterval(this.interval);
        this.status.started = false;
        const canResume = e.code === 4_015 || e.code < 4_000;

        // A locally-initiated stop() closes the ws with a resumable-looking code (1000/1005);
        // without this guard that close spawned a phantom resume socket after every normal stop.
        // Discord's 4014 can race behind that local teardown when a moderator disconnect reaches
        // the command gateway first. Surface that deliberate close exactly once so callers can
        // cancel a pending reconnect, while continuing to suppress the local socket close.
        if (this._closed) {
          if (e.code === 4_014 && !this._deliberateCloseEmitted) {
            this._deliberateCloseEmitted = true;
            this.emit("close", {
              code: e.code,
              canResume,
              deliberate: true,
            });
          }
          this._logger.info(
            { code: e.code },
            "voice gateway websocket closed after local stop",
          );
          return;
        }

        const resuming = canResume && wasStarted;
        this._logger.info(
          { code: e.code, canResume, wasStarted, resuming },
          "voice gateway websocket closed",
        );
        if (resuming) {
          this.status.resuming = true;
          this.start();
        } else {
          this._closed = true;
          this._webRtcWrapper?.close();
          this._deliberateCloseEmitted = e.code === 4_014;
          this.emit("close", {
            code: e.code,
            canResume,
            deliberate: e.code === 4_014,
          });
        }
      });
      this.setupEvents();
    }
  }

  handleReady(d: Message.Ready): void {
    // we hardcoded the STREAMS_SIMULCAST, which will always be array of 1
    const stream = d.streams[0];
    if (stream === undefined) throw new Error("Voice READY had no stream");
    this._webRtcParams = {
      address: d.ip,
      port: d.port,
      audioSsrc: d.ssrc,
      videoSsrc: stream.ssrc,
      rtxSsrc: stream.rtx_ssrc,
      supportedEncryptionModes: d.modes,
    };
  }

  async handleProtocolAck(d: Message.SelectProtocolAck) {
    if (!("sdp" in d)) throw new Error("Only WebRTC connections are allowed");
    this._daveProtocolVersion = d.dave_protocol_version;
    this.initDave();
    // Discord's SDP is absolute garbage...Generate one ourselves
    let ip = "",
      port = "",
      iceUsername = "",
      icePassword = "",
      fingerprint = "",
      candidate = "";
    for (const line of d.sdp.split("\n")) {
      if (line.startsWith("c=")) ip = line;
      else if (line.startsWith("a=rtcp")) {
        const rtcpPort = line.split(":")[1];
        if (rtcpPort !== undefined) port = rtcpPort;
      }
      else if (line.startsWith("a=ice-ufrag")) iceUsername = line;
      else if (line.startsWith("a=ice-pwd")) icePassword = line;
      else if (line.startsWith("a=fingerprint")) fingerprint = line;
      else if (line.startsWith("a=candidate")) candidate = line;
    }
    const audioPayloadType = CodecPayloadType.opus.payload_type;
    const audioSection = `
m=audio ${port} UDP/TLS/RTP/SAVPF ${audioPayloadType}
${ip}
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=setup:passive
a=mid:0
a=maxptime:60
a=${voiceAudioSdpDirection(this._receiveAudio)}
${iceUsername}
${icePassword}
${fingerprint}
${candidate}
a=rtcp-mux
a=rtpmap:${audioPayloadType} opus/48000/2
a=fmtp:${audioPayloadType} minptime=10;useinbandfec=1;usedtx=1
a=rtcp-fb:${audioPayloadType} transport-cc
a=rtcp-fb:${audioPayloadType} nack
a=ice-lite
`.trim();
    const videoPayloads = Object.values(CodecPayloadType).filter(
      (el) => el.type === "video",
    );
    const videoPayloadTypes = videoPayloads.flatMap((el) => [
      el.payload_type,
      el.rtx_payload_type,
    ]);
    const videoSection = `
m=video ${port} UDP/TLS/RTP/SAVPF ${videoPayloadTypes.join(" ")}
${ip}
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:13 urn:3gpp:video-orientation
a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=setup:passive
a=mid:1
a=inactive
${iceUsername}
${icePassword}
${fingerprint}
${candidate}
a=rtcp-mux
a=ice-lite
`.trim();
    const videoRtpMap = videoPayloads
      .flatMap((el) => [
        `a=rtpmap:${el.payload_type} ${el.name}/90000`,
        `a=rtpmap:${el.rtx_payload_type} rtx/90000`,
        `a=fmtp:${el.rtx_payload_type} apt=${el.payload_type}`,
        `a=rtcp-fb:${el.payload_type} ccm fir`,
        `a=rtcp-fb:${el.payload_type} nack`,
        `a=rtcp-fb:${el.payload_type} nack pli`,
        `a=rtcp-fb:${el.payload_type} goog-remb`,
        `a=rtcp-fb:${el.payload_type} transport-cc`,
      ])
      .join("\n");
    this._webRtcWrapper.webRtcConn?.setRemoteDescription(
      [audioSection, videoSection, videoRtpMap].join("\n"),
      "answer",
    );
    this.emit("select_protocol_ack");
  }

  initDave() {
    if (this._daveProtocolVersion) {
      if (this._daveSession) {
        this._daveSession.reinit(
          this._daveProtocolVersion,
          this.botId,
          this.daveChannelId,
        );
        this._loggerDave.debug(`Reinitialized DAVE`, {
          user_id: this.botId,
          channel_id: this.daveChannelId,
        });
      } else {
        this._daveSession = new Davey.DAVESession(
          this._daveProtocolVersion,
          this.botId,
          this.daveChannelId,
        );
        this._loggerDave.debug(`Initialized DAVE`, {
          user_id: this.botId,
          channel_id: this.daveChannelId,
        });
      }
      this.sendOpcodeBinary(
        VoiceOpCodesBinary.MLS_KEY_PACKAGE,
        this._daveSession.getSerializedKeyPackage(),
      );
    } else if (this._daveSession) {
      this._daveSession.reset();
      this._daveSession.setPassthroughMode(true, 10);
    }
  }

  processInvalidCommit(transitionId: number) {
    this._loggerDave.debug("Invalid commit received, reinitializing DAVE", {
      transitionId,
    });
    this.sendOpcode(VoiceOpCodes.MLS_INVALID_COMMIT_WELCOME, {
      transition_id: transitionId,
    });
    this.initDave();
  }

  executePendingTransition(transitionId: number) {
    const newVersion = this._davePendingTransitions.get(transitionId);
    if (newVersion === undefined) {
      this._loggerDave.error("Unrecognized transition ID", { transitionId });
      return;
    }
    const oldVersion = this._daveProtocolVersion;
    this._daveProtocolVersion = newVersion;

    if (oldVersion !== newVersion && newVersion === 0) {
      // Downgraded
      this._daveDowngraded = true;
      this._loggerDave.debug("Downgraded to non-E2E voice call");
    } else if (transitionId > 0 && this._daveDowngraded) {
      this._daveDowngraded = false;
      this._daveSession?.setPassthroughMode(true, 10);
      this._loggerDave.debug("Upgraded to E2E voice call");
    }

    this._davePendingTransitions.delete(transitionId);
    this._loggerDave.debug(`Pending transition ID ${transitionId} executed`, {
      transitionId,
    });
  }

  setupEvents(): void {
    this.ws?.addEventListener("message", async (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.handleBinaryMessages(Buffer.from(e.data));
        return;
      }
      const { op, d, seq } = JSON.parse(e.data as string) as GatewayResponse;
      if (seq) this._sequenceNumber = seq;

      if (op === VoiceOpCodes.READY) {
        // ready
        this.handleReady(d);
        this.setProtocols().then(() => this.ready(this._webRtcWrapper));
        this.setVideoAttributes(false);
      } else if (op >= 4000) {
        console.error(`Error ${this.constructor.name} connection`, d);
      } else if (op === VoiceOpCodes.HELLO) {
        this.setupHeartbeat(d.heartbeat_interval);
      } else if (op === VoiceOpCodes.SELECT_PROTOCOL_ACK) {
        // session description
        this.handleProtocolAck(d);
      } else if (op === VoiceOpCodes.SPEAKING) {
        this.handleSpeakingUpdate(d);
      } else if (op === VoiceOpCodes.HEARTBEAT_ACK) {
        // ignore heartbeat acknowledgements
      } else if (op === VoiceOpCodes.RESUMED) {
        this.status.started = true;
      } else if (op === VoiceOpCodes.CLIENTS_CONNECT) {
        d.user_ids.forEach((id) => {
          this._connectedUsers.add(id);
        });
      } else if (op === VoiceOpCodes.CLIENT_DISCONNECT) {
        this._connectedUsers.delete(d.user_id);
        this.handleClientDisconnect(d.user_id);
      } else if (op === VoiceOpCodes.DAVE_PREPARE_TRANSITION) {
        this._loggerDave.debug("Preparing for DAVE transition", d);
        this._davePendingTransitions.set(d.transition_id, d.protocol_version);
        if (d.transition_id === 0) {
          this.executePendingTransition(d.transition_id);
        } else {
          if (d.protocol_version === 0)
            this._daveSession?.setPassthroughMode(true, 120);
          this.sendOpcode(VoiceOpCodes.DAVE_TRANSITION_READY, {
            transition_id: d.transition_id,
          });
        }
      } else if (op === VoiceOpCodes.DAVE_EXECUTE_TRANSITION) {
        this.executePendingTransition(d.transition_id);
      } else if (op === VoiceOpCodes.DAVE_PREPARE_EPOCH) {
        this._loggerDave.debug("Preparing for DAVE epoch", d);
        if (d.epoch === 1) {
          this._daveProtocolVersion = d.protocol_version;
          this.initDave();
        }
      } else {
        //console.log("unhandled voice event", {op, d});
      }
    });
  }

  handleBinaryMessages(msg: Buffer) {
    this._sequenceNumber = msg.readUint16BE(0);
    const op = msg.readUint8(2);
    this._logger.trace(`Handling binary message with op ${op}`, { op });
    switch (op) {
      case VoiceOpCodesBinary.MLS_EXTERNAL_SENDER: {
        this._daveSession?.setExternalSender(msg.subarray(3));
        this._loggerDave.debug("Set MLS external sender");
        break;
      }
      case VoiceOpCodesBinary.MLS_PROPOSALS: {
        const optype = msg.readUint8(3);
        const { commit, welcome } = this._daveSession!.processProposals(
          optype,
          msg.subarray(4),
          [...this._connectedUsers],
        );
        if (commit) {
          this.sendOpcodeBinary(
            VoiceOpCodesBinary.MLS_COMMIT_WELCOME,
            welcome ? Buffer.concat([commit, welcome]) : commit,
          );
        }
        this._loggerDave.debug("Processed MLS proposal");
        break;
      }
      case VoiceOpCodesBinary.MLS_ANNOUNCE_COMMIT_TRANSITION: {
        const transitionId = msg.readUInt16BE(3);
        try {
          this._daveSession?.processCommit(msg.subarray(5));
          if (transitionId) {
            this._davePendingTransitions.set(
              transitionId,
              this._daveProtocolVersion,
            );
            this.sendOpcode(VoiceOpCodes.DAVE_TRANSITION_READY, {
              transition_id: transitionId,
            });
          }
          this._loggerDave.debug("MLS commit processed", { transitionId });
        } catch (e) {
          this._loggerDave.debug("MLS commit errored", e);
          this.processInvalidCommit(transitionId);
        }
        break;
      }
      case VoiceOpCodesBinary.MLS_WELCOME: {
        const transitionId = msg.readUInt16BE(3);
        try {
          this._daveSession?.processWelcome(msg.subarray(5));
          if (transitionId) {
            this._davePendingTransitions.set(
              transitionId,
              this._daveProtocolVersion,
            );
            this.sendOpcode(VoiceOpCodes.DAVE_TRANSITION_READY, {
              transition_id: transitionId,
            });
          }
          this._loggerDave.debug("MLS welcome processed", { transitionId });
        } catch (e) {
          this._loggerDave.debug("MLS welcome errored", e);
          this.processInvalidCommit(transitionId);
        }
        break;
      }
    }
  }

  public get daveReady(): boolean {
    return this._daveProtocolVersion > 0 && this._daveSession?.ready === true;
  }

  public get daveSession() {
    return this._daveSession;
  }

  public handleIncomingAudioPacket(packet: Uint8Array): void {
    if (!this._receiveAudio) return;
    const parsed = parseRtpPacket(packet);
    const userId = this._audioUsersBySsrc.get(parsed.ssrc);
    if (userId === undefined || userId === this.botId) return;

    try {
      const daveSession = this._daveSession;
      const opus = prepareReceivedOpus({
        payload: parsed.payload,
        daveProtocolVersion: this._daveProtocolVersion,
        daveReady: Boolean(this.daveReady),
        ...(daveSession === undefined
          ? {}
          : {
              decrypt: (payload: Uint8Array) =>
                daveSession.decrypt(
                  userId,
                  Davey.MediaType.AUDIO,
                  Buffer.from(payload),
                ),
            }),
      });
      if (opus === null) return;
      this.emit("audio", { userId, ssrc: parsed.ssrc, opus });
    } catch (error) {
      this.emit(
        "audio_error",
        error instanceof Error ? error : new Error("Voice audio decrypt failed"),
      );
    }
  }

  /** Voice-gateway speaker mapping, public so transports can be tested without a live socket. */
  public handleSpeakingUpdate(update: Message.SpeakingUpdate): void {
    if (this._receiveAudio) this._audioUsersBySsrc.set(update.ssrc, update.user_id);
  }

  public handleClientDisconnect(userId: string): void {
    for (const [ssrc, mappedUserId] of this._audioUsersBySsrc) {
      if (mappedUserId === userId) this._audioUsersBySsrc.delete(ssrc);
    }
  }

  setupHeartbeat(interval: number): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => {
      try {
        this.sendOpcode(VoiceOpCodes.HEARTBEAT, {
          t: Date.now(),
          seq_ack: this._sequenceNumber,
        });
      } catch {}
    }, interval);
  }

  sendOpcode<T extends GatewayRequest>(code: T["op"], data: T["d"]): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        op: code,
        d: data,
      }),
    );
  }
  sendOpcodeBinary(code: VoiceOpCodesBinary, data: Buffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.allocUnsafe(data.length + 1);
    buf.writeUInt8(code);
    data.copy(buf, 1);
    this.ws.send(buf);
  }

  /*
   ** identifies with media server with credentials
   */
  identify(): void {
    if (!this.serverId) throw new Error("Server ID is null or empty");
    if (!this.session_id) throw new Error("Session ID is null or empty");
    if (!this.token) throw new Error("Token is null or empty");
    this.sendOpcode(VoiceOpCodes.IDENTIFY, {
      server_id: this.serverId,
      user_id: this.botId,
      session_id: this.session_id,
      token: this.token,
      video: true,
      streams: STREAMS_SIMULCAST,
      max_dave_protocol_version: Davey.DAVE_PROTOCOL_VERSION ?? 0,
    });
  }

  resume(): void {
    if (!this.serverId) throw new Error("Server ID is null or empty");
    if (!this.session_id) throw new Error("Session ID is null or empty");
    if (!this.token) throw new Error("Token is null or empty");
    this.sendOpcode(VoiceOpCodes.RESUME, {
      server_id: this.serverId,
      session_id: this.session_id,
      token: this.token,
      seq_ack: this._sequenceNumber,
    });
  }

  /*
   ** Sets protocols and ip data used for video and audio.
   ** Uses vp8 for video
   ** Uses opus for audio
   */
  public async setProtocols(): Promise<void> {
    if (!this._webRtcParams) throw new Error("WebRTC parameters not set");
    // if (
    //     this._webRtcParams.supportedEncryptionModes.includes(SupportedEncryptionModes.AES256) &&
    //     !this._streamer.opts.forceChacha20Encryption
    // ) {
    //     encryptionMode = SupportedEncryptionModes.AES256
    // } else {
    //     encryptionMode = SupportedEncryptionModes.XCHACHA20
    // }

    const reconnect = () => {
      const webRtcConn = this._webRtcWrapper.initWebRtc();
      webRtcConn.onStateChange((state) => {
        if (state === "closed" && !this._closed) reconnect();
      });
      webRtcConn.onLocalDescription((sdp) => {
        const rtc_connection_id = randomUUID();
        this.sendOpcode(VoiceOpCodes.SELECT_PROTOCOL, {
          protocol: "webrtc",
          codecs: Object.values(CodecPayloadType) as ValueOf<
            typeof CodecPayloadType
          >[],
          data: sdp,
          sdp: sdp,
          rtc_connection_id,
        });
      });
      webRtcConn.setLocalDescription();
    };
    reconnect();
    return new Promise((resolve) => {
      this.once("select_protocol_ack", () => resolve());
    });
  }

  /*
   * Sets video attributes (width, height, frame rate).
   * enabled -> video on or off
   * attr -> video attributes
   * video and rtx sources are set to ssrc + 1 and ssrc + 2
   */
  public setVideoAttributes(enabled: false): void;
  public setVideoAttributes(enabled: true, attr: VideoAttributes): void;
  public setVideoAttributes(enabled: boolean, attr?: VideoAttributes): void {
    if (!this._webRtcParams) throw new Error("WebRTC parameters not set");
    const { audioSsrc, videoSsrc, rtxSsrc } = this._webRtcParams;
    if (!enabled) {
      this.sendOpcode(VoiceOpCodes.VIDEO, {
        audio_ssrc: audioSsrc,
        video_ssrc: 0,
        rtx_ssrc: 0,
        streams: [],
      });
    } else {
      if (!attr) throw new Error("Need to specify video attributes");
      this.sendOpcode(VoiceOpCodes.VIDEO, {
        audio_ssrc: audioSsrc,
        video_ssrc: videoSsrc,
        rtx_ssrc: rtxSsrc,
        streams: [
          {
            type: "video",
            rid: "100",
            ssrc: videoSsrc,
            active: true,
            quality: 100,
            rtx_ssrc: rtxSsrc,
            // hardcode the max bitrate because we don't really know anyway
            max_bitrate: 10000 * 1000,
            max_framerate: enabled ? attr.fps : 0,
            max_resolution: {
              type: "fixed",
              width: attr.width,
              height: attr.height,
            },
          },
        ],
      });
    }
  }

  /*
   ** Set speaking status
   ** speaking -> speaking status on or off
   */
  public setSpeaking(speaking: boolean): void {
    if (!this._webRtcParams) throw new Error("WebRTC connection not ready");
    this.sendOpcode(VoiceOpCodes.SPEAKING, {
      delay: 0,
      speaking: speaking ? 1 : 0,
      ssrc: this._webRtcParams.audioSsrc,
    });
  }
}

export function parseRtpPacket(packet: Uint8Array): {
  ssrc: number;
  payload: Uint8Array;
} {
  if (packet.byteLength < 12 || (packet[0] & 0xc0) !== 0x80) {
    throw new Error("Invalid RTP packet");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const csrcCount = packet[0] & 0x0f;
  let payloadOffset = 12 + csrcCount * 4;
  if (payloadOffset > packet.byteLength) throw new Error("Invalid RTP CSRC list");

  const hasExtension = (packet[0] & 0x10) !== 0;
  if (hasExtension) {
    if (payloadOffset + 4 > packet.byteLength) {
      throw new Error("Invalid RTP extension header");
    }
    const extensionWords = view.getUint16(payloadOffset + 2);
    payloadOffset += 4 + extensionWords * 4;
  }
  if (payloadOffset > packet.byteLength) throw new Error("Invalid RTP payload offset");

  let payloadEnd = packet.byteLength;
  const hasPadding = (packet[0] & 0x20) !== 0;
  if (hasPadding) {
    const paddingLength = packet[packet.byteLength - 1];
    if (paddingLength === undefined || paddingLength === 0) {
      throw new Error("Invalid RTP padding");
    }
    payloadEnd -= paddingLength;
  }
  if (payloadEnd < payloadOffset) throw new Error("Invalid RTP payload length");

  return {
    ssrc: view.getUint32(8),
    payload: packet.slice(payloadOffset, payloadEnd),
  };
}
