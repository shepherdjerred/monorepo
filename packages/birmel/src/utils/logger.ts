import { getConfig } from "@shepherdjerred/birmel/config/index.js";
import { getTraceContext } from "@shepherdjerred/birmel/observability/tracing.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): number {
  try {
    const config = getConfig();
    return LOG_LEVELS[config.logging.level];
  } catch {
    return LOG_LEVELS.info;
  }
}

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  spanId?: string;
  module?: string;
  [key: string]: unknown;
};

function formatLogEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
  moduleName?: string,
): string {
  const traceContext = getTraceContext();

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...traceContext,
    ...(moduleName != null && moduleName.length > 0
      ? { module: moduleName }
      : {}),
    ...meta,
  };

  return JSON.stringify(entry);
}

export type Logger = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (
    message: string,
    error?: unknown,
    meta?: Record<string, unknown>,
  ) => void;
  child: (module: string) => Logger;
};

function createLogger(moduleName?: string): Logger {
  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.debug >= getLogLevel()) {
        console.log(formatLogEntry("debug", message, meta, moduleName));
      }
    },

    info(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.info >= getLogLevel()) {
        console.log(formatLogEntry("info", message, meta, moduleName));
      }
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.warn >= getLogLevel()) {
        console.warn(formatLogEntry("warn", message, meta, moduleName));
      }
    },

    error(
      message: string,
      error?: unknown,
      meta?: Record<string, unknown>,
    ): void {
      if (LOG_LEVELS.error >= getLogLevel()) {
        let errorMeta: Record<string, unknown>;
        if (error instanceof Error) {
          errorMeta = {
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
          };
        } else if (error === undefined) {
          errorMeta = {};
        } else {
          errorMeta = { error };
        }
        console.error(
          formatLogEntry(
            "error",
            message,
            { ...meta, ...errorMeta },
            moduleName,
          ),
        );
      }
    },

    child(module: string): Logger {
      const childModule =
        moduleName != null && moduleName.length > 0
          ? `${moduleName}.${module}`
          : module;
      return createLogger(childModule);
    },
  };
}

// Default root logger
export const logger = createLogger();

// Pre-configured module loggers for convenience
export const loggers = {
  agent: createLogger("agent"),
  discord: createLogger("discord"),
  voice: createLogger("voice"),
  scheduler: createLogger("scheduler"),
  tools: createLogger("tools"),
  memory: createLogger("memory"),
  config: createLogger("config"),
  persona: createLogger("persona"),
  database: createLogger("database"),
  events: createLogger("events"),
  automation: createLogger("automation"),
  editor: createLogger("editor"),
};
