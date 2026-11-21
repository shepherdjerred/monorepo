/**
 * The room event stream's connection lifecycle, as a pure transition function so it can be
 * tested without a browser. `use-room.ts` feeds it `EventSource` events and acts on the result.
 *
 * - `connecting`: an `EventSource` is open or reconnecting by itself.
 * - `live`: the stream delivered a room snapshot.
 * - `waiting`: the stream closed for good; reopen after `delayMs`, refetching `/api/room` first.
 * - `stopped`: the server refused this viewer; reconnecting cannot help until something changes.
 */
export type StopReason = "unauthorized" | "guild_denied" | "feature_disabled";

export type ConnectionState =
  | { readonly status: "connecting"; readonly attempt: number }
  | { readonly status: "live" }
  | {
      readonly status: "waiting";
      readonly attempt: number;
      readonly delayMs: number;
    }
  | { readonly status: "stopped"; readonly reason: StopReason };

export type ConnectionEvent =
  /** A `room` event arrived. */
  | { readonly type: "room" }
  /** The terminal `error` event, with its closed code. */
  | {
      readonly type: "terminal";
      readonly code: StopReason | "unavailable";
    }
  /**
   * A connection error. `closed` means the browser gave up (a non-200 answer such as a 429 stream
   * limit, which an `EventSource` cannot read); otherwise it is already reconnecting by itself.
   */
  | { readonly type: "dropped"; readonly closed: boolean }
  /** The page reopened the stream after waiting. */
  | { readonly type: "reopen" }
  /** `/api/room` answered with a status that says reconnecting will not help. */
  | { readonly type: "refused"; readonly reason: StopReason };

export const INITIAL_CONNECTION: ConnectionState = {
  status: "connecting",
  attempt: 0,
};

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** 1 s, 2 s, 4 s … capped at 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

function attemptOf(state: ConnectionState): number {
  return state.status === "connecting" || state.status === "waiting"
    ? state.attempt
    : 0;
}

function wait(attempt: number): ConnectionState {
  return { status: "waiting", attempt, delayMs: retryDelay(attempt) };
}

export function nextConnection(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (state.status === "stopped" && event.type !== "reopen") return state;
  switch (event.type) {
    case "room":
      return { status: "live" };
    case "terminal":
      return event.code === "unavailable"
        ? wait(attemptOf(state) + 1)
        : { status: "stopped", reason: event.code };
    case "dropped":
      return event.closed
        ? wait(attemptOf(state) + 1)
        : { status: "connecting", attempt: attemptOf(state) + 1 };
    case "reopen":
      return { status: "connecting", attempt: attemptOf(state) };
    case "refused":
      return { status: "stopped", reason: event.reason };
  }
}

/** Which refusal an `/api/room` status means, or `null` when retrying the stream may work. */
export function refusalFor(status: number, code: string): StopReason | null {
  if (status === 401) return "unauthorized";
  if (status !== 403) return null;
  return code === "feature_disabled" ? "feature_disabled" : "guild_denied";
}
