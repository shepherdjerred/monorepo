import { listAnnotations, createAnnotation } from "#lib/grafana/annotations.ts";
import { parseTimeRange } from "#lib/grafana/time.ts";
import type { Annotation } from "#lib/grafana/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type AnnotationsOptions = {
  json?: boolean | undefined;
  dashboard?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
};

export type AnnotateOptions = {
  json?: boolean | undefined;
  dashboardUID?: string | undefined;
  panelId?: number | undefined;
  tags?: string[] | undefined;
};

function formatAnnotationsMarkdown(annotations: Annotation[]): string {
  const lines: string[] = [];

  lines.push("## Grafana Annotations");
  lines.push("");

  if (annotations.length === 0) {
    lines.push("No annotations found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(annotations.length)} annotation(s).`);
  lines.push("");

  for (const annotation of annotations) {
    const time = new Date(annotation.time).toISOString();
    lines.push(`- **[${time}]** ${annotation.text}`);

    if (annotation.tags.length > 0) {
      lines.push(`  - Tags: ${annotation.tags.join(", ")}`);
    }

    if (annotation.dashboardId > 0) {
      lines.push(`  - Dashboard ID: ${String(annotation.dashboardId)}`);
    }

    if (annotation.panelId > 0) {
      lines.push(`  - Panel ID: ${String(annotation.panelId)}`);
    }

    if (annotation.timeEnd > annotation.time) {
      const timeEnd = new Date(annotation.timeEnd).toISOString();
      lines.push(`  - End: ${timeEnd}`);
    }
  }

  return lines.join("\n");
}

export async function annotationsCommand(
  options: AnnotationsOptions = {},
): Promise<void> {
  try {
    const timeRange =
      options.from != null || options.to != null
        ? parseTimeRange(options.from, options.to)
        : undefined;

    const annotations = await listAnnotations({
      dashboardId: options.dashboard,
      from: timeRange?.from,
      to: timeRange?.to,
      tags: options.tags,
      limit: options.limit,
    });

    if (options.json === true) {
      console.log(formatJson(annotations));
    } else {
      console.log(formatAnnotationsMarkdown(annotations));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function annotateCommand(
  text: string,
  options: AnnotateOptions = {},
): Promise<void> {
  try {
    const result = await createAnnotation({
      text,
      dashboardUID: options.dashboardUID,
      panelId: options.panelId,
      tags: options.tags,
    });

    if (options.json === true) {
      console.log(formatJson(result));
    } else {
      console.log(`## Annotation Created`);
      console.log("");
      console.log(`- **ID:** ${String(result.id)}`);
      console.log(`- **Message:** ${result.message}`);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
