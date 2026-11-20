import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { MusicMatchError } from "@shepherdjerred/streambot/music/matching.ts";
import {
  webErrorCode,
  type TelemetryOutcome,
  type WebErrorCode,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { WebError } from "./errors.ts";

export type WebFailure = {
  readonly status: number;
  readonly code: WebErrorCode;
  readonly outcome: TelemetryOutcome;
  /** `unexpected` is the only kind that is a server fault; `aborted` is the client leaving. */
  readonly kind: "expected" | "aborted" | "unexpected";
};

export function outcomeForStatus(status: number): TelemetryOutcome {
  if (status < 400) return "ok";
  if (status === 401 || status === 403) return "denied";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "unavailable" : "invalid";
}

/** One classification shared by the response mapper, request telemetry and command telemetry. */
export function classifyWebFailure(
  error: unknown,
  signal: AbortSignal,
): WebFailure {
  if (error instanceof WebError || error instanceof MusicError)
    return {
      status: error.status,
      code: webErrorCode(error.code),
      outcome: outcomeForStatus(error.status),
      kind: "expected",
    };
  if (
    error instanceof PlaybackCommandBoundaryError ||
    error instanceof MusicMatchError
  )
    return {
      status: 409,
      code: "playback_denied",
      outcome: "denied",
      kind: "expected",
    };
  if (signal.aborted)
    return {
      status: 503,
      code: "client_aborted",
      outcome: "aborted",
      kind: "aborted",
    };
  return {
    status: 503,
    code: "unavailable",
    outcome: "error",
    kind: "unexpected",
  };
}

const METHODS = ["GET", "POST", "HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"];

/** Request methods are client-chosen, so anything unusual is reported as `other`. */
export function webMethod(method: string): string {
  return METHODS.find((known) => known === method) ?? "other";
}

export function roundMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}
