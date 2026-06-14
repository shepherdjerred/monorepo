/**
 * Markdown formatter for `toolkit deployed`, optimized for Claude Code reading.
 */
import type { DeployedReport, VariantReport, Verdict } from "./types.ts";

const VERDICT_LABEL: Record<Verdict, string> = {
  RUNNING: "✅ RUNNING",
  SYNCED: "🟢 SYNCED",
  PINNED: "🟡 PINNED",
  PENDING: "🟠 PENDING",
  NO_IMAGE: "⚪ NO IMAGE YET",
  NOT_MERGED: "⛔ NOT MERGED",
  UNKNOWN: "❔ UNKNOWN",
};

function shortDigest(digest: string | null | undefined): string {
  if (digest == null) {
    return "?";
  }
  const hex = digest.replace(/^sha256:/, "");
  return `${hex.slice(0, 10)}…`;
}

function formatVariant(v: VariantReport): string[] {
  const lines: string[] = [];
  const heading =
    v.variant === "default" ? v.service : `${v.service} / ${v.variant}`;
  const build = v.git.pin == null ? "" : ` — ${v.git.pin.tag}`;
  lines.push(`## ${heading}    ${VERDICT_LABEL[v.verdict]}${build}`);
  for (const d of v.detail) {
    lines.push(`  • ${d}`);
  }
  lines.push("");
  return lines;
}

export function formatReport(report: DeployedReport): string {
  const lines: string[] = [];
  const c = report.commit;
  lines.push(`# toolkit deployed — ${c.shortSha} (${c.subject})`);
  lines.push("");
  lines.push(report.merged ? "Merged to main: yes" : "Merged to main: **no**");

  if (report.variants.length === 0) {
    lines.push("");
    lines.push(
      "No k8s service is affected by this commit (static sites / npm / docs are out of scope).",
    );
  }
  lines.push("");

  for (const v of report.variants) {
    lines.push(...formatVariant(v));
  }

  if (report.notes.length > 0) {
    lines.push("---");
    for (const n of report.notes) {
      lines.push(`> ${n}`);
    }
  }

  return lines.join("\n").trimEnd();
}

export { shortDigest };
