import { BaseMediaStream } from "./BaseMediaStream.js";
import type { WebRtcConnWrapper } from "../client/voice/WebRtcWrapper.js";
import type { StreamObserver } from "./StreamObserver.js";

export class AudioStream extends BaseMediaStream {
  private _conn: WebRtcConnWrapper;

  constructor(
    conn: WebRtcConnWrapper,
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
