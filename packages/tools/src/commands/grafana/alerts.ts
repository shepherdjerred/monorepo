import { listAlertRules, getAlertRule } from "#lib/grafana/alerts.ts";
import type { AlertRule } from "#lib/grafana/types.ts";
import { getAlertStateEmoji } from "#lib/grafana/format.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type AlertsOptions = {
  json?: boolean | undefined;
};

export type AlertOptions = {
  json?: boolean | undefined;
};

function formatAlertsMarkdown(alerts: AlertRule[]): string {
  const lines: string[] = [];

  lines.push("## Grafana Alert Rules");
  lines.push("");

  if (alerts.length === 0) {
    lines.push("No alert rules found.");
    return lines.join("\n");
  }

  lines.push(`Found ${String(alerts.length)} alert rule(s).`);
  lines.push("");

  // Group by rule group
  const groups = new Map<string, AlertRule[]>();
  for (const alert of alerts) {
    const existing = groups.get(alert.ruleGroup);
    if (existing == null) {
      groups.set(alert.ruleGroup, [alert]);
    } else {
      existing.push(alert);
    }
  }

  for (const [groupName, groupAlerts] of groups) {
    lines.push(`### ${groupName}`);
    lines.push("");

    for (const alert of groupAlerts) {
      const stateLabel =
        alert.labels?.["__state__"] ?? alert.labels?.["state"] ?? "";
      const emoji = getAlertStateEmoji(stateLabel);
      lines.push(`- ${emoji} **${alert.title}** (\`${alert.uid}\`)`);

      if (alert.for != null && alert.for.length > 0) {
        lines.push(`  - For: ${alert.for}`);
      }

      if (alert.annotations != null) {
        const summary = alert.annotations["summary"];
        if (summary != null && summary.length > 0) {
          lines.push(`  - Summary: ${summary}`);
        }
      }

      if (alert.labels != null && Object.keys(alert.labels).length > 0) {
        const labelStr = Object.entries(alert.labels)
          .filter(([k]) => !k.startsWith("__"))
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (labelStr.length > 0) {
          lines.push(`  - Labels: ${labelStr}`);
        }
      }
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("To view alert details:");
  lines.push("```bash");
  lines.push("tools grafana alert <UID>");
  lines.push("```");

  return lines.join("\n");
}

function formatAlertDetail(alert: AlertRule): string {
  const lines: string[] = [];

  lines.push(`## Alert Rule: ${alert.title}`);
  lines.push("");

  lines.push("### Details");
  lines.push("");
  lines.push(`- **UID:** ${alert.uid}`);
  lines.push(`- **Rule Group:** ${alert.ruleGroup}`);
  lines.push(`- **Folder UID:** ${alert.folderUID}`);
  lines.push(`- **Condition:** ${alert.condition}`);

  if (alert.for != null && alert.for.length > 0) {
    lines.push(`- **For:** ${alert.for}`);
  }

  if (alert.labels != null && Object.keys(alert.labels).length > 0) {
    lines.push("");
    lines.push("### Labels");
    lines.push("");
    for (const [key, value] of Object.entries(alert.labels)) {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  if (alert.annotations != null && Object.keys(alert.annotations).length > 0) {
    lines.push("");
    lines.push("### Annotations");
    lines.push("");
    for (const [key, value] of Object.entries(alert.annotations)) {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  if (alert.data.length > 0) {
    lines.push("");
    lines.push("### Query Data");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(alert.data, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

export async function alertsCommand(
  options: AlertsOptions = {},
): Promise<void> {
  try {
    const alerts = await listAlertRules();

    if (options.json === true) {
      console.log(formatJson(alerts));
    } else {
      console.log(formatAlertsMarkdown(alerts));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function alertCommand(
  uid: string,
  options: AlertOptions = {},
): Promise<void> {
  try {
    const alert = await getAlertRule(uid);

    if (options.json === true) {
      console.log(formatJson(alert));
    } else {
      console.log(formatAlertDetail(alert));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
