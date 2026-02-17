import type { HealthReport, HealthStatus } from "../github/types.ts";

function getStatusEmoji(status: HealthStatus): string {
  switch (status) {
    case "HEALTHY":
      return "\u2705";
    case "UNHEALTHY":
      return "\u274C";
    case "PENDING":
      return "\u23F3";
  }
}

function getStatusText(status: HealthStatus): string {
  switch (status) {
    case "HEALTHY":
      return "HEALTHY";
    case "UNHEALTHY":
      return "UNHEALTHY";
    case "PENDING":
      return "PENDING";
  }
}

export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`## PR Health Report: #${String(report.prNumber)}`);
  lines.push("");
  lines.push(`**URL:** ${report.prUrl}`);
  lines.push("");

  // Overall status
  const unhealthyCount = report.checks.filter(
    (c) => c.status === "UNHEALTHY",
  ).length;
  const pendingCount = report.checks.filter(
    (c) => c.status === "PENDING",
  ).length;

  let statusSummary = `### Status: ${getStatusEmoji(report.overallStatus)} ${getStatusText(report.overallStatus)}`;
  if (unhealthyCount > 0) {
    statusSummary += ` (${String(unhealthyCount)} issue${unhealthyCount > 1 ? "s" : ""})`;
  } else if (pendingCount > 0) {
    statusSummary += ` (${String(pendingCount)} pending)`;
  }
  lines.push(statusSummary);
  lines.push("");

  // Individual checks
  for (const check of report.checks) {
    lines.push(
      `### ${check.name}: ${getStatusEmoji(check.status)} ${getStatusText(check.status)}`,
    );

    if (check.details.length > 0) {
      for (const detail of check.details) {
        lines.push(`- ${detail}`);
      }
    }

    if (check.commands && check.commands.length > 0) {
      lines.push("");
      lines.push("To investigate:");
      lines.push("```bash");
      for (const cmd of check.commands) {
        lines.push(cmd);
      }
      lines.push("```");
    }

    lines.push("");
  }

  // Next steps
  if (report.nextSteps.length > 0) {
    lines.push("### Next Steps");
    for (const [i, step] of report.nextSteps.entries()) {
      lines.push(`${String(i + 1)}. ${step}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
