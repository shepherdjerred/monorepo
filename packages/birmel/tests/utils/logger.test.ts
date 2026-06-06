import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  logs as logsAPI,
  type Logger as OtelLogger,
  type LoggerProvider,
} from "@opentelemetry/api-logs";
import {
  logger,
  setOtlpLogsEnabled,
} from "@shepherdjerred/birmel/utils/logger.ts";

// Regression coverage for the logger <-> OTel diag feedback loop that caused
// `RangeError: Maximum call stack size exceeded`. A shut-down LoggerProvider
// emits a diag warning on every `getLogger()` call; tracing.ts routes diag
// through this logger, so the warning re-enters `logger.warn` -> emitOtlp ->
// getLogger -> diag.warn -> ... without the re-entrancy guard.

afterEach(() => {
  // Reset global OTel state and re-enable emission so tests don't leak.
  logsAPI.disable();
  setOtlpLogsEnabled(true);
});

describe("logger OTLP emission", () => {
  test("does not infinitely recurse when getLogger re-enters the logger", () => {
    let getLoggerCalls = 0;

    // A LoggerProvider whose getLogger() re-enters the app logger, exactly the
    // way a shut-down OTel LoggerProvider's diag warning does in production.
    const reentrantProvider: LoggerProvider = {
      getLogger(): OtelLogger {
        getLoggerCalls += 1;
        logger.warn("otel: A shutdown LoggerProvider cannot provide a Logger");
        return {
          emit(): void {
            // no-op sink
          },
          enabled(): boolean {
            return true;
          },
        };
      },
    };

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {
      // silence the structured warn lines this test deliberately produces
    });

    try {
      logsAPI.disable();
      logsAPI.setGlobalLoggerProvider(reentrantProvider);
      setOtlpLogsEnabled(true);

      // Without the guard this overflows the stack; with it, the re-entrant
      // emitOtlp short-circuits so getLogger runs exactly once.
      expect(() => {
        logger.warn("trigger");
      }).not.toThrow();

      expect(getLoggerCalls).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("setOtlpLogsEnabled(false) stops emitting to the provider", () => {
    let getLoggerCalls = 0;
    const provider: LoggerProvider = {
      getLogger(): OtelLogger {
        getLoggerCalls += 1;
        return {
          emit(): void {
            // no-op sink
          },
          enabled(): boolean {
            return true;
          },
        };
      },
    };

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {
      // silence structured warn output
    });

    try {
      logsAPI.disable();
      logsAPI.setGlobalLoggerProvider(provider);

      setOtlpLogsEnabled(false);
      logger.warn("should-not-emit");
      expect(getLoggerCalls).toBe(0);

      setOtlpLogsEnabled(true);
      logger.warn("should-emit");
      expect(getLoggerCalls).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
