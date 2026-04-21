import type { WebSocketLikeCtor } from "#ws/socket-helpers.ts";

type Listener = (event: unknown) => void;

export class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readonly CONNECTING = FakeWebSocket.CONNECTING;
  public readonly OPEN = FakeWebSocket.OPEN;
  public readonly CLOSING = FakeWebSocket.CLOSING;
  public readonly CLOSED = FakeWebSocket.CLOSED;

  public url: string;
  public readyState: number = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];

  private readonly listeners = new Map<string, Set<Listener>>();

  public constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      // Match real WebSocket: don't transition to OPEN if close() was
      // called (or the server aborted) before the handshake completed.
      if (this.readyState !== FakeWebSocket.CONNECTING) {
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  public addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  public removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code: 1000, reason: "" });
  }

  public pushServerMessage(data: unknown): void {
    this.emit("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  public forceClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code: 1006, reason: "abnormal" });
  }

  private emit(type: string, event: unknown): void {
    const bucket = this.listeners.get(type);
    if (bucket === undefined) {
      return;
    }
    for (const listener of bucket) {
      listener(event);
    }
  }
}

export function createFakeWebSocketFactory(): {
  Impl: WebSocketLikeCtor;
  instances: FakeWebSocket[];
} {
  const instances: FakeWebSocket[] = [];
  class BoundFake extends FakeWebSocket {
    public constructor(url: string) {
      super(url);
      instances.push(this);
    }
  }
  return { Impl: BoundFake, instances };
}
