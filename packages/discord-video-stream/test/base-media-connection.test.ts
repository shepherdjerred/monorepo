import { describe, expect, test } from "bun:test";
import { Client } from "discord.js-selfbot-v13";
import {
  BaseMediaConnection,
  type MediaConnectionCloseInfo,
  type VoiceGatewaySocket,
} from "../src/client/voice/BaseMediaConnection.js";
import { Streamer } from "../src/client/Streamer.js";

type Listener = (event: unknown) => void;

/** Records sends/closes and lets tests fire gateway events by hand. */
class FakeVoiceSocket {
  binaryType: WebSocket["binaryType"] = "arraybuffer";
  readyState: WebSocket["readyState"] = 1;
  readonly url: string;
  readonly sent: unknown[] = [];
  readonly closeCalls: (number | undefined)[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  // Real sockets emit `close` asynchronously; tests fire it explicitly via fireClose.
  close(code?: number): void {
    this.closeCalls.push(code);
  }

  fireClose(code: number): void {
    for (const listener of this.listeners.get("close") ?? []) {
      listener({ code });
    }
  }
}

class TestMediaConnection extends BaseMediaConnection {
  readonly sockets: FakeVoiceSocket[] = [];

  override get serverId(): string {
    return "guild-1";
  }

  override get daveChannelId(): string {
    return "channel-1";
  }

  protected override createWebSocket(url: string): VoiceGatewaySocket {
    const socket = new FakeVoiceSocket(url);
    this.sockets.push(socket);
    return socket;
  }
}

function connect(): TestMediaConnection {
  const streamer = new Streamer(new Client());
  const conn = new TestMediaConnection(
    streamer,
    "guild-1",
    "bot-1",
    "channel-1",
    () => {},
  );
  // Session + tokens gathered → start() creates the first (fake) websocket.
  conn.setSession("session-1");
  conn.setTokens("voice.example.discord.media", "token-1");
  expect(conn.sockets).toHaveLength(1);
  return conn;
}

function collectCloses(conn: TestMediaConnection): MediaConnectionCloseInfo[] {
  const closes: MediaConnectionCloseInfo[] = [];
  conn.on("close", (info) => closes.push(info));
  return closes;
}

describe("BaseMediaConnection close handling", () => {
  test("resumable close (4015) resumes internally without emitting close", () => {
    const conn = connect();
    const closes = collectCloses(conn);

    conn.sockets[0]?.fireClose(4015);

    expect(conn.sockets).toHaveLength(2);
    expect(closes).toHaveLength(0);
    expect(conn.status.resuming).toBe(true);
  });

  test("non-resumable close (4006) emits close with deliberate=false", () => {
    const conn = connect();
    const closes = collectCloses(conn);

    conn.sockets[0]?.fireClose(4006);

    expect(conn.sockets).toHaveLength(1);
    expect(closes).toEqual([
      { code: 4006, canResume: false, deliberate: false },
    ]);
  });

  test("disconnected close (4014) emits close with deliberate=true", () => {
    const conn = connect();
    const closes = collectCloses(conn);

    conn.sockets[0]?.fireClose(4014);

    expect(conn.sockets).toHaveLength(1);
    expect(closes).toEqual([{ code: 4014, canResume: false, deliberate: true }]);
  });

  test("local stop() suppresses both the close event and the phantom resume", () => {
    const conn = connect();
    const closes = collectCloses(conn);

    conn.stop();
    // The ws close that stop() triggered lands afterwards with a resumable-looking code.
    conn.sockets[0]?.fireClose(1000);

    expect(closes).toHaveLength(0);
    // Regression: upstream treated its own code-1000 close as resumable and opened a new socket.
    expect(conn.sockets).toHaveLength(1);
  });
});
