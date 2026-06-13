/**
 * Minimal structured logger. Emits one JSON object per line to stdout so logs are queryable
 * in Loki. This module is the single sanctioned place that writes raw output; everything else
 * goes through the returned {@link Logger}.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

export type Logger = {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  child: (module: string) => Logger;
};

function write(
  level: LogLevel,
  module: string | null,
  message: string,
  meta?: LogMeta,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...(module === null ? {} : { module }),
    message,
    ...meta,
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function makeLogger(module: string | null): Logger {
  return {
    debug: (message, meta) => {
      write("debug", module, message, meta);
    },
    info: (message, meta) => {
      write("info", module, message, meta);
    },
    warn: (message, meta) => {
      write("warn", module, message, meta);
    },
    error: (message, meta) => {
      write("error", module, message, meta);
    },
    child: (childModule) =>
      makeLogger(module === null ? childModule : `${module}:${childModule}`),
  };
}

export const logger: Logger = makeLogger(null);
