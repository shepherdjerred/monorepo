import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";

const logger = loggers.scheduler.child("job-runner");

/**
 * Number of consecutive failures we tolerate at warn level before escalating
 * to error. Most failures we observe in the wild are transient DNS/abort
 * blips against the Discord API; promoting every blip to `error` clutters
 * Sentry and Loki alerts. After this many in a row we assume the issue is
 * persistent and want to be paged.
 */
const CONSECUTIVE_FAILURE_ESCALATION_THRESHOLD = 3;

/**
 * Classify an error as transient (network/abort) vs. genuinely unexpected.
 *
 * Bun's fetch surfaces DNS resolution failures with the message
 * `Was there a typo in the url or port?`. AbortError comes from
 * AbortSignal.timeout. Both indicate "try again later" rather than "broken
 * forever".
 */
function isTransientError(error: Error): boolean {
  const name = error.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }
  const message = error.message.toLowerCase();
  if (message.includes("was there a typo in the url or port")) {
    return true;
  }
  if (
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("eai_again") ||
    message.includes("getaddrinfo")
  ) {
    return true;
  }
  return false;
}

const consecutiveFailures = new Map<string, number>();

/**
 * Throws if the signal has been aborted; otherwise returns. Centralizes the
 * pattern callers use to surface scheduler timeouts at the next yield point.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    throw reason instanceof Error ? reason : new Error("Scheduled job aborted");
  }
}

export type ScheduledJobOptions = {
  /** Identifier used for span name + log module + failure tracking. */
  name: string;
  /** Wallclock timeout for the job; default 5 min. */
  timeoutMs?: number;
};

/**
 * Run a scheduled job with consistent observability and resilience.
 *
 * - Wraps the job in an OpenTelemetry span (`job.<name>`) so the run shows
 *   up in Tempo with full propagation to any tools the job invokes.
 * - Enforces a wallclock timeout via `AbortSignal.timeout`. The signal is
 *   passed to the job body so callers can plumb it into their HTTP/Discord
 *   calls; the helper also throws a TimeoutError if the body itself doesn't
 *   honour the signal.
 * - Tracks consecutive failures per job. Transient failures (DNS, abort,
 *   timeout) log at `warn` until they hit
 *   {@link CONSECUTIVE_FAILURE_ESCALATION_THRESHOLD} in a row, at which
 *   point they escalate to `error` + Sentry capture. Non-transient errors
 *   always escalate immediately.
 * - Resets the consecutive-failure counter on success.
 */
export async function runScheduledJob(
  options: ScheduledJobOptions,
  body: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const { name, timeoutMs = 5 * 60 * 1000 } = options;
  return withSpan(`job.${name}`, {}, async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort(
        new Error(
          `Scheduled job ${name} exceeded ${String(timeoutMs)}ms timeout`,
        ),
      );
    }, timeoutMs);
    timer.unref();

    try {
      await body(ac.signal);
      const previousFailures = consecutiveFailures.get(name) ?? 0;
      if (previousFailures > 0) {
        logger.info("Scheduled job recovered after failures", {
          job: name,
          previousFailures,
        });
        consecutiveFailures.delete(name);
      }
    } catch (rawError) {
      const error = toError(rawError);
      const failureCount = (consecutiveFailures.get(name) ?? 0) + 1;
      consecutiveFailures.set(name, failureCount);

      const transient = isTransientError(error);
      const escalated =
        !transient || failureCount >= CONSECUTIVE_FAILURE_ESCALATION_THRESHOLD;

      const meta = {
        job: name,
        consecutiveFailures: failureCount,
        transient,
      };

      if (escalated) {
        logger.error(`Scheduled job failed: ${name}`, error, meta);
        captureException(error, {
          operation: `scheduled.${name}`,
          extra: meta,
        });
      } else {
        logger.warn(`Scheduled job failed (transient): ${name}`, {
          ...meta,
          error: error.message,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  });
}
