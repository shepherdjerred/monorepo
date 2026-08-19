/**
 * Minimal structured logger. Emits one JSON object per line to stdout so logs are queryable
 * in Loki. This module is the single sanctioned place that writes raw output; everything else
 * goes through the returned {@link Logger}.
 */

import { trace } from "@opentelemetry/api";
import {
  logs as logsApi,
  SeverityNumber,
  type LogAttributes,
} from "@opentelemetry/api-logs";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

export type Logger = {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  child: (module: string) => Logger;
};

const severityNumbers: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const sensitiveKey = /authorization|password|secret|token|api[_-]?key/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (sensitiveKey.test(key)) return "[redacted]";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return "[binary omitted]";
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item));
  }
  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeValue(childKey, childValue);
    }
    return sanitized;
  }
  return value;
}

function sanitizeMeta(meta?: LogMeta): LogMeta {
  if (meta === undefined) return {};
  const sanitized: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

function toLogAttributes(meta: LogMeta): LogAttributes {
  const attributes: LogAttributes = {};
  for (const [key, value] of Object.entries(meta)) {
    switch (typeof value) {
      case "string":
      case "number":
      case "boolean":
        attributes[key] = value;
        break;
      case "object":
        if (value !== null) attributes[key] = JSON.stringify(value);
        break;
      case "bigint":
      case "symbol":
      case "undefined":
      case "function":
        break;
    }
  }
  return attributes;
}

let emittingOtlp = false;
let otlpLogsEnabled = true;

export function setOtlpLogsEnabled(enabled: boolean): void {
  otlpLogsEnabled = enabled;
}

function emitOtlp(
  level: LogLevel,
  module: string | null,
  message: string,
  meta: LogMeta,
): void {
  if (!otlpLogsEnabled || emittingOtlp) return;
  emittingOtlp = true;
  try {
    logsApi
      .getLogger(module === null ? "streambot" : `streambot.${module}`)
      .emit({
        severityNumber: severityNumbers[level],
        severityText: level,
        body: message,
        attributes: toLogAttributes(meta),
      });
  } finally {
    emittingOtlp = false;
  }
}

function write(
  level: LogLevel,
  module: string | null,
  message: string,
  meta?: LogMeta,
): void {
  const sanitized = sanitizeMeta(meta);
  const spanContext = trace.getActiveSpan()?.spanContext();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...(module === null ? {} : { module }),
    message,
    ...sanitized,
    ...(spanContext === undefined
      ? {}
      : { traceId: spanContext.traceId, spanId: spanContext.spanId }),
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
  emitOtlp(level, module, message, sanitized);
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
