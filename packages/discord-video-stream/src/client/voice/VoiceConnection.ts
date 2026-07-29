import { BaseMediaConnection } from "./BaseMediaConnection.js";
import type { MediaConnectionCloseInfo } from "./BaseMediaConnection.js";
import type { StreamConnection } from "./StreamConnection.js";

export class VoiceConnection extends BaseMediaConnection {
  private _streamConnection: StreamConnection | undefined;
  /**
   * The active or most recently stopped Go-Live transport. A remote 4014 can arrive after
   * Streamer.stopStream() clears streamConnection, so keep its close relay until a replacement
   * child takes ownership. Once this VoiceConnection becomes unreachable, the stopped child and
   * relay are collected together.
   */
  private observedStreamConnection: StreamConnection | undefined;
  private readonly relayStreamClose = (
    info: MediaConnectionCloseInfo,
  ): void => {
    this.emit("close", info);
  };

  public get streamConnection(): StreamConnection | undefined {
    return this._streamConnection;
  }

  public set streamConnection(connection: StreamConnection | undefined) {
    if (connection === this._streamConnection) {
      return;
    }
    this._streamConnection = connection;
    if (connection === undefined) {
      return;
    }
    this.observedStreamConnection?.off("close", this.relayStreamClose);
    this.observedStreamConnection = connection;
    this.observedStreamConnection.on("close", this.relayStreamClose);
  }

  public override get daveChannelId() {
    return this.channelId;
  }

  public override get serverId(): string {
    return this.guildId ?? this.channelId; // for guild vc it is the guild id, for dm voice it is the channel id
  }

  public override stop(): void {
    super.stop();
    const streamConnection = this.streamConnection;
    this.streamConnection = undefined;
    streamConnection?.stop();
  }
}
