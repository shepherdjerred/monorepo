import { getMetricNames } from "#lib/grafana/prometheus.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type MetricsOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
  match?: string | undefined;
};

function formatMetricsMarkdown(metrics: string[]): string {
  const lines: string[] = [];

  lines.push("## Prometheus Metrics");
  lines.push("");

  if (metrics.length === 0) {
    lines.push("No metrics found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(metrics.length)} metric(s).`);
  lines.push("");

  for (const metric of metrics) {
    lines.push(`- \`${metric}\``);
  }

  return lines.join("\n");
}

export async function metricsCommand(
  options: MetricsOptions = {},
): Promise<void> {
  try {
    const metrics = await getMetricNames(options.datasource, options.match);

    if (options.json === true) {
      console.log(formatJson(metrics));
    } else {
      console.log(formatMetricsMarkdown(metrics));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
