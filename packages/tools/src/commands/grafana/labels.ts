import { getLabelNames, getLabelValues } from "#lib/grafana/prometheus.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type LabelsOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
  metric?: string | undefined;
};

export type LabelValuesOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
  metric?: string | undefined;
};

function formatLabelsMarkdown(labels: string[]): string {
  const lines: string[] = [];

  lines.push("## Prometheus Labels");
  lines.push("");

  if (labels.length === 0) {
    lines.push("No labels found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(labels.length)} label(s).`);
  lines.push("");

  for (const label of labels) {
    lines.push(`- \`${label}\``);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("To view label values:");
  lines.push("```bash");
  lines.push("tools grafana label-values <LABEL_NAME>");
  lines.push("```");

  return lines.join("\n");
}

function formatLabelValuesMarkdown(
  labelName: string,
  values: string[],
): string {
  const lines: string[] = [];

  lines.push(`## Label Values: ${labelName}`);
  lines.push("");

  if (values.length === 0) {
    lines.push("No values found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(values.length)} value(s).`);
  lines.push("");

  for (const value of values) {
    lines.push(`- \`${value}\``);
  }

  return lines.join("\n");
}

export async function labelsCommand(
  options: LabelsOptions = {},
): Promise<void> {
  try {
    const labels = await getLabelNames(options.datasource, options.metric);

    if (options.json === true) {
      console.log(formatJson(labels));
    } else {
      console.log(formatLabelsMarkdown(labels));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function labelValuesCommand(
  labelName: string,
  options: LabelValuesOptions = {},
): Promise<void> {
  try {
    const values = await getLabelValues(
      options.datasource,
      labelName,
      options.metric,
    );

    if (options.json === true) {
      console.log(formatJson(values));
    } else {
      console.log(formatLabelValuesMarkdown(labelName, values));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
