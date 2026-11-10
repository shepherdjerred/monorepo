import * as Sentry from "@sentry/bun";
import {
  isGrpcDeadlineError,
  isGrpcServiceError,
  ServiceError,
} from "@temporalio/client";
import { log as jsonLog } from "#observability/log.ts";
import { formatError } from "#shared/format-error.ts";
import { retryUntilReady, type RetrySleep } from "#shared/startup-retry.ts";

const GRPC_UNAVAILABLE = 14;
// `NativeConnection.connect` throws the core bridge's TransportError, whose
// `@temporalio/worker` export is deprecated for external use. Its
// `instanceof` check reads this marker, so reading it directly is the same
// test without the internal import.
const TRANSPORT_ERROR_MARKER = Symbol.for("__temporal_isTransportError");
// @grpc/grpc-js `Client.waitForReady` rejects with this plain Error when the
// channel never becomes ready within the client's connect timeout, which is
// how `Connection.connect` reports an unreachable server.
const CLIENT_CONNECT_DEADLINE_MESSAGE = "Failed to connect before the deadline";

/**
 * True when a Temporal connection attempt failed because the server is not
 * reachable yet: the native worker connection's `TransportError` (TCP connect
 * or DNS failure), the gRPC client's ready deadline, or an UNAVAILABLE or
 * DEADLINE_EXCEEDED reply to the client's connect-time `GetSystemInfo` call.
 * Anything else, such as an authentication or namespace error, is a startup
 * contract failure and stays fatal.
 */
export function isTemporalUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (Reflect.get(error, TRANSPORT_ERROR_MARKER) === true) return true;
  if (!(error instanceof ServiceError)) {
    return error.message === CLIENT_CONNECT_DEADLINE_MESSAGE;
  }
  if (!isGrpcServiceError(error.cause)) return false;
  const code: number = error.cause.code;
  return code === GRPC_UNAVAILABLE || isGrpcDeadlineError(error.cause);
}

export type TemporalStartupConnectionInput<T> = {
  /** Which connection this is, for logs and the escalation message. */
  readonly target: "worker" | "client";
  readonly address: string;
  readonly connect: () => Promise<T>;
  readonly sleep?: RetrySleep;
  readonly random?: () => number;
  readonly escalate?: (message: string) => void;
};

/**
 * Connect to Temporal at worker startup, waiting out a server outage with the
 * shared jittered startup backoff instead of exiting. A crash-looping worker
 * would otherwise report one Bugsink exception per restart; this reports one
 * warning when the outage reaches the escalation attempt and keeps waiting.
 *
 * Shutdown signal handlers are installed only after startup, so SIGTERM during
 * this wait takes the default action and ends the process; there is no
 * separate closed state to observe here.
 */
export async function connectTemporalWhenReady<T>(
  input: TemporalStartupConnectionInput<T>,
): Promise<T> {
  let connection: { readonly value: T } | undefined;
  const escalate =
    input.escalate ??
    ((message: string) => {
      Sentry.captureMessage(message, "warning");
    });
  await retryUntilReady({
    operation: async () => {
      connection = { value: await input.connect() };
    },
    shouldRetry: isTemporalUnavailableError,
    isClosed: () => false,
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
    ...(input.random === undefined ? {} : { random: input.random }),
    onRetry: ({ attempt, delayMs, error }) => {
      jsonLog("warning", "Temporal server unreachable at startup; retrying", {
        target: input.target,
        address: input.address,
        attempt,
        delayMs,
        error: formatError(error),
      });
    },
    onEscalate: ({ attempt, error }) => {
      escalate(
        `Temporal ${input.target} connection to ${input.address} has failed ${String(attempt)} consecutive times at startup (latest error: ${formatError(error)}); still retrying`,
      );
    },
  });
  if (connection === undefined) {
    throw new Error(
      `Temporal ${input.target} startup connection ended without connecting`,
    );
  }
  return connection.value;
}
