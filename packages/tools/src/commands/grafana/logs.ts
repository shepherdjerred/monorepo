import { queryLoki } from "#lib/grafana/loki.ts";
import type { PromQueryResult, Field } from "#lib/grafana/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type LogsOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
};

function isTimeField(f: Field): boolean {
  return f.type === "time" || f.name === "Time" || f.name === "time";
}

function isBodyField(f: Field): boolean {
  return f.name === "Line" || f.name === "body" || f.name === "line";
}

function isLabelsField(f: Field): boolean {
  return f.name === "labels" || f.labels != null;
}

function formatLogsResult(result: PromQueryResult): string {
  const lines: string[] = [];

  lines.push("## Loki Log Results");
  lines.push("");

  const refIds = Object.keys(result.results);

  if (refIds.length === 0) {
    lines.push("No results.");
    return lines.join("\n");
  }

  let totalLines = 0;

  for (const refId of refIds) {
    const entry = result.results[refId];
    if (entry == null) {
      continue;
    }

    for (const frame of entry.frames) {
      const { schema, data } = frame;

      if (schema.fields.length === 0 || data.values.length === 0) {
        continue;
      }

      // Find timestamp and body fields
      const timeIdx = schema.fields.findIndex((f) => isTimeField(f));
      const bodyIdx = schema.fields.findIndex((f) => isBodyField(f));
      const labelsIdx = schema.fields.findIndex((f) => isLabelsField(f));

      const timeValues = timeIdx === -1 ? undefined : data.values[timeIdx];
      const bodyValues = bodyIdx === -1 ? undefined : data.values[bodyIdx];

      // Get labels from the field schema
      const labelsField = labelsIdx === -1 ? undefined : schema.fields[labelsIdx];
      const labelsStr =
        labelsField?.labels == null
          ? ""
          : `{${Object.entries(labelsField.labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(", ")}}`;

      if (bodyValues == null) {
        continue;
      }

      const rowCount = bodyValues.length;

      for (let i = 0; i < rowCount; i++) {
        const timestamp =
          timeValues == null
            ? ""
            : new Date(Number(timeValues[i])).toISOString();
        const rawBody = bodyValues[i];
        let body: string;
        if (rawBody == null) {
          body = "";
        } else if (typeof rawBody === "string") {
          body = rawBody;
        } else if (typeof rawBody === "number" || typeof rawBody === "boolean") {
          body = String(rawBody);
        } else {
          body = JSON.stringify(rawBody);
        }
        lines.push(`[${timestamp}] ${labelsStr} ${body}`);
        totalLines++;
      }
    }
  }

  if (totalLines === 0) {
    lines.push("No log lines found.");
  }

  return lines.join("\n");
}

export async function logsCommand(
  expr: string,
  options: LogsOptions = {},
): Promise<void> {
  try {
    const result = await queryLoki(expr, {
      datasourceUid: options.datasource,
      from: options.from,
      to: options.to,
      limit: options.limit,
    });

    if (options.json === true) {
      console.log(formatJson(result));
    } else {
      console.log(formatLogsResult(result));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
