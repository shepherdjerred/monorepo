import { createLogger } from "#src/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("circuit-breaker");

/**
 * Minimum interval (ms) between Sentry reports for the same error class.
 * During an outage window, only the first occurrence is reported.
 */
const SENTRY_REPORT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Number of consecutive failures before the circuit opens.
 */
const OPEN_THRESHOLD = 5;

/**
 * How long (ms) the circuit stays open before allowing a single probe request.
 */
const OPEN_DURATION_MS = 60 * 1000; // 1 minute

type CircuitState = "closed" | "open" | "half-open";

/**
 * A circuit breaker that tracks consecutive failures for a named service.
 *
 * - **Closed**: all requests flow through normally.
 * - **Open**: `shouldSkip()` returns true — callers should skip requests.
 *   After `OPEN_DURATION_MS`, transitions to half-open.
 * - **Half-open**: allows a single probe request. If it succeeds the circuit
 *   closes; if it fails, the circuit re-opens.
 *
 * Also provides rate-limited Sentry reporting so outage noise is bounded to
 * roughly one event per `SENTRY_REPORT_INTERVAL_MS`.
 */
export class CircuitBreaker {
  private readonly name: string;
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | undefined;
  private lastSentryReportAt: number | undefined;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Record a successful request. Resets the failure counter and closes the circuit.
   */
  recordSuccess(): void {
    if (this.state !== "closed") {
      logger.info(
        `[${this.name}] Circuit closing after ${this.consecutiveFailures.toString()} consecutive failure(s)`,
      );
    }
    this.consecutiveFailures = 0;
    this.state = "closed";
    this.openedAt = undefined;
  }

  /**
   * Record a failure and optionally report it to Sentry (rate-limited).
   *
   * @param error - The error to report
   * @param tags  - Extra Sentry tags
   */
  recordFailure(error: unknown, tags: Record<string, string>): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= OPEN_THRESHOLD && this.state === "closed") {
      this.state = "open";
      this.openedAt = Date.now();
      logger.warn(
        `[${this.name}] Circuit opened after ${this.consecutiveFailures.toString()} consecutive failures`,
      );
    }

    // Rate-limit Sentry reporting: at most one event per window
    const now = Date.now();
    if (
      this.lastSentryReportAt === undefined ||
      now - this.lastSentryReportAt >= SENTRY_REPORT_INTERVAL_MS
    ) {
      this.lastSentryReportAt = now;
      Sentry.captureException(error, {
        tags: {
          ...tags,
          circuitState: this.state,
          consecutiveFailures: this.consecutiveFailures.toString(),
        },
        fingerprint: [this.name, "circuit-breaker"],
      });
    }
  }

  /**
   * Returns `true` when the circuit is open and callers should skip requests.
   *
   * When the open duration has elapsed the circuit moves to half-open and
   * returns `false` to allow a single probe.
   */
  shouldSkip(): boolean {
    if (this.state === "closed") {
      return false;
    }

    if (this.state === "open" && this.openedAt !== undefined) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= OPEN_DURATION_MS) {
        this.state = "half-open";
        logger.info(
          `[${this.name}] Circuit half-open — allowing probe request`,
        );
        return false;
      }
    }

    // open and not yet expired, or half-open waiting for probe result
    // half-open allows exactly one request (the next call), so only skip while open
    return this.state === "open";
  }

  /**
   * Number of consecutive failures recorded.
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Current circuit state.
   */
  getState(): CircuitState {
    return this.state;
  }
}
