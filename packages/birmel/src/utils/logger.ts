import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getTraceContext } from "@shepherdjerred/birmel/observability/tracing.ts";
import {
  logs as logsAPI,
  SeverityNumber,
  type LogAttributes,
} from "@opentelemetry/api-logs";
import { z } from "zod";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SEVERITY_NUMBER: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

// OTel attribute values are primitives or arrays of primitives. Loki's OTLP
// receiver stores these as queryable structured metadata; the LogQL filter
// syntax (`| key="..."`) only works on primitives, so non-conforming values
// are JSON-stringified rather than passed to the SDK (which would reject).
const PrimitiveAttrSchema = z.union([z.string(), z.number(), z.boolean()]);
const LogAttrValueSchema = z.union([
  PrimitiveAttrSchema,
  z.array(PrimitiveAttrSchema),
]);

function toLogAttributes(meta?: Record<string, unknown>): LogAttributes {
  if (meta == null) {
    return {};
  }
  const out: LogAttributes = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    const parsed = LogAttrValueSchema.safeParse(value);
    out[key] = parsed.success ? parsed.data : JSON.stringify(value);
  }
  return out;
}

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

// Emit a LogRecord to the OTLP pipeline alongside the stdout JSON write.
// The OTel logs API auto-attaches the active span's trace_id/span_id, which
// is the whole point — that's how Loki's "filter by trace ID" surfaces the
// matching lines for a span. The logger name doubles as Loki's
// instrumentation scope, useful for filtering "all logs from <module>".
function emitOtlp(
  level: LogLevel,
  message: string,
  attributes: LogAttributes,
  moduleName: string | undefined,
): void {
  const scope =
    moduleName != null && moduleName.length > 0
      ? `birmel.${moduleName}`
      : "birmel";
  logsAPI.getLogger(scope).emit({
    severityNumber: SEVERITY_NUMBER[level],
    severityText: level,
    body: message,
    attributes,
  });
}

function createLogger(moduleName?: string): Logger {
  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.debug >= getLogLevel()) {
        console.log(formatLogEntry("debug", message, meta, moduleName));
        emitOtlp("debug", message, toLogAttributes(meta), moduleName);
      }
    },

    info(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.info >= getLogLevel()) {
        console.log(formatLogEntry("info", message, meta, moduleName));
        emitOtlp("info", message, toLogAttributes(meta), moduleName);
      }
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      if (LOG_LEVELS.warn >= getLogLevel()) {
        console.warn(formatLogEntry("warn", message, meta, moduleName));
        emitOtlp("warn", message, toLogAttributes(meta), moduleName);
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
        const combinedMeta = { ...meta, ...errorMeta };
        console.error(
          formatLogEntry("error", message, combinedMeta, moduleName),
        );
        emitOtlp("error", message, toLogAttributes(combinedMeta), moduleName);
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
