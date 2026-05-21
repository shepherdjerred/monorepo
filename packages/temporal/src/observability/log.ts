import {
  logs as logsAPI,
  SeverityNumber,
  type LogAttributes,
} from "@opentelemetry/api-logs";
import { z } from "zod";
import { getTraceContext } from "#observability/tracing.ts";

type LogLevel = "debug" | "info" | "warning" | "error";

const SEVERITY_NUMBER: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warning: SeverityNumber.WARN,
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

function toLogAttributes(meta: Record<string, unknown>): LogAttributes {
  const out: LogAttributes = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    const parsed = LogAttrValueSchema.safeParse(value);
    out[key] = parsed.success ? parsed.data : JSON.stringify(value);
  }
  return out;
}

/**
 * Emit an OTLP LogRecord through the globally registered LoggerProvider
 * without writing to stdout. The OTel logs API auto-attaches the active
 * span's trace_id/span_id to every record — that is what makes Grafana's
 * "Logs for this span" return the correlated lines.
 *
 * Use this for tacking OTLP emission onto existing log functions that
 * already handle stdout themselves (e.g. activity-specific `jsonLog` helpers
 * that attach Temporal activity context to each line). Use `log()` (below)
 * for new call sites that don't yet have a stdout writer.
 *
 * The `module` field doubles as the OTel logger name (instrumentation
 * scope), so `{service_name="temporal-worker"} | scope_name="<module>"`
 * filters in LogQL work without additional wiring.
 */
export function emitOtel(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const scope =
    typeof fields["module"] === "string" && fields["module"].length > 0
      ? `temporal-worker.${fields["module"]}`
      : "temporal-worker";
  logsAPI.getLogger(scope).emit({
    severityNumber: SEVERITY_NUMBER[level],
    severityText: level,
    body: message,
    attributes: toLogAttributes(fields),
  });
}

/**
 * Structured log emitter. Writes a single JSON line to stdout (so `kubectl
 * logs` still works) and emits an OTLP LogRecord through the globally
 * registered LoggerProvider via {@link emitOtel}.
 */
export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const traceContext = getTraceContext();
  const stdoutEntry = {
    timestamp: new Date().toISOString(),
    level,
    msg: message,
    component: "temporal-worker",
    ...traceContext,
    ...fields,
  };
  // Temporal's ESLint config disallows console.log; match the rest of the
  // package by writing all stdout JSON via console.warn / console.error.
  const line = JSON.stringify(stdoutEntry);
  if (level === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }

  emitOtel(level, message, fields);
}
