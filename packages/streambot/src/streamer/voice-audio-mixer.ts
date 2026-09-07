import { type AudioFrameSink } from "@shepherdjerred/discord-video-stream";
// The Opus codecs live in the shared voice package, not the fork: #2742 extracted the voice
// pipeline so two bots could share it, and took the codecs with it.
import {
  DiscordOpusFrameDecoder,
  DiscordOpusFrameEncoder,
} from "@shepherdjerred/voice-assistant";
import type {
  AssistantAudioPort,
  MusicAudioPort,
  VoiceConnectionLike,
} from "@shepherdjerred/streambot/streamer/audio-ports.ts";
import {
  FRAME_DURATION_MS,
  FRAME_SAMPLE_COUNT,
  mixFrame,
  musicGain,
} from "@shepherdjerred/streambot/streamer/audio-frame-mix.ts";
import {
  voiceDuckTransitionsTotal,
  voiceMixerDroppedFramesTotal,
  voiceMixerFramesTotal,
  voiceMixerSendStallsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("voice-mixer");

/** Seconds of "frames arriving, nothing reaching the wire" before the segment is declared stalled. */
export const SEND_STALL_AFTER_MS = 5000;

/** How often the send-side watchdog re-checks. Injectable so tests drive it without wall time. */
const WATCHDOG_TICK_MS = 1000;

/** Why a frame did not reach the connection. Finite by construction — it is a metric label. */
type DropReason =
  | "stale-port"
  | "no-connection"
  | "transport"
  | "frame-size"
  | "codec-error"
  | "encoder-underrun";

/** Which path produced an emitted frame. Also a metric label, also deliberately finite. */
type EmitPath =
  "passthrough" | "mixed" | "assistant-solo" | "assistant-unmixed";

/** The fork's `DiscordOpusFrameDecoder`, narrowed to what the mixer uses so tests can fake it. */
export type OpusFrameDecoder = {
  decode: (opus: Uint8Array) => Float32Array;
  close: () => void;
};

/** The fork's `DiscordOpusFrameEncoder`, likewise narrowed. */
export type OpusFrameEncoder = {
  encode: (samples: Float32Array) => Uint8Array[];
  close: () => void;
};

export type VoiceAudioMixerDeps = {
  /** The shared normal-voice connection, or null/undefined between joins. */
  readonly connection: () => VoiceConnectionLike | null | undefined;
  /** Opus bit rate for re-encoded frames, in bits per second. */
  readonly musicBitrateBps: number;
  /** Injectable clock (ms). Every schedule here is deadline-based, so tests need no wall time. */
  readonly now?: () => number;
  /** Injectable delay. Tests supply a virtual clock; nothing here observes real time. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createDecoder?: () => OpusFrameDecoder;
  readonly createEncoder?: (bitRateBps: number) => OpusFrameEncoder;
  /** Start the send-side watchdog; returns its canceller. Injectable for the same reason. */
  readonly startWatchdog?: (tick: () => void, intervalMs: number) => () => void;
  readonly sendStallAfterMs?: number;
};

/**
 * One assistant packet waiting for a music frame to carry it. At most one exists at a time, and it
 * is tagged with the port that queued it so a second port closing cannot abandon it.
 */
type PendingAssistant = {
  readonly opus: Uint8Array;
  readonly owner: symbol;
  /**
   * Whether the frame this packet was mixed into actually reached the connection. Undefined until
   * the music clock consumes it. The sender waits on airtime rather than on consumption, so
   * without this a refused mixed frame would look identical to a delivered one — and a reply
   * nobody heard would be counted as sent, which is the failure the solo path already throws on.
   */
  sent?: boolean;
};

function defaultWatchdog(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/**
 * The single writer on the userbot's outbound voice track.
 *
 * Before this existed there were two: the fork's `AudioStream` wrote music frames straight to
 * `WebRtcConnWrapper.sendAudioFrame`, and the voice assistant wrote its own Opus to the same call.
 * Two Opus streams interleaved on one SSRC, one packetizer and one RTP timestamp is not a mix, it
 * is garbage — so this class takes the last hop for both and is the only module in the package
 * allowed to name `sendAudioFrame` (enforced by `test/media/audio-send-ownership.test.ts`).
 *
 * Three things it owns, none of which had an owner before:
 *
 * - **Gain.** `volume` and the assistant duck both used to route to ffmpeg's `azmq` filter, which
 *   is wired only under Node (`newApi.ts` skips it under Bun, where the native `zeromq` package
 *   does not load). Streambot runs under Bun, so both controls attenuated nothing at all. Applying
 *   the gain to the samples here is what makes them real.
 * - **The RTP speaking flag.** Two independent sources share it. The assistant clearing it at the
 *   end of a reply used to drop the green ring in the middle of a song; it is now a set, and the
 *   opcode only moves on the 0↔1 edges.
 * - **Whether a frame actually went out.** `sendAudioFrame` returns `false` when the peer
 *   connection is not ready or no audio packetizer is installed. Both were silent, which is how a
 *   whole track can play to an empty channel while the machine reports a clean end. Every `false`
 *   is counted, and a run of them raises a stall.
 *
 * **Passthrough is the steady state.** At unity gain with no assistant audio pending, the music
 * frame is forwarded byte-for-byte: no decode result is used, nothing is re-encoded, and the
 * frametime the demuxer computed is preserved. The decoder still runs on every frame — its output
 * discarded in passthrough — so that its overlap-add state is warm the instant a duck begins and
 * the passthrough→mix transition carries no cold-start transient. Only the *encoder* is
 * conditional, and it stays alive across duck cycles for the same reason.
 */
/**
 * How many assistant packets may wait on the queue before further ones are dropped. Ten packets is
 * 200 ms of speech: long enough to absorb a scheduling hiccup, short enough that a listener hears a
 * clip rather than a reply drifting steadily further behind the speaker.
 */
const MAX_ASSISTANT_WAITERS = 10;

export class VoiceAudioMixer {
  private readonly deps: VoiceAudioMixerDeps;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly sendStallAfterMs: number;

  private desiredVolumePercent = 100;
  /** Ports currently claiming the assistant is speaking. A count, because ports can overlap. */
  private assistantSpeakers = 0;
  private connectionSpeaking = false;

  /** Bumped by every `openMusicPort`; a port whose token is stale can no longer write. */
  private musicToken = 0;
  private musicOpen = false;
  private stopWatchdog: (() => void) | null = null;
  private onSendStall: (() => void) | null = null;
  private lastMusicEmitMs = 0;
  private musicAttemptsSinceEmit = 0;

  private musicDecoder: OpusFrameDecoder | null = null;
  private assistantDecoder: OpusFrameDecoder | null = null;
  private encoder: OpusFrameEncoder | null = null;

  private pendingAssistant: PendingAssistant | null = null;
  /** Deadline the next assistant packet is paced to. Null between replies. */
  private assistantDeadlineMs: number | null = null;
  /**
   * Serializes overlapping senders (a spoken feedback clip racing a Realtime reply) without making
   * the common single-sender case wait on a promise. That distinction is load-bearing: awaiting even
   * an already-settled promise defers the slot claim to the next microtask, and a music frame
   * arriving in between would then mix silence where the packet should have been.
   */
  private assistantBusy = false;
  private readonly assistantWaiters: (() => void)[] = [];

  constructor(deps: VoiceAudioMixerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.sleep =
      deps.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.sendStallAfterMs = deps.sendStallAfterMs ?? SEND_STALL_AFTER_MS;
  }

  /** Latest requested playback volume (0-200). Applied to music from the next frame onward. */
  setDesiredVolume(percent: number): void {
    this.desiredVolumePercent = Math.max(0, percent);
  }

  /**
   * Apply a volume percentage. True when it took effect on live audio — which is now the case for
   * every music segment, and never for Go Live, whose only volume control is the `audioVolume`
   * baked into the next `prepareStream` invocation.
   */
  setVolume(percent: number): boolean {
    this.setDesiredVolume(percent);
    return this.musicOpen;
  }

  /** True while any assistant port is speaking, which is what engages the duck. */
  private get assistantSpeaking(): boolean {
    return this.assistantSpeakers > 0;
  }

  /**
   * Claim the outbound track for one media segment, superseding any previous claim.
   *
   * `onSendStall` fires when frames are arriving from ffmpeg but none has reached the wire for
   * {@link SEND_STALL_AFTER_MS}. The ffmpeg progress watchdog cannot see that: from its side the
   * producer is healthy. This is the detector for the feature's worst failure mode — a whole song
   * playing to silence while every other signal reads normal.
   */
  openMusicPort(options: { onSendStall?: () => void } = {}): MusicAudioPort {
    // Release the previous segment's resources WITHOUT touching the speaking flag: a track change
    // must not blink the green ring off and on again between two music segments.
    this.releaseMusicResources();
    const token = ++this.musicToken;
    this.musicOpen = true;
    this.onSendStall = options.onSendStall ?? null;
    this.lastMusicEmitMs = this.now();
    this.musicAttemptsSinceEmit = 0;
    this.stopWatchdog = (this.deps.startWatchdog ?? defaultWatchdog)(() => {
      this.tickWatchdog();
    }, WATCHDOG_TICK_MS);
    this.updateSpeaking();
    return {
      sendAudioFrame: (frame, frametimeMs) => {
        if (token !== this.musicToken) {
          return this.drop("stale-port");
        }
        return this.handleMusicFrame(frame, frametimeMs);
      },
      close: () => {
        if (token !== this.musicToken) return;
        this.closeMusicPort();
      },
    };
  }

  /** Hand the voice assistant its own write access. Each caller closes the port it opened. */
  openAssistantAudio(): AssistantAudioPort {
    const owner = Symbol("assistant-audio-port");
    let speaking = false;
    let closed = false;
    return {
      send: (opus) => {
        if (closed) {
          return Promise.reject(
            new Error("Assistant audio port is closed; cannot send"),
          );
        }
        return this.enqueueAssistant(opus, owner);
      },
      setSpeaking: (value) => {
        if (closed || value === speaking) return;
        speaking = value;
        this.assistantSpeakers += value ? 1 : -1;
        voiceDuckTransitionsTotal.inc({
          state: value ? "ducked" : "restored",
        });
        if (!value) this.assistantDeadlineMs = null;
        this.updateSpeaking();
      },
      close: () => {
        if (closed) return;
        closed = true;
        if (speaking) {
          speaking = false;
          this.assistantSpeakers -= 1;
          this.assistantDeadlineMs = null;
          this.updateSpeaking();
        }
        // Abandon anything THIS port left waiting on the music clock, and only this port's: a
        // second sender's packet is not ours to drop. Without the drain a teardown mid-reply leaves
        // a packet queued against a music clock that has stopped ticking.
        if (this.pendingAssistant?.owner === owner)
          this.pendingAssistant = null;
      },
    };
  }

  /**
   * Drop every claim on the connection: the streamer's `safeStop` path, run on stop, skip, voice
   * loss and teardown. Also drains a waiting assistant packet, for the deadlock reason above.
   */
  reset(): void {
    this.closeMusicPort();
    this.pendingAssistant = null;
    this.assistantSpeakers = 0;
    this.assistantDeadlineMs = null;
    this.updateSpeaking();
  }

  // --- music path -----------------------------------------------------------

  private handleMusicFrame(frame: Buffer, frametimeMs: number): boolean {
    this.musicAttemptsSinceEmit += 1;
    const connection = this.deps.connection()?.webRtcConn;
    if (connection === undefined) return this.drop("no-connection");

    const gain = musicGain(this.desiredVolumePercent, this.assistantSpeaking);
    const pending = this.pendingAssistant;
    // Decoded on EVERY frame, including the ones whose samples are then thrown away. Opus is a
    // lapped transform: a decoder started cold produces a frame whose first milliseconds are wrong,
    // which at a duck boundary is an audible click on top of the volume step. Running it always
    // costs one decode per frame and removes the transient entirely.
    const music = this.decodeMusic(frame);
    if (music === null) return this.drop("codec-error");

    if (gain === 1 && pending === null) {
      return this.emit(connection, frame, frametimeMs, "passthrough");
    }
    if (music.length !== FRAME_SAMPLE_COUNT) return this.drop("frame-size");

    // Keep the reference: `takeAssistantFrame` clears `pendingAssistant`, so this is the only way
    // to report the send outcome back to the sender still waiting on this packet's airtime.
    const consumed = pending;
    const assistant =
      consumed === null ? null : this.takeAssistantFrame(consumed);
    const sent = this.emitMixed(connection, mixFrame(music, gain, assistant));
    if (consumed !== null) consumed.sent = sent;
    return sent;
  }

  private decodeMusic(frame: Buffer): Float32Array | null {
    try {
      this.musicDecoder ??= this.createDecoder();
      return this.musicDecoder.decode(frame);
    } catch (error) {
      log.error("music frame decode failed", { error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Consume the waiting assistant packet. A decode failure costs that packet, not the song: the
   * assistant's audio arrives over the network from a third party, so a bad packet is an external
   * boundary failure, and failing the whole music segment over one would be the wrong trade.
   */
  private takeAssistantFrame(pending: PendingAssistant): Float32Array | null {
    this.pendingAssistant = null;
    try {
      this.assistantDecoder ??= this.createDecoder();
      const samples = this.assistantDecoder.decode(pending.opus);
      if (samples.length === FRAME_SAMPLE_COUNT) return samples;
      voiceMixerDroppedFramesTotal.inc({ reason: "frame-size" });
      return null;
    } catch (error) {
      log.error("assistant frame decode failed", {
        error: getErrorMessage(error),
      });
      voiceMixerDroppedFramesTotal.inc({ reason: "codec-error" });
      return null;
    }
  }

  private emitMixed(connection: AudioFrameSink, mixed: Float32Array): boolean {
    let packets: Uint8Array[];
    try {
      this.encoder ??= this.deps.createEncoder
        ? this.deps.createEncoder(this.deps.musicBitrateBps)
        : new DiscordOpusFrameEncoder(this.deps.musicBitrateBps);
      packets = this.encoder.encode(mixed);
    } catch (error) {
      log.error("mixed frame encode failed", { error: getErrorMessage(error) });
      return this.drop("codec-error");
    }
    // One whole 20 ms frame in yields exactly one packet out, which is what keeps the emitted
    // frame count equal to the input frame count and the RTP timestamp advancing once per frame.
    // Zero packets would mean the encoder buffered a partial frame — a broken contract, not a
    // transient — so it is reported rather than passed off as a successful send.
    if (packets.length === 0) return this.drop("encoder-underrun");
    let sent = true;
    for (const packet of packets) {
      // A re-encoded frame is always 20 ms. The input frametime must NOT be reused here: it
      // describes the packet the demuxer produced, not the one libopus just emitted, and feeding
      // the wrong duration into the RTP timestamp desynchronises the receiver's playout clock.
      sent =
        this.emit(
          connection,
          Buffer.from(packet),
          FRAME_DURATION_MS,
          "mixed",
        ) && sent;
    }
    return sent;
  }

  private closeMusicPort(): void {
    if (!this.musicOpen) return;
    this.releaseMusicResources();
    this.updateSpeaking();
  }

  /**
   * Retire the current music claim and free its native codecs, leaving the speaking flag alone.
   * Bumping the token here is what makes an already-issued port inert: a frame still in flight from
   * a superseded `AudioStream` is dropped instead of landing on a connection this segment no longer
   * owns.
   */
  private releaseMusicResources(): void {
    if (!this.musicOpen) return;
    this.musicToken += 1;
    this.musicOpen = false;
    this.onSendStall = null;
    this.stopWatchdog?.();
    this.stopWatchdog = null;
    this.musicDecoder?.close();
    this.musicDecoder = null;
    this.assistantDecoder?.close();
    this.assistantDecoder = null;
    this.encoder?.close();
    this.encoder = null;
    this.pendingAssistant = null;
  }

  private createDecoder(): OpusFrameDecoder {
    return this.deps.createDecoder
      ? this.deps.createDecoder()
      : new DiscordOpusFrameDecoder();
  }

  // --- assistant path -------------------------------------------------------

  /**
   * Queue one assistant packet and hold the caller for its 20 ms of airtime.
   *
   * Serialized on a tail promise so two senders (a local feedback clip and a Realtime reply can
   * overlap) interleave packet by packet instead of racing for the single pending slot.
   */
  private async enqueueAssistant(
    opus: Uint8Array,
    owner: symbol,
  ): Promise<void> {
    // The shared voice pipeline's transport port is fire-and-forget: `sendAssistantOpus` returns
    // void, so nothing upstream awaits this and nothing upstream slows down if we do. The sender
    // paces itself at 20 ms, which matches the airtime each packet is held for, so in steady state
    // the queue holds about one entry. A bound exists for the state that is not steady — a reply
    // arriving faster than the music clock drains it — because an unbounded queue on a live audio
    // path trades a brief drop for growing latency and memory, and the drop is the better failure.
    if (this.assistantWaiters.length >= MAX_ASSISTANT_WAITERS) {
      voiceMixerDroppedFramesTotal.inc({ reason: "assistant-backlog" });
      return;
    }
    if (this.assistantBusy) {
      await new Promise<void>((resolve) => {
        this.assistantWaiters.push(resolve);
      });
    }
    this.assistantBusy = true;
    try {
      // Called, not scheduled: everything before this frame's own first await — claiming the
      // pending slot, or emitting solo — happens synchronously inside the caller's `send()`.
      await this.sendAssistantFrame(opus, owner);
    } finally {
      this.assistantBusy = false;
      // Waiters are released regardless of outcome: a failed packet must not wedge the queue.
      this.assistantWaiters.shift()?.();
    }
  }

  private async sendAssistantFrame(
    opus: Uint8Array,
    owner: symbol,
  ): Promise<void> {
    if (!this.musicOpen) {
      this.emitAssistantSolo(opus, "assistant-solo");
      await this.pace();
      return;
    }
    // Music is playing: offer the packet to the music clock, which mixes it into the next frame it
    // receives. The wait below is the pacing either way, so consumption and pacing are deliberately
    // decoupled — the packet does not have to be consumed for the caller to proceed on time.
    const entry: PendingAssistant = { opus, owner };
    this.pendingAssistant = entry;
    await this.pace();
    if (this.pendingAssistant !== entry) {
      // Consumed by the music clock. It reported whether the mixed frame reached the wire; a
      // refusal has to surface here, or `AssistantTransport` and `PacedAssistantSender` complete a
      // reply that was never heard.
      if (entry.sent === false) {
        throw new Error(
          "Assistant audio frame was refused by the voice connection",
        );
      }
      return;
    }
    // No music frame arrived within the packet's own airtime. That means the music pipeline is
    // starting up, seeking, or stalled — none of which may silence a reply — so the packet goes out
    // on its own. Labelled separately because a run of these is the signal that music production is
    // behind, not that anything here is wrong.
    this.pendingAssistant = null;
    this.emitAssistantSolo(opus, "assistant-unmixed");
  }

  private emitAssistantSolo(opus: Uint8Array, path: EmitPath): void {
    const connection = this.deps.connection()?.webRtcConn;
    if (connection === undefined) {
      this.drop("no-connection");
      throw new Error("Cannot send assistant audio without a voice connection");
    }
    if (!this.emit(connection, Buffer.from(opus), FRAME_DURATION_MS, path)) {
      // Reported rather than swallowed: `sendAudioFrame` returning false means the packetizer is
      // missing or the transport is down, and the caller counts this as a delivery failure instead
      // of narrating a reply nobody heard.
      throw new Error("Voice connection refused an assistant audio frame");
    }
  }

  /**
   * Sleep until this packet's slot in a fixed 50 Hz schedule.
   *
   * A flat `sleep(20)` per packet — what the assistant sender did before — makes each iteration
   * cost 20 ms *plus* the send, so a reply drifts later and later against real time; over a
   * four-minute music segment that error is seconds. Anchoring to a rolling deadline instead makes
   * the total elapsed time a function of the packet count alone. The deadline is never allowed to
   * fall more than one frame behind the clock, so recovering from a long hiccup does not turn into
   * a burst of packets sent back to back.
   */
  private async pace(): Promise<void> {
    const start = this.now();
    const anchor =
      this.assistantDeadlineMs === null
        ? start
        : Math.max(this.assistantDeadlineMs, start - FRAME_DURATION_MS);
    this.assistantDeadlineMs = anchor + FRAME_DURATION_MS;
    await this.sleep(Math.max(0, this.assistantDeadlineMs - this.now()));
  }

  // --- shared ---------------------------------------------------------------

  private emit(
    connection: AudioFrameSink,
    frame: Buffer,
    frametimeMs: number,
    path: EmitPath,
  ): boolean {
    if (!connection.sendAudioFrame(frame, frametimeMs)) {
      return this.drop("transport");
    }
    voiceMixerFramesTotal.inc({ path });
    if (path === "passthrough" || path === "mixed") {
      this.lastMusicEmitMs = this.now();
      this.musicAttemptsSinceEmit = 0;
    }
    return true;
  }

  /** Count a frame that did not reach the wire and report it as such. Always returns false. */
  private drop(reason: DropReason): boolean {
    voiceMixerDroppedFramesTotal.inc({ reason });
    return false;
  }

  private updateSpeaking(): void {
    const shouldSpeak = this.musicOpen || this.assistantSpeaking;
    if (shouldSpeak === this.connectionSpeaking) return;
    this.connectionSpeaking = shouldSpeak;
    this.deps.connection()?.setSpeaking(shouldSpeak);
  }

  /**
   * Fire only when frames were offered and none of them landed. If ffmpeg has gone quiet there are
   * no attempts to count, and the ffmpeg progress watchdog owns that case — overlapping the two
   * would give a music segment a second, much shorter stall timeout than a video one.
   */
  private tickWatchdog(): void {
    if (!this.musicOpen) return;
    if (this.musicAttemptsSinceEmit === 0) return;
    if (this.now() - this.lastMusicEmitMs < this.sendStallAfterMs) return;
    this.lastMusicEmitMs = this.now();
    this.musicAttemptsSinceEmit = 0;
    voiceMixerSendStallsTotal.inc();
    log.error("no audio frame reached the voice connection", {
      afterMs: this.sendStallAfterMs,
    });
    this.onSendStall?.();
  }
}
