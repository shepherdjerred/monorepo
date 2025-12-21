import { getConfig } from "../config/index.js";

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

function formatLogEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS.debug >= getLogLevel()) {
      console.log(formatLogEntry("debug", message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS.info >= getLogLevel()) {
      console.log(formatLogEntry("info", message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS.warn >= getLogLevel()) {
      console.warn(formatLogEntry("warn", message, meta));
    }
  },

  error(
    message: string,
    error?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    if (LOG_LEVELS.error >= getLogLevel()) {
      const errorMeta =
        error instanceof Error
          ? { error: { name: error.name, message: error.message, stack: error.stack } }
          : error !== undefined
            ? { error }
            : {};
      console.error(formatLogEntry("error", message, { ...meta, ...errorMeta }));
    }
  },
};
