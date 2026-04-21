export class HaWebSocketError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HaWebSocketError";
  }
}

export class HaWebSocketAuthError extends HaWebSocketError {
  public constructor(detail: string) {
    super(`Home Assistant WebSocket auth failed: ${detail}`);
    this.name = "HaWebSocketAuthError";
  }
}

export class HaWebSocketClosedError extends HaWebSocketError {
  public constructor() {
    super("Home Assistant WebSocket is closed");
    this.name = "HaWebSocketClosedError";
  }
}

export class HaWebSocketResultError extends HaWebSocketError {
  public readonly code: string | undefined;

  public constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "HaWebSocketResultError";
    this.code = code;
  }
}
