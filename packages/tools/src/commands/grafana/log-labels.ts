import { getLokiLabels, getLokiLabelValues } from "#lib/grafana/loki.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type LogLabelsOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
};

export type LogLabelValuesOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
};

function formatLogLabelsMarkdown(labels: string[]): string {
  const lines: string[] = [];

  lines.push("## Loki Labels");
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
  lines.push("tools grafana log-label-values <LABEL_NAME>");
  lines.push("```");

  return lines.join("\n");
}

function formatLogLabelValuesMarkdown(
  labelName: string,
  values: string[],
): string {
  const lines: string[] = [];

  lines.push(`## Loki Label Values: ${labelName}`);
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

export async function logLabelsCommand(
  options: LogLabelsOptions = {},
): Promise<void> {
  try {
    const labels = await getLokiLabels(options.datasource);

    if (options.json === true) {
      console.log(formatJson(labels));
    } else {
      console.log(formatLogLabelsMarkdown(labels));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function logLabelValuesCommand(
  labelName: string,
  options: LogLabelValuesOptions = {},
): Promise<void> {
  try {
    const values = await getLokiLabelValues(options.datasource, labelName);

    if (options.json === true) {
      console.log(formatJson(values));
    } else {
      console.log(formatLogLabelValuesMarkdown(labelName, values));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
