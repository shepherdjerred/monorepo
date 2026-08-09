type MetricName =
  | "alert_dashboard_webhook_total"
  | "alert_dashboard_reconciliation_total"
  | "alert_dashboard_preview_failure_total"
  | "alert_dashboard_email_attempt_total";

type GaugeName =
  | "alert_dashboard_email_outbox_depth"
  | "alert_dashboard_failed_email_outbox_depth"
  | "alert_dashboard_oldest_pending_email_timestamp_seconds"
  | "alert_dashboard_last_reconciliation_timestamp_seconds"
  | "alert_dashboard_reconciliation_drift"
  | "alert_dashboard_open_alerts";

function metricKey(
  name: string,
  labels: Readonly<Record<string, string>>,
): string {
  const suffix = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
  return suffix.length === 0 ? name : `${name}{${suffix}}`;
}

export class Metrics {
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();

  increment(
    name: MetricName,
    labels: Readonly<Record<string, string>> = {},
    amount = 1,
  ): void {
    const key = metricKey(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + amount);
  }

  gauge(
    name: GaugeName,
    value: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    this.#gauges.set(metricKey(name, labels), value);
  }

  render(): string {
    const lines: string[] = [];
    const counterFamilies = new Set<string>();
    for (const [sample, value] of [...this.#counters.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const labelsStart = sample.indexOf("{");
      const family = labelsStart === -1 ? sample : sample.slice(0, labelsStart);
      if (!counterFamilies.has(family)) {
        lines.push(`# TYPE ${family} counter`);
        counterFamilies.add(family);
      }
      lines.push(`${sample} ${String(value)}`);
    }
    const gaugeFamilies = new Set<string>();
    for (const [sample, value] of [...this.#gauges.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const labelsStart = sample.indexOf("{");
      const family = labelsStart === -1 ? sample : sample.slice(0, labelsStart);
      if (!gaugeFamilies.has(family)) {
        lines.push(`# TYPE ${family} gauge`);
        gaugeFamilies.add(family);
      }
      lines.push(`${sample} ${String(value)}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
