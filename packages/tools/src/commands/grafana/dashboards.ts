import { searchDashboards } from "#lib/grafana/dashboards.ts";
import type { DashboardSearchResult } from "#lib/grafana/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type DashboardsOptions = {
  json?: boolean | undefined;
  query?: string | undefined;
  tag?: string | undefined;
  folder?: string | undefined;
  limit?: number | undefined;
};

function formatDashboardsMarkdown(dashboards: DashboardSearchResult[]): string {
  const lines: string[] = [];

  lines.push("## Grafana Dashboards");
  lines.push("");

  if (dashboards.length === 0) {
    lines.push("No dashboards found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(dashboards.length)} dashboard(s).`);
  lines.push("");

  for (const dashboard of dashboards) {
    lines.push(`- **${dashboard.title}** (\`${dashboard.uid}\`)`);

    if (dashboard.folderTitle != null) {
      lines.push(`  - Folder: ${dashboard.folderTitle}`);
    }

    if (dashboard.tags.length > 0) {
      lines.push(`  - Tags: ${dashboard.tags.join(", ")}`);
    }

    lines.push(`  - URL: ${dashboard.url}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("To view dashboard details:");
  lines.push("```bash");
  lines.push("tools grafana dashboard <UID>");
  lines.push("```");

  return lines.join("\n");
}

export async function dashboardsCommand(
  options: DashboardsOptions = {},
): Promise<void> {
  try {
    const dashboards = await searchDashboards({
      query: options.query,
      tag: options.tag,
      folderUid: options.folder,
      limit: options.limit,
    });

    if (options.json === true) {
      console.log(formatJson(dashboards));
    } else {
      console.log(formatDashboardsMarkdown(dashboards));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
