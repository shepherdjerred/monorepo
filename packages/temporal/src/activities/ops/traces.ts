import type {
  TraceSearch,
  TraceSummary,
} from "@shepherdjerred/ops-clients/tempo.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { tracesLink } from "./ops-links.ts";
import {
  metric,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

export const TRACE_WINDOW_MS = 60 * 60 * 1000;
/** Only the noisiest services are listed; the metrics cover the rest. */
const LISTED_SERVICES = 10;
/** Traces whose root span has not arrived are grouped under this name. */
const UNKNOWN_ROOT = "(no root span)";

type TraceKind = {
  id: "error-traces" | "slow-traces";
  noun: string;
  condition: string;
  linkLabel: string;
};

const ERROR_KIND: TraceKind = {
  id: "error-traces",
  noun: "error trace",
  condition: "status = error",
  linkLabel: "Error traces",
};

const SLOW_KIND: TraceKind = {
  id: "slow-traces",
  noun: "slow trace",
  condition: `duration > ${String(OPS_POLICY.slowTraceSeconds)}s`,
  linkLabel: "Slow traces",
};

function groupByRootService(
  traces: readonly TraceSummary[],
): Map<string, TraceSummary[]> {
  const groups = new Map<string, TraceSummary[]>();
  for (const trace of traces) {
    const key = trace.rootServiceName ?? UNKNOWN_ROOT;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [trace]);
    } else {
      group.push(trace);
    }
  }
  return groups;
}

function plural(count: number, noun: string, truncated: boolean): string {
  const prefix = truncated ? "≥" : "";
  return `${prefix}${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function kindSignals(
  search: TraceSearch,
  kind: TraceKind,
  context: OpsContext,
): SignalInput[] {
  return [...groupByRootService(search.traces)]
    .toSorted(([, left], [, right]) => right.length - left.length)
    .slice(0, LISTED_SERVICES)
    .map(([serviceName, traces]) => {
      const slowest = traces.reduce((worst, trace) =>
        trace.durationMs > worst.durationMs ? trace : worst,
      );
      const service = context.services.byId(serviceName);
      const example =
        slowest.rootTraceName === undefined
          ? ""
          : ` · slowest: ${slowest.rootTraceName} (${String(Math.round(slowest.durationMs))} ms)`;
      return {
        id: `traces:${kind.id}:${serviceName}`,
        source: "traces",
        section: "observability",
        ...(service === undefined ? {} : { service: service.id }),
        kind: kind.id,
        severity: "info",
        needsMe: false,
        title: truncate(
          `${serviceName}: ${plural(traces.length, kind.noun, search.truncated)} in 1h`,
          200,
        ),
        detail: truncate(`Root span service ${serviceName}${example}`, 500),
        attributes: {
          rootServiceName: serviceName,
          count: traces.length,
          slowestMs: Math.round(slowest.durationMs),
          exampleTraceId: slowest.traceId,
        },
        links:
          serviceName === UNKNOWN_ROOT
            ? []
            : [tracesLink(serviceName, kind.condition, kind.linkLabel)],
      } satisfies SignalInput;
    });
}

/**
 * Error and slow traces from the last hour, grouped by root service.
 * Like error log volume, traces are triage context rather than paging, so
 * every signal is `info`; alerts own severity.
 */
export function mapTraces(
  errors: TraceSearch,
  slow: TraceSearch,
  context: OpsContext,
): OpsCollection {
  return {
    signals: [
      ...kindSignals(errors, ERROR_KIND, context),
      ...kindSignals(slow, SLOW_KIND, context),
    ],
    metrics: [
      metric({
        section: "observability",
        source: "traces",
        id: METRIC_IDS.traceErrors1h,
        label: errors.truncated ? "Error traces (1h, ≥)" : "Error traces (1h)",
        value: errors.traces.length,
        unit: "count",
      }),
      metric({
        section: "observability",
        source: "traces",
        id: METRIC_IDS.slowTraces1h,
        label: slow.truncated
          ? `Traces > ${String(OPS_POLICY.slowTraceSeconds)}s (1h, ≥)`
          : `Traces > ${String(OPS_POLICY.slowTraceSeconds)}s (1h)`,
        value: slow.traces.length,
        unit: "count",
      }),
    ],
    changes: [],
  };
}
