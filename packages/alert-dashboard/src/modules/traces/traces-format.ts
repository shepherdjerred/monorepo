import { Temporal } from "@js-temporal/polyfill";
import {
  TraceRangeSchema,
  TraceStatusFilterSchema,
  type TraceRange,
  type TraceSource,
  type TraceStatusFilter,
  type TracesSearchQuery,
} from "@shepherdjerred/llm-observability/llm-traces";

import { age } from "#client/time.ts";

export const TEMPO_RANGES: readonly TraceRange[] = [
  "1h",
  "6h",
  "24h",
  "7d",
  "30d",
];

export const ARCHIVE_RANGES: readonly TraceRange[] = [
  "24h",
  "7d",
  "30d",
  "90d",
  "365d",
];

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const intFormat = new Intl.NumberFormat("en-US");

export function formatUsdTrace(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value === 0) {
    return "$0.00";
  }
  return value > 0 && value < 0.0001 ? "<$0.0001" : usdPrecise.format(value);
}

export function formatTokenInt(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : intFormat.format(Math.round(value));
}

export function epochMsToIso(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(Math.round(epochMs)).toString();
}

export function formatShortTimestamp(epochMs: number): string {
  const zdt = Temporal.Instant.fromEpochMilliseconds(
    Math.round(epochMs),
  ).toZonedDateTimeISO(Temporal.Now.timeZoneId());
  return zdt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ageFromEpochMs(epochMs: number | null): string {
  return epochMs === null || !Number.isFinite(epochMs)
    ? "never"
    : age(epochMsToIso(epochMs));
}

export function prettyPrintJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

function parseOptionalParam(
  params: URLSearchParams,
  key: string,
): string | undefined {
  const val = params.get(key)?.trim();
  return val === undefined || val === "" ? undefined : val;
}

export function parseTracesUrlState(params: URLSearchParams): {
  readonly source: TraceSource;
  readonly query: TracesSearchQuery;
} {
  const rawRange = parseOptionalParam(params, "range");
  const rawSource = parseOptionalParam(params, "source");
  const source: TraceSource =
    rawSource === "archive" || rawRange === "90d" || rawRange === "365d"
      ? "archive"
      : "tempo";

  const defaultRange: TraceRange = source === "archive" ? "365d" : "24h";
  const parsedRange = TraceRangeSchema.safeParse(rawRange);
  let range: TraceRange = parsedRange.success ? parsedRange.data : defaultRange;
  if (source === "tempo" && (range === "90d" || range === "365d")) {
    range = "30d";
  }
  if (source === "archive" && (range === "1h" || range === "6h")) {
    range = "24h";
  }

  const parsedStatus = TraceStatusFilterSchema.safeParse(
    parseOptionalParam(params, "status"),
  );
  const status: TraceStatusFilter = parsedStatus.success
    ? parsedStatus.data
    : "all";

  const service = parseOptionalParam(params, "service");
  const workload = parseOptionalParam(params, "workload");
  const provider = parseOptionalParam(params, "provider");
  const model = parseOptionalParam(params, "model");
  const subjectId = parseOptionalParam(params, "subjectId");
  const q = parseOptionalParam(params, "q");

  return {
    source,
    query: {
      source,
      range,
      status,
      limit: 50,
      ...(service === undefined ? {} : { service }),
      ...(workload === undefined ? {} : { workload }),
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(subjectId === undefined ? {} : { subjectId }),
      ...(q === undefined ? {} : { q }),
    },
  };
}
