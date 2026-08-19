const INITIAL_RECONNECT_DELAY_MILLISECONDS = 1000;
const MAX_RECONNECT_DELAY_MILLISECONDS = 30_000;

export const CUSTOM_SOCKET_STABLE_MILLISECONDS = 30_000;

export function customSocketReconnectDelay(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError(
      "WebSocket reconnect attempt must be a non-negative integer",
    );
  }
  return Math.min(
    INITIAL_RECONNECT_DELAY_MILLISECONDS * 2 ** attempt,
    MAX_RECONNECT_DELAY_MILLISECONDS,
  );
}

export function isTerminalCustomSocketClose(code: number): boolean {
  return code === 1008;
}
