import { queryPrometheus } from "#lib/grafana/prometheus.ts";
import type { PromQueryResult, Frame } from "#lib/grafana/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type QueryOptions = {
  json?: boolean | undefined;
  datasource?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  instant?: boolean | undefined;
};

function formatFrame(frame: Frame, lines: string[]): void {
  const { schema, data } = frame;

  if (schema.name != null && schema.name.length > 0) {
    lines.push(`**${schema.name}**`);
    lines.push("");
  }

  if (schema.fields.length === 0 || data.values.length === 0) {
    lines.push("Empty frame.");
    lines.push("");
    return;
  }

  // Build a markdown table
  const headers = schema.fields.map((f) => {
    if (f.labels != null && Object.keys(f.labels).length > 0) {
      const labelStr = Object.entries(f.labels)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${f.name} {${labelStr}}`;
    }
    return f.name;
  });

  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  // Determine row count from the first values array
  const firstValues = data.values[0];
  const rowCount = firstValues == null ? 0 : firstValues.length;
  const maxRows = Math.min(rowCount, 50);

  for (let i = 0; i < maxRows; i++) {
    const cells = data.values.map((col) => {
      const val = col[i];
      if (val == null) return "";
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean")
        return String(val);
      return JSON.stringify(val);
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (rowCount > maxRows) {
    lines.push("");
    lines.push(`_...${String(rowCount - maxRows)} more rows_`);
  }

  lines.push("");
}

function formatQueryResult(result: PromQueryResult): string {
  const lines: string[] = [];

  lines.push("## Prometheus Query Results");
  lines.push("");

  const refIds = Object.keys(result.results);

  if (refIds.length === 0) {
    lines.push("No results.");
    return lines.join("\n");
  }

  for (const refId of refIds) {
    const entry = result.results[refId];
    if (entry == null) {
      continue;
    }

    lines.push(`### Result: ${refId}`);
    lines.push("");

    if (entry.frames.length === 0) {
      lines.push("No data frames.");
      lines.push("");
      continue;
    }

    for (const frame of entry.frames) {
      formatFrame(frame, lines);
    }
  }

  return lines.join("\n");
}

export async function queryCommand(
  expr: string,
  options: QueryOptions = {},
): Promise<void> {
  try {
    const result = await queryPrometheus(expr, {
      datasourceUid: options.datasource,
      from: options.from,
      to: options.to,
      instant: options.instant,
    });

    if (options.json === true) {
      console.log(formatJson(result));
    } else {
      console.log(formatQueryResult(result));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
