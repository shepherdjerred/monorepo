import { BaseMediaStream } from "./BaseMediaStream.js";
import type { WebRtcConnWrapper } from "../client/voice/WebRtcWrapper.js";
import type { StreamObserver } from "./StreamObserver.js";

export class VideoStream extends BaseMediaStream {
  private _conn: WebRtcConnWrapper;
  constructor(
    conn: WebRtcConnWrapper,
    noSleep = false,
    observer?: StreamObserver,
  ) {
    super("video", noSleep, observer);
    this._conn = conn;
  }

  protected override async _sendFrame(
    frame: Buffer,
    frametime: number,
  ): Promise<void> {
    this._conn.sendVideoFrame(frame, frametime);
  }
}
