import { Log } from "debug-level";
import { setTimeout } from "node:timers/promises";
import { Writable } from "node:stream";
import type { Packet } from "node-av";
import type { SendStats, StreamObserver } from "./StreamObserver.js";

export class BaseMediaStream extends Writable {
  private _pts: number | undefined;
  /**
   * Max sender-side A/V pts divergence (ms) before the ahead/behind correction engages. Must
   * exceed ordinary demux interleave jitter — one video frame (33 ms at 30 fps) plus one audio
   * frame (20 ms Opus) — or big-packet scenes trip the correction on every few frames, and each
   * correction's `resetTimingCompensation()` re-anchors the schedule, permanently locking in the
   * wait's overshoot. At the old 20 ms tolerance that leak sustained ~0.94x production on
   * heavy-bitrate scenes (2026-07-18 stutter investigation). Sender-side skew at this scale is
   * invisible to viewers: the receiver schedules frames by RTP timestamp; this tolerance only
   * bounds sender buffer divergence.
   */
  private _syncTolerance = 60;
  private _loggerSend: Log;
  private _loggerSync: Log;
  private _loggerSleep: Log;

  private _noSleep: boolean;
  private _startTime: number | undefined;
  private _startPts: number | undefined;
  private _sync = true;
  private _syncStream: BaseMediaStream | undefined;
  /** "video" | "audio" — the stream kind, reused as the {@link SendStats} label. */
  private _kind: SendStats["kind"];
  private _observer: StreamObserver | undefined;

  constructor(type: SendStats["kind"], noSleep = false, observer?: StreamObserver) {
    super({ objectMode: true, highWaterMark: 0 });
    this._loggerSend = new Log(`stream:${type}:send`);
    this._loggerSync = new Log(`stream:${type}:sync`);
    this._loggerSleep = new Log(`stream:${type}:sleep`);
    this._noSleep = noSleep;
    this._kind = type;
    this._observer = observer;
  }

  get sync(): boolean {
    return this._sync;
  }
  set sync(val: boolean) {
    this._sync = val;
    if (val) this._loggerSync.debug("Sync enabled");
    else this._loggerSync.debug("Sync disabled");
  }
  get syncStream() {
    return this._syncStream;
  }
  set syncStream(stream: BaseMediaStream | undefined) {
    if (stream !== undefined && this === stream.syncStream)
      throw new Error("Cannot sync 2 streams with eachother");
    this._syncStream = stream;
  }
  get noSleep(): boolean {
    return this._noSleep;
  }
  set noSleep(val: boolean) {
    this._noSleep = val;
    if (!val) this.resetTimingCompensation();
  }
  get pts(): number | undefined {
    return this._pts;
  }
  get syncTolerance() {
    return this._syncTolerance;
  }
  set syncTolerance(n: number) {
    if (n < 0) return;
    this._syncTolerance = n;
  }
  protected async _sendFrame(
    _frame: Buffer,
    _frametime: number,
  ): Promise<void> {
    throw new Error("Not implemented");
  }
  private ptsDelta() {
    if (this.pts !== undefined && this.syncStream?.pts !== undefined)
      return this.pts - this.syncStream.pts;
    return undefined;
  }
  private isAhead() {
    const delta = this.ptsDelta();
    return (
      this.syncStream?.writableEnded === false &&
      delta !== undefined &&
      delta > this.syncTolerance
    );
  }
  private isBehind() {
    const delta = this.ptsDelta();
    return (
      this.syncStream?.writableEnded === false &&
      delta !== undefined &&
      delta < -this.syncTolerance
    );
  }
  private resetTimingCompensation() {
    this._startTime = this._startPts = undefined;
  }
  override async _write(
    frame: Packet,
    _: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const { data, pts, duration, timeBase } = frame;
    if (!data) {
      frame.free();
      callback();
      return;
    }

    const frametime = (Number(duration) / timeBase.den) * timeBase.num * 1000;

    const start_sendFrame = performance.now();
    await this._sendFrame(Buffer.from(data), frametime);
    const end_sendFrame = performance.now();

    this._pts = (Number(pts) / timeBase.den) * timeBase.num * 1000;
    this.emit("pts", this._pts);

    const sendTime = end_sendFrame - start_sendFrame;
    const ratio = sendTime / frametime;
    this._loggerSend.debug(
      {
        stats: {
          pts: this._pts,
          frame_size: data.length,
          duration: sendTime,
          frametime,
        },
      },
      `Frame sent in ${sendTime.toFixed(2)}ms (${(ratio * 100).toFixed(2)}% frametime)`,
    );
    if (ratio > 1) {
      this._loggerSend.warn(
        {
          frame_size: data.length,
          duration: sendTime,
          frametime,
        },
        `Frame takes too long to send (${(ratio * 100).toFixed(2)}% frametime)`,
      );
    }
    this._observer?.onSendStats?.({
      kind: this._kind,
      ratio,
      sendTime,
      frametime,
    });

    this._startTime ??= start_sendFrame;
    this._startPts ??= this._pts;
    const sleep = Math.max(
      0,
      this._pts -
        this._startPts +
        frametime -
        (end_sendFrame - this._startTime),
    );
    if (this._noSleep || sleep === 0) {
      callback(null);
    } else if (this.sync && this.isBehind()) {
      this._loggerSync.debug(
        {
          stats: {
            pts: this.pts,
            pts_other: this.syncStream?.pts,
          },
        },
        "Stream is behind. Not sleeping for this frame",
      );
      this.resetTimingCompensation();
      callback(null);
    } else if (this.sync && this.isAhead()) {
      // Sleep only the excess beyond tolerance (re-checked each iteration as the partner stream
      // advances) instead of whole-frametime quanta: the loop exits within ~1 ms of the tolerance
      // boundary, so the resetTimingCompensation() below locks in timer slop instead of up to a
      // full frametime per event. The old whole-frametime wait leaked ≤ 33 ms of schedule per
      // ahead-event, which on heavy scenes (frequent events) compounded into sustained sub-realtime
      // production — the 2026-07-18 stutter root cause.
      do {
        const delta = this.ptsDelta();
        if (delta === undefined) break;
        const excess = delta - this.syncTolerance;
        if (excess <= 0) break;
        this._loggerSync.debug(
          {
            stats: {
              pts: this.pts,
              pts_other: this.syncStream?.pts,
              excess,
              frametime,
            },
          },
          `Stream is ahead. Waiting for ${excess}ms`,
        );
        await setTimeout(Math.min(excess, frametime));
      } while (this.sync && this.isAhead());
      this.resetTimingCompensation();
      callback(null);
    } else {
      this._loggerSleep.debug(
        {
          stats: {
            pts: this._pts,
            startPts: this._startPts,
            time: end_sendFrame,
            startTime: this._startTime,
            frametime,
          },
        },
        `Sleeping for ${sleep}ms`,
      );
      setTimeout(sleep).then(() => callback(null));
    }
    frame.free();
  }
  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    super._destroy(error, callback);
    this.syncStream = undefined;
  }
}
