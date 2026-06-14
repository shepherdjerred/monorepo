import Log from "debug-level";
import type { Readable } from "node:stream";
import type { Streamer } from "../client/index.js";
import type { WebRtcConnWrapper } from "../client/voice/WebRtcWrapper.js";
import {
  attachPipeline as defaultAttachPipeline,
  mergePlayStreamOptions,
  prepareStream as defaultPrepareStream,
  type AttachedPipeline,
  type PlayStreamOptions,
  type PrepareStreamOptions,
} from "./newApi.js";

/**
 * Injectable seams, defaulted to the real implementations. Tests pass fakes so the player's state
 * machine (start/seek/stop/natural-end/failure) can be exercised without ffmpeg or a live
 * connection.
 */
export type SeekablePlayerDeps = {
  prepareStream: typeof defaultPrepareStream;
  attachPipeline: typeof defaultAttachPipeline;
};

export type SeekablePlayerOptions = {
  prepare?: Partial<PrepareStreamOptions>;
  play?: Partial<PlayStreamOptions>;
};

export type Player = {
  /** Open the Go-Live stream and begin playing from the initial offset. Resolves once attached. */
  start: () => Promise<void>;
  /** Seek to an absolute offset (seconds) by restarting ffmpeg with `-ss`, keeping the stream up. */
  seek: (seconds: number) => Promise<void>;
  /** Set the live volume (0..1, the underlying zmq scale). False when no segment is active. */
  setVolume: (volume: number) => Promise<boolean>;
  /** Stop playback and tear down the connection. */
  stop: () => void;
  /** Resolves on natural end of media or explicit stop; rejects on a stream/ffmpeg failure. */
  readonly finished: Promise<void>;
  /** Current playback start offset in seconds (the last seek target, or the initial offset). */
  readonly position: number;
};

/**
 * A seekable wrapper around {@link defaultPrepareStream} + {@link defaultAttachPipeline}.
 *
 * `@dank074/discord-video-stream` has no live seek, so `seek()` restarts ffmpeg at a new `-ss`
 * offset. The key property of this player is that it does so **without tearing down the Go-Live
 * connection**: the connection (and its RTP packetizer, hence RTP timestamp continuity) is created
 * once and reused; only the per-source demuxer + `VideoStream`/`AudioStream` are rebuilt. Viewers
 * see a seek, not a stream restart.
 */
export function createSeekablePlayer(
  streamer: Streamer,
  input: string | Readable,
  options: SeekablePlayerOptions = {},
  deps: Partial<SeekablePlayerDeps> = {},
): Player {
  const prepareStream = deps.prepareStream ?? defaultPrepareStream;
  const attachPipeline = deps.attachPipeline ?? defaultAttachPipeline;
  const log = new Log("seekablePlayer");

  const mergedPlay = mergePlayStreamOptions(options.play ?? {});
  const playType = mergedPlay.type;

  let conn: WebRtcConnWrapper | undefined;
  let connConfigured = false;
  // Monotonic token: every start/seek/stop bumps it so stale async continuations from a superseded
  // segment can detect they've been replaced and bail out.
  let generation = 0;
  let stopped = false;
  let positionSeconds = Math.max(0, Math.floor(options.prepare?.startTime ?? 0));

  let currentAbort: AbortController | undefined;
  let currentController: { setVolume: (v: number) => Promise<boolean> } | undefined;
  let currentPipeline: AttachedPipeline | undefined;

  let resolveFinished!: () => void;
  let rejectFinished!: (err: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  let settled = false;
  const succeed = () => {
    if (settled) return;
    settled = true;
    resolveFinished();
  };
  const fail = (err: unknown) => {
    if (settled) return;
    settled = true;
    rejectFinished(err instanceof Error ? err : new Error(String(err)));
  };

  function teardownConn() {
    if (!conn) return;
    if (playType === "go-live") streamer.stopStream();
    else streamer.signalVideo(false);
    conn.mediaConnection.setSpeaking(false);
    conn.mediaConnection.setVideoAttributes(false);
  }

  async function runSegment(startSeconds: number): Promise<void> {
    if (!conn) throw new Error("runSegment called before the connection was created");
    const gen = ++generation;

    // Tear down the previous segment's ffmpeg + pipeline (its rejections are ignored via gen check).
    currentAbort?.abort();
    currentPipeline?.destroy();
    currentPipeline = undefined;

    const abort = new AbortController();
    currentAbort = abort;

    const prepareOptions: Partial<PrepareStreamOptions> = {
      ...(options.prepare ?? {}),
    };
    delete prepareOptions.startTime;
    if (startSeconds > 0) prepareOptions.startTime = startSeconds;

    const { promise, controller, output } = prepareStream(
      input,
      prepareOptions,
      abort.signal,
    );
    if (gen !== generation) {
      abort.abort();
      return;
    }
    currentController = controller;
    positionSeconds = startSeconds;

    // Surface ffmpeg failures — but not aborts (seek/stop) or superseded generations.
    promise.catch((err: unknown) => {
      if (gen !== generation || stopped || abort.signal.aborted) return;
      log.error({ err }, "ffmpeg failed");
      fail(err);
    });

    let pipeline: AttachedPipeline;
    try {
      pipeline = await attachPipeline(
        conn,
        streamer,
        output,
        { ...mergedPlay, configureConn: !connConfigured },
        abort.signal,
      );
    } catch (err) {
      if (gen !== generation || stopped) return;
      fail(err);
      return;
    }
    if (gen !== generation) {
      pipeline.destroy();
      abort.abort();
      return;
    }
    connConfigured = true;
    currentPipeline = pipeline;

    pipeline.done
      .then(() => {
        // Natural end of media for THIS segment. Superseded (seek) or stopped segments are ignored;
        // their replacement drives playback.
        if (gen !== generation || stopped) return;
        teardownConn();
        succeed();
      })
      .catch(() => {
        // Aborted by a seek/stop — the new segment (or stop()) owns the outcome.
      });
  }

  return {
    get finished() {
      return finished;
    },
    get position() {
      return positionSeconds;
    },
    async start() {
      if (stopped) return;
      if (playType === "go-live") {
        conn = await streamer.createStream();
      } else {
        if (!streamer.voiceConnection)
          throw new Error("Bot is not connected to a voice channel");
        conn = streamer.voiceConnection.webRtcConn;
        streamer.signalVideo(true);
      }
      await runSegment(positionSeconds);
    },
    async seek(seconds: number) {
      if (stopped || !conn) return;
      await runSegment(Math.max(0, Math.floor(seconds)));
    },
    async setVolume(volume: number) {
      return currentController ? currentController.setVolume(volume) : false;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      currentAbort?.abort();
      currentPipeline?.destroy();
      currentPipeline = undefined;
      teardownConn();
      succeed();
    },
  };
}
