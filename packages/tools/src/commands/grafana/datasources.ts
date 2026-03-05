import { listDatasources, getDatasource } from "#lib/grafana/datasources.ts";
import type { Datasource } from "#lib/grafana/types.ts";
import { getDatasourceTypeEmoji } from "#lib/grafana/format.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type DatasourcesOptions = {
  json?: boolean | undefined;
};

export type DatasourceOptions = {
  json?: boolean | undefined;
};

function formatDatasourcesMarkdown(datasources: Datasource[]): string {
  const lines: string[] = [];

  lines.push("## Grafana Datasources");
  lines.push("");

  if (datasources.length === 0) {
    lines.push("No datasources found.");
    return lines.join("\n");
  }

  for (const ds of datasources) {
    const emoji = getDatasourceTypeEmoji(ds.type);
    const defaultLabel = ds.isDefault ? " **(default)**" : "";
    lines.push(`- ${emoji} **${ds.name}** (\`${ds.uid}\`)${defaultLabel}`);
    lines.push(`  - Type: ${ds.type}`);
    lines.push(`  - URL: ${ds.url}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("To view datasource details:");
  lines.push("```bash");
  lines.push("tools grafana datasource <UID>");
  lines.push("```");

  return lines.join("\n");
}

function formatDatasourceDetail(ds: Datasource): string {
  const lines: string[] = [];
  const emoji = getDatasourceTypeEmoji(ds.type);

  lines.push(`## ${emoji} Datasource: ${ds.name}`);
  lines.push("");

  lines.push("### Details");
  lines.push("");
  lines.push(`- **UID:** ${ds.uid}`);
  lines.push(`- **ID:** ${String(ds.id)}`);
  lines.push(`- **Type:** ${ds.type}`);
  lines.push(`- **URL:** ${ds.url}`);
  lines.push(`- **Default:** ${ds.isDefault ? "Yes" : "No"}`);

  if (ds.jsonData != null) {
    lines.push("");
    lines.push("### Configuration");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(ds.jsonData, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

export async function datasourcesCommand(
  options: DatasourcesOptions = {},
): Promise<void> {
  try {
    const datasources = await listDatasources();

    if (options.json === true) {
      console.log(formatJson(datasources));
    } else {
      console.log(formatDatasourcesMarkdown(datasources));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function datasourceCommand(
  uid: string,
  options: DatasourceOptions = {},
): Promise<void> {
  try {
    const ds = await getDatasource(uid);

    if (options.json === true) {
      console.log(formatJson(ds));
    } else {
      console.log(formatDatasourceDetail(ds));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
