import { getDashboard } from "#lib/grafana/dashboards.ts";
import type { DashboardDetail, Panel } from "#lib/grafana/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type DashboardOptions = {
  json?: boolean | undefined;
};

function formatPanel(panel: Panel): string[] {
  const lines: string[] = [];

  const title = panel.title ?? "(untitled)";
  const idStr = panel.id == null ? "" : `, id: ${String(panel.id)}`;
  lines.push(`- **${title}** (type: \`${panel.type}\`${idStr})`);

  if (panel.description != null && panel.description.length > 0) {
    lines.push(`  - Description: ${panel.description}`);
  }

  if (panel.targets != null && panel.targets.length > 0) {
    for (const target of panel.targets) {
      if (target.expr != null && target.expr.length > 0) {
        lines.push(`  - Query [${target.refId}]: \`${target.expr}\``);
      }
    }
  }

  return lines;
}

function formatDashboardDetail(detail: DashboardDetail): string {
  const lines: string[] = [];
  const { dashboard, meta } = detail;

  lines.push(`## Dashboard: ${dashboard.title}`);
  lines.push("");

  lines.push("### Details");
  lines.push("");
  lines.push(`- **UID:** ${dashboard.uid}`);
  lines.push(`- **URL:** ${meta.url}`);

  if (meta.folderTitle != null) {
    lines.push(`- **Folder:** ${meta.folderTitle}`);
  }

  if (dashboard.tags.length > 0) {
    lines.push(`- **Tags:** ${dashboard.tags.join(", ")}`);
  }

  if (dashboard.description != null && dashboard.description.length > 0) {
    lines.push(`- **Description:** ${dashboard.description}`);
  }

  lines.push("");

  if (dashboard.panels.length > 0) {
    lines.push(`### Panels (${String(dashboard.panels.length)})`);
    lines.push("");

    for (const panel of dashboard.panels) {
      lines.push(...formatPanel(panel));
    }
  } else {
    lines.push("No panels found.");
  }

  return lines.join("\n");
}

export async function dashboardCommand(
  uid: string,
  options: DashboardOptions = {},
): Promise<void> {
  try {
    const detail = await getDashboard(uid);

    if (options.json === true) {
      console.log(formatJson(detail));
    } else {
      console.log(formatDashboardDetail(detail));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
