import { BaseMediaStream } from "./BaseMediaStream.js";
import type { AudioFrameSink } from "./AudioSink.js";
import type { StreamObserver } from "./StreamObserver.js";

export class AudioStream extends BaseMediaStream {
  /**
   * Typed as the structural {@link AudioFrameSink} rather than the concrete connection wrapper:
   * this class only ever calls `sendAudioFrame`, and widening the parameter lets a consumer slot
   * a mixer/gain stage in front of the transport without a proxy object or a type assertion. The
   * connection wrapper satisfies the type as-is, so the ordinary call site is unchanged.
   */
  private _conn: AudioFrameSink;

  constructor(
    conn: AudioFrameSink,
    noSleep = false,
    observer?: StreamObserver,
  ) {
    super("audio", noSleep, observer);
    this._conn = conn;
  }

  protected override async _sendFrame(
    frame: Buffer,
    frametime: number,
  ): Promise<void> {
    this._conn.sendAudioFrame(frame, frametime);
  }
}
