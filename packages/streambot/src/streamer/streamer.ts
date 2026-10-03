import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  createSeekablePlayer,
  type Player,
  type ReceivedVoiceAudio,
  type VoiceReceiveObserver,
} from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  PipelineMode,
  RunStreamInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  endedShortError,
  StreamCrashError,
  type StallInfo,
} from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import { SegmentClock } from "@shepherdjerred/streambot/streamer/segment-clock.ts";
import {
  GuildIdSchema,
  type GuildId,
  type UserToken,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  createStreamObserver,
  STALL_AFTER_SECONDS,
} from "@shepherdjerred/streambot/observability/stream-observer.ts";
import {
  streamActive,
  streamCrashesTotal,
  streamHardware,
  streamSegmentDurationSeconds,
  streamSegmentsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import type { AssistantAudioPort } from "@shepherdjerred/streambot/streamer/audio-ports.ts";
import { AssistantTransport } from "@shepherdjerred/streambot/streamer/assistant-transport.ts";
import { buildStallReport } from "@shepherdjerred/streambot/streamer/stall-report.ts";
import { VoiceAudioMixer } from "@shepherdjerred/streambot/streamer/voice-audio-mixer.ts";
import { buildPlaybackPrepareOptions } from "@shepherdjerred/streambot/streamer/prepare-options.ts";
import {
  EMPTY_VOICE_CLOSE_SOURCE,
  ordinaryVoiceCloseSource,
  type VoiceCloseInfo,
  type VoiceCloseSource,
  type VoiceCloseTracker,
} from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import type {
  PlayerFactory,
  StreamerDependencies,
  StreamerLike,
  StreamObserverFactory,
} from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import { joinStreamerVoice } from "@shepherdjerred/streambot/streamer/join-voice.ts";
import { observeUserbotGateway } from "@shepherdjerred/streambot/streamer/gateway-observability.ts";
import { runStreamWithFallback } from "@shepherdjerred/streambot/streamer/run-stream.ts";
import { seekPlayer } from "@shepherdjerred/streambot/streamer/seek-player.ts";
const log = logger.child("streamer");
/**
 * Owns the selfbot voice connection and ffmpeg streaming via `@shepherdjerred/discord-video-stream`
 * (our fork). Its methods are the playback machine's `joinVoice` / `runStream` / `leaveVoice`
 * actors, so all voice I/O is driven by — and cancellable from — the machine. Uses Intel VAAPI
 * hardware encoding when enabled, falling back to software if the device/driver is unavailable.
 *
 * Live controls (`setVolume`, `seek`) act on the currently-playing {@link Player} as side-channels,
 * independent of the machine.
 */
export class StreambotStreamer implements StreamerLike {
  private readonly client: Client;
  private readonly streamer: Streamer;
  /** This userbot's account token (one per pool entry). */
  private readonly userToken: UserToken;
  /** Only `config.stream.*` and `config.voice.*` are read here; the discord token comes from {@link userToken}. */
  private readonly config: Pick<Config, "stream" | "voice">;
  /** Injectable clock (ms) so position tracking is deterministic in tests. */
  private readonly now: () => number;
  /** Injectable player factory (defaults to the fork's real one) so tests can supply a fake. */
  private readonly createPlayer: PlayerFactory;
  /** Injectable observer factory so startup and seek races are deterministic in tests. */
  private readonly createObserver: StreamObserverFactory;
  private readonly joinStreamerVoice: typeof joinStreamerVoice;
  private player: Player | null = null;
  /** Last known playback offset (seconds), captured per segment so a HW→SW retry can resume there. */
  private lastPlaybackPositionSeconds = 0;
  /** Position tracking and seek ownership for the active segment. */
  private readonly clock: SegmentClock;
  /** Close state for the current connection; retained recovery leases outlive pool reuse. */
  private voiceCloseTracker: VoiceCloseTracker | null = null;
  private voiceGeneration = 0;
  /** Session-layer callback for Discord-side voice closes; cleared between sessions. */
  private voiceCloseListener: ((info: VoiceCloseInfo) => void) | null = null;
  /** Session-layer callback for mid-stream ffmpeg stalls; cleared between sessions. */
  private stallListener: ((info: StallInfo) => void) | null = null;
  private voiceAudioListener: ((audio: ReceivedVoiceAudio) => void) | null =
    null;
  private voiceReceiveObserver: VoiceReceiveObserver | null = null;
  /**
   * The sole writer on the userbot's outbound voice track: music frames, assistant replies, gain,
   * ducking and the RTP speaking flag all pass through it. One per userbot, outliving individual
   * segments so that a track change does not blink the speaking flag off and on.
   */
  private readonly mixer: VoiceAudioMixer;
  /** Adapts the shared voice pipeline's transport shape onto one long-lived mixer port. */
  private readonly assistantTransport: AssistantTransport;
  private readonly sharedOwner: StreambotStreamer | undefined;
  private readonly transport: "music" | "video" | undefined;
  private readonly children = new Set<StreambotStreamer>();
  constructor(
    userToken: UserToken,
    config: Pick<Config, "stream" | "voice">,
    now: () => number = Date.now,
    dependencies:
      | PlayerFactory
      | (StreamerDependencies & {
          shared?: { owner: StreambotStreamer; transport: "music" | "video" };
        }) = {},
  ) {
    const lifecycleDeps =
      typeof dependencies === "function"
        ? { createPlayer: dependencies }
        : dependencies;
    const shared = lifecycleDeps.shared;
    this.sharedOwner = shared?.owner;
    this.transport = shared?.transport;
    this.userToken = userToken;
    this.config = config;
    this.now = now;
    this.createPlayer = lifecycleDeps.createPlayer ?? createSeekablePlayer;
    this.createObserver = lifecycleDeps.createObserver ?? createStreamObserver;
    this.joinStreamerVoice =
      lifecycleDeps.joinStreamerVoice ?? joinStreamerVoice;
    this.clock = new SegmentClock(this.now);
    this.client = shared?.owner.client ?? new Client();
    this.streamer = shared?.owner.streamer ?? new Streamer(this.client);
    this.mixer =
      shared?.owner.mixer ??
      new VoiceAudioMixer({
        connection: () => this.streamer.voiceConnection,
        musicBitrateBps: config.stream.bitrateAudioKbps * 1000,
      });
    this.assistantTransport =
      shared?.owner.assistantTransport ??
      new AssistantTransport(() => this.mixer.openAssistantAudio());
    if (shared === undefined) observeUserbotGateway(this.client);
  }

  createPlaybackHandle(transport: "music" | "video"): StreamerLike {
    const child = new StreambotStreamer(this.userToken, this.config, this.now, {
      createPlayer: this.createPlayer,
      createObserver: this.createObserver,
      joinStreamerVoice: this.joinStreamerVoice,
      shared: { owner: this, transport },
    });
    this.children.add(child);
    return child;
  }
  /**
   * Log in and wait for the gateway to finish hydrating — `client.guilds.cache` is empty until the
   * `ready` event fires, so the pool's membership snapshot ({@link guildIds}) would be wrong if we
   * resolved on login alone.
   */
  async login(): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      this.client.once("ready", () => {
        resolve();
      });
    });
    await this.client.login(this.userToken);
    await ready;
    log.info("streamer logged in", {
      user: this.client.user?.username,
      guilds: this.client.guilds.cache.size,
    });
  }
  /**
   * Discord user id of the logged-in streamer (for the alone-in-VC check). Throws if
   * called before {@link login} resolves — `login` awaits the gateway `ready` event,
   * so `userId` is only safe to call afterward.
   */
  userId(): string {
    const id = this.client.user?.id;
    if (id === undefined) {
      throw new Error("StreambotStreamer.userId() called before login");
    }
    return id;
  }
  /** Guild ids this userbot is a member of (snapshot of the gateway cache after {@link login}). */
  guildIds(): GuildId[] {
    return [...this.client.guilds.cache.keys()].map((id) =>
      GuildIdSchema.parse(id),
    );
  }

  async destroy(): Promise<void> {
    this.safeStop();
    if (this.sharedOwner !== undefined) return;
    try {
      this.client.destroy();
    } catch (error) {
      // discord.js-selfbot-v13's destroy throws (`this.connection.readyState` on null) when the
      // gateway shard never fully opened or already closed — harmless during shutdown.
      log.warn("client destroy failed", { error: getErrorMessage(error) });
    }
    await Promise.resolve();
  }
  /**
   * Apply a volume percentage (0-200). True when it reached live audio — a music segment, where the
   * mixer scales the samples themselves. False for Go Live, whose gain is fixed for the life of a
   * segment by the `audioVolume` its ffmpeg command was built with, and therefore takes effect on
   * the next item rather than this one.
   */
  setVolume(percent: number): Promise<boolean> {
    return this.transport === "video"
      ? Promise.resolve(false)
      : Promise.resolve(this.mixer.setVolume(percent));
  }
  openAssistantAudio(): AssistantAudioPort {
    return this.mixer.openAssistantAudio();
  }
  setAssistantSpeaking(speaking: boolean): Promise<void> {
    return this.assistantTransport.setSpeaking(speaking);
  }
  sendAssistantOpus(opus: Uint8Array): void {
    this.assistantTransport.send(opus);
  }
  assistantUserId(): string {
    return this.userId();
  }
  assistantDaveReady(): boolean {
    return this.streamer.voiceConnection?.webRtcConn.daveReady ?? false;
  }
  setVoiceAudioListener(
    listener: ((audio: ReceivedVoiceAudio) => void) | null,
  ): void {
    if (this.sharedOwner !== undefined) {
      this.sharedOwner.setVoiceAudioListener(listener);
      return;
    }
    this.voiceAudioListener = listener;
  }
  setVoiceReceiveObserver(observer: VoiceReceiveObserver | null): void {
    if (this.sharedOwner !== undefined) {
      this.sharedOwner.setVoiceReceiveObserver(observer);
      return;
    }
    this.voiceReceiveObserver = observer;
    this.streamer.voiceConnection?.setReceiveObserver(observer ?? undefined);
  }
  /** Seek the live stream to an absolute offset (seconds); false when nothing is playing. */
  seek(seconds: number): Promise<boolean> {
    return seekPlayer(seconds, this.clock, () => this.player);
  }
  /** Current playback position in seconds, or null when nothing is playing. */
  getPosition(): number | null {
    return this.clock.position();
  }
  lastVoiceCloseInfo(): VoiceCloseInfo | null {
    return this.sharedOwner === undefined
      ? (this.voiceCloseTracker?.lastVoiceCloseInfo() ?? null)
      : this.sharedOwner.lastVoiceCloseInfo();
  }

  captureVoiceCloseSource(): VoiceCloseSource {
    if (this.sharedOwner === undefined)
      return this.voiceCloseTracker?.retain() ?? EMPTY_VOICE_CLOSE_SOURCE;
    const retained = this.sharedOwner.captureVoiceCloseSource();
    return ordinaryVoiceCloseSource(retained);
  }
  setVoiceCloseListener(
    listener: ((info: VoiceCloseInfo) => void) | null,
  ): void {
    this.voiceCloseListener = listener;
  }
  setStallListener(listener: ((info: StallInfo) => void) | null): void {
    this.stallListener = listener;
  }
  private safeStop(): void {
    this.clock.invalidate();
    try {
      this.player?.stop();
    } catch (error) {
      log.warn("player stop failed", { error: getErrorMessage(error) });
    }
    this.player = null;
    this.clock.stopClock();
    if (this.sharedOwner !== undefined) {
      this.sharedOwner.children.delete(this);
      return;
    }
    for (const child of this.children) child.safeStop();
    this.voiceGeneration += 1;
    this.voiceCloseTracker?.release();
    this.voiceCloseTracker = null;
    this.voiceAudioListener = null;
    this.voiceReceiveObserver = null;
    // Drops the music claim, drains any assistant packet waiting on the music clock (without which
    // a stop mid-reply leaves the paced sender awaiting a promise nothing will resolve), and
    // releases the speaking flag.
    this.mixer.reset();
    try {
      this.streamer.stopStream();
    } catch (error) {
      log.warn("stopStream failed", { error: getErrorMessage(error) });
    }
    try {
      this.streamer.leaveVoice();
    } catch (error) {
      log.warn("leaveVoice failed", { error: getErrorMessage(error) });
    }
  }

  readonly joinVoice = async (input: JoinVoiceInput): Promise<VoiceHandle> => {
    const generation = ++this.voiceGeneration;
    this.voiceCloseTracker?.release();
    this.voiceCloseTracker = null;
    this.voiceCloseTracker = await this.joinStreamerVoice({
      streamer: this.streamer,
      input,
      receiveAudio: this.config.voice.enabled,
      now: this.now,
      onClose: (info) => {
        if (generation === this.voiceGeneration)
          this.voiceCloseListener?.(info);
      },
      onAudio: (audio) => this.voiceAudioListener?.(audio),
      receiveObserver: this.voiceReceiveObserver,
    });
    log.info("joined voice", {
      guildId: input.guildId,
      channelId: input.channelId,
    });
    return { guildId: input.guildId, channelId: input.channelId };
  };

  readonly runStream = async (
    input: RunStreamInput,
    signal: AbortSignal,
  ): Promise<void> => {
    if (
      this.transport !== undefined &&
      input.resolved.mediaKind !== this.transport
    ) {
      throw new Error(
        `Playback transport mismatch: expected ${this.transport}`,
      );
    }
    await runStreamWithFallback(input, signal, {
      hardwareAcceleration: this.config.stream.hardwareAcceleration,
      lastPosition: () => this.lastPlaybackPositionSeconds,
      streamOnce: (request, abort, mode, position) =>
        this.streamOnce(request, abort, mode, position),
    });
  };

  /**
   * Turn a detected stall into the machine's stall recovery.
   *
   * Two detectors feed this. The ffmpeg progress watchdog sees a producer that stopped producing
   * and supplies its last delivered timemark. The mixer's send-side watchdog sees the opposite
   * failure — frames arriving and none of them reaching the wire — which the ffmpeg watchdog
   * cannot see at all, because from its side everything is healthy. That second case is how a whole
   * song plays to an empty channel while the segment ends cleanly, so it resolves to the same
   * bounded retry rather than to nothing.
   */
  private async streamOnce(
    input: RunStreamInput,
    signal: AbortSignal,
    pipelineMode: PipelineMode,
    startSeconds: number,
  ): Promise<void> {
    const { stream } = this.config;
    // Which Discord transport carries this item, decided once at resolve time and never re-derived
    // here. Music is audio-only over the normal voice connection (the userbot appears to be talking
    // into its mic); video is Go Live, exactly as before.
    const isMusic = input.resolved.mediaKind === "music";
    const transport = isMusic ? "voice" : "go-live";
    const useHardware = pipelineMode !== "sw";
    // A pooled userbot may begin a new session while an old seek's replacement pipeline is still
    // attaching. Revoke that continuation before exposing any state for this segment.
    this.clock.invalidate();
    // Set before the options are built and before playback attaches: a music segment reads it on
    // its very first frame through the mixer, and a video segment bakes it into the ffmpeg command
    // line as `audioVolume`. Either way the first sample the viewer hears is already at the
    // requested level, rather than at 100% until some later apply() lands.
    this.applyMusicVolume(isMusic, input.volume);
    const prepareOpts = buildPlaybackPrepareOptions({
      stream,
      resolved: input.resolved,
      startSeconds,
      volumePercent: input.volume,
      pipelineMode,
    });
    log.info("starting stream", {
      title: input.resolved.title,
      hardware: useHardware,
      pipelineMode,
      mediaKind: input.resolved.mediaKind,
      decidedBy: input.resolved.decidedBy,
      spoken: input.resolved.spoken,
      transport,
    });
    // Observability seam — forwards ffmpeg command/codec/progress and send-frametime stats to the
    // Prometheus metrics. Passed to both prepare (ffmpeg events) and play (send stats). The stall
    // watchdog routes to the session layer, which converts it into the machine's stall recovery.
    // The observer can begin a progress epoch synchronously during player construction/startup, so
    // establish the requested media offset first. `beginSegment` deliberately leaves the elapsed
    // clock stopped: public checkpoint time must not advance before playback is actually attached.
    this.clock.beginSegment(startSeconds);
    const { observer, dispose: disposeObserver } = this.createObserver(
      useHardware,
      this.now,
      (lastMediaSeconds) => {
        this.stallListener?.(
          buildStallReport({
            pipelineMode,
            transport,
            lastMediaSeconds,
            offsetSeconds: this.clock.stallOffsetSeconds,
            reason: `ffmpeg produced no output for ${String(STALL_AFTER_SECONDS)}s`,
          }),
        );
      },
      // A music segment must leave the video-only gauges alone rather than writing zeros into them:
      // `hw_decode_engaged` pinned at 0 reads as "hardware decode broke", not "there is no video".
      { audioOnly: isMusic },
    );

    // Music borrows the already-joined voice connection through the mixer, which is the only thing
    // permitted to write to it. Opening the port here supersedes any previous segment's claim, so a
    // frame still in flight from a torn-down pipeline is dropped rather than sent.
    const musicPort = isMusic
      ? this.mixer.openMusicPort({
          onSendStall: () => {
            this.stallListener?.(
              buildStallReport({
                pipelineMode,
                transport,
                lastMediaSeconds: undefined,
                offsetSeconds: this.clock.stallOffsetSeconds,
                reason: "no audio frame reached the voice connection",
              }),
            );
          },
        })
      : null;

    // The seekable player owns prepare+play on one media connection. `finished` resolves at the
    // true end of playback (or on stop) and rejects on an ffmpeg/encode failure — folding in the
    // play/ffmpeg-failure race the old code did by hand, and letting `/stream seek` restart ffmpeg
    // at a new offset without dropping the connection.
    const player = this.createPlayer(
      this.streamer,
      input.resolved.ffmpegInput,
      {
        prepare: { ...prepareOpts, observer },
        play: {
          // "voice" sends over the normal voice connection with plain microphone semantics and
          // touches nothing on it — no signalVideo, no setSpeaking, no createStream/stopStream —
          // because the assistant is sharing that connection and this segment only borrows it.
          // The burst has to match `prepare.readrateInitialBurst` on both sides: the pacer
          // free-runs until that many seconds of pts have been sent, pushing the ffmpeg-side
          // burst into the receiver's jitter buffer rather than holding it in local queues. Only
          // Go Live sets one — see `buildMusicPrepareOptions` for why the voice path stays paced
          // until someone has profiled it — so the two travel together in one branch.
          ...(musicPort === null
            ? {
                type: "go-live" as const,
                readrateInitialBurst: stream.readrateInitialBurst,
              }
            : { type: "voice" as const, audioSink: musicPort }),
          observer,
        },
      },
    );
    this.player = player;
    // If `start()` rejects (a startup/graph-init failure — the player now surfaces a failed initial
    // attach there rather than swallowing it into `finished`), we take the catch path below and
    // never await `finished`. Consume any late rejection from the torn-down player so it can't
    // surface as an unhandled rejection; the success path still awaits `player.finished` below and
    // sees its settled value.
    void (async () => {
      try {
        await player.finished;
      } catch {
        // Intentionally swallowed here; real error handling happens on the awaited paths below.
      } finally {
        if (this.player === player) {
          this.clock.invalidate();
        }
      }
    })();

    const onAbort = () => {
      player.stop();
    };
    if (signal.aborted) {
      player.stop();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const segmentHardware = useHardware ? "true" : "false";
    const segmentStartedMs = this.now();
    streamActive.inc();
    // Suppressed, not zeroed, for music: there is no encoder on this path at all, and a 0 here is
    // read on the dashboard as "the hardware path failed and we fell back".
    if (!isMusic) streamHardware.set(useHardware ? 1 : 0);
    let outcome: "ended" | "ended-short" | "crash" | "error" = "ended";
    let playbackStarted = false;
    try {
      await player.start();
      playbackStarted = true;
      // Start the public elapsed clock only after playback attaches successfully.
      this.clock.markPlaying();
      await player.finished;
      // `finished` resolving means ffmpeg exited 0 — but exit 0 far short of the probed duration
      // is a truncation (network URL expiry, container short-read), not a completed track. Without
      // this check a truncated source under loop:"track" replays its first N seconds forever.
      // Aborts (stop/skip/voice loss) also resolve `finished`; they are never classified.
      const shortEnd = signal.aborted
        ? null
        : endedShortError(
            input.resolved.durationSeconds,
            this.getPosition() ?? startSeconds,
            pipelineMode,
          );
      if (shortEnd !== null) {
        outcome = "ended-short";
        streamCrashesTotal.inc({
          transport,
          pipeline: pipelineMode,
          kind: "ended-short",
        });
        throw shortEnd;
      }
    } catch (error) {
      // Our own ended-short classification from above — already counted.
      if (error instanceof StreamCrashError) throw error;
      if (playbackStarted && !signal.aborted) {
        // Mid-stream death (non-zero ffmpeg exit or demuxer error) after playback was up.
        outcome = "crash";
        const positionSeconds = this.getPosition() ?? startSeconds;
        streamCrashesTotal.inc({
          transport,
          pipeline: pipelineMode,
          kind: "crash",
        });
        const crash = StreamCrashError.fromCause(error, {
          positionSeconds,
          pipelineMode,
        });
        log.error("stream crashed mid-playback", {
          title: input.resolved.title,
          positionSeconds,
          pipelineMode,
          exitCode: crash.exitCode,
          // The tail is bounded (≤50 lines) but still noisy; the last lines carry the error.
          stderrTail: crash.stderrTail.slice(-15),
        });
        throw crash;
      }
      outcome = "error";
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
      // Stop the progress-age timer so it doesn't keep writing to the shared gauge after this
      // segment ends. Without this, each seek or track change leaks a live setInterval that races
      // against the next segment's timer and can fire spurious StreambotProgressStalled alerts.
      disposeObserver();
      // Capture where playback reached (incl. live seeks) before dropping the player, so a HW→SW
      // retry can resume there. Uses the wall-clock tracker, not the fork's segment-offset
      // `Player.position`, falling back to the requested offset if playback never started.
      if (this.player === player) {
        this.lastPlaybackPositionSeconds = this.getPosition() ?? startSeconds;
        this.clock.invalidate();
        this.clock.stopClock();
        this.player = null;
      }
      // Release the outbound track before the next segment (or the next session's userbot) claims
      // it. Closing is what makes the port inert, so a late frame from this pipeline is dropped.
      musicPort?.close();
      streamActive.dec();
      const durationSeconds = (this.now() - segmentStartedMs) / 1000;
      streamSegmentsTotal.inc({
        transport,
        hardware: segmentHardware,
        outcome,
      });
      streamSegmentDurationSeconds.observe(
        { transport, hardware: segmentHardware, outcome },
        durationSeconds,
      );
    }
    log.info("stream ended", { title: input.resolved.title });
  }

  readonly leaveVoice = async (_input: LeaveVoiceInput): Promise<void> => {
    this.safeStop();
    log.info("left voice");
    await Promise.resolve();
  };
  private applyMusicVolume(isMusic: boolean, volume: number): void {
    if (isMusic) this.mixer.setDesiredVolume(volume);
  }
}
