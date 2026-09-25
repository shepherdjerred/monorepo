import type { NamespaceLogVolume } from "@shepherdjerred/ops-clients/loki.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { errorLogsLink } from "./ops-links.ts";
import {
  metric,
  serviceForNamespace,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

export const LOG_WINDOW = "1h";
/** Only the noisiest namespaces are listed; the total covers the rest. */
const LISTED_NAMESPACES = 10;

/**
 * Error log volume is context for triage, not an alert: log text is too
 * noisy to rank as a warning, so every row is `info`.
 */
export function mapLogs(
  volumes: readonly NamespaceLogVolume[],
  context: OpsContext,
): OpsCollection {
  const signals: SignalInput[] = volumes
    .filter((row) => row.lines > 0)
    .slice(0, LISTED_NAMESPACES)
    .map((row) => ({
      id: `logs:errors:${row.namespace}`,
      source: "logs",
      section: "observability",
      ...serviceForNamespace(context, row.namespace),
      kind: "error-log-volume",
      severity: "info",
      needsMe: false,
      title: `${row.namespace}: ${String(row.lines)} error lines in ${LOG_WINDOW}`,
      attributes: { namespace: row.namespace, lines: row.lines },
      links: [errorLogsLink(row.namespace)],
    }));
  return {
    signals,
    metrics: [
      metric({
        section: "observability",
        source: "logs",
        id: METRIC_IDS.logErrors1h,
        label: "Error log lines (1h)",
        value: volumes.reduce((total, row) => total + row.lines, 0),
        unit: "count",
      }),
    ],
    changes: [],
  };
}
