import type { ArchivedSpanIndexRow, TraceDetail } from "./llm-traces/index.ts";
import { buildTraceDetailFromInternalSpans } from "./trajectory/trajectory-otlp.ts";
import {
  archivedRowsToInternalSpans,
  otlpToInternalSpans,
} from "./trajectory/trajectory-spans.ts";

export type OtlpEventShape = {
  readonly name: string;
  readonly timeUnixNano: string;
  readonly attributes: Readonly<Record<string, unknown>>;
};

export type OtlpSpanShape = {
  readonly traceId?: string | undefined;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly kind?: number | string | undefined;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly status: "ok" | "error" | "unset";
  readonly statusMessage: string | null;
  readonly serviceName?: string | undefined;
  readonly scopeName?: string | null | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resourceAttributes?: Readonly<Record<string, unknown>> | undefined;
  readonly events?: readonly OtlpEventShape[] | undefined;
};

export type OtlpTraceShape = {
  readonly traceId: string;
  readonly spans: readonly OtlpSpanShape[];
};

export function normalizeOtlpTrace(input: {
  traceId: string;
  trace: OtlpTraceShape;
  hydratedEnvelopes?: ReadonlyMap<string, Record<string, unknown>>;
}): TraceDetail {
  const internalSpans = otlpToInternalSpans(
    input.trace,
    input.hydratedEnvelopes,
  );
  return buildTraceDetailFromInternalSpans(
    input.traceId,
    "tempo",
    internalSpans,
  );
}

export function normalizeArchivedTrace(input: {
  traceId: string;
  rows: readonly ArchivedSpanIndexRow[];
  envelopes: ReadonlyMap<string, Record<string, unknown>>;
}): TraceDetail {
  const internalSpans = archivedRowsToInternalSpans(
    input.rows,
    input.envelopes,
  );
  return buildTraceDetailFromInternalSpans(
    input.traceId,
    "archive",
    internalSpans,
  );
}
