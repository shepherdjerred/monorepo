import sanitizeHtml from "sanitize-html";
import {
  presentReport,
  type ReportPresentationTone,
} from "./report-presentation.ts";
import { ReportEnvelopeV1Schema, type ReportEnvelopeV1 } from "./report.ts";

const ESCAPE_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "escape",
};

const REPORT_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

type TechnicalDetail = {
  label: string;
  value: string;
  url?: string;
};

function escapeHtml(value: string): string {
  return sanitizeHtml(value, ESCAPE_TEXT_OPTIONS);
}

function normalizedHttpUrl(url: string): string {
  return new URL(url).href;
}

function reportLink(url: string, label: string): string {
  return `<a href="${escapeHtml(normalizedHttpUrl(url))}" style="color:#1d4ed8;text-decoration:underline;">${escapeHtml(label)}</a>`;
}

function evidenceUrls(
  report: ReportEnvelopeV1,
  receiptIds: readonly string[],
): string[] {
  const evidence = new Map(
    report.evidence.map((receipt) => [receipt.id, receipt]),
  );
  return [
    ...new Set(
      receiptIds.flatMap((id) => {
        const url = evidence.get(id)?.url;
        return url === undefined ? [] : [url];
      }),
    ),
  ];
}

function sourceLinksHtml(urls: readonly string[]): string {
  if (urls.length === 0) return "";
  return `<div style="margin-top:6px;font-size:13px;">${urls
    .map((url, index) =>
      reportLink(
        url,
        urls.length === 1 ? "View source" : `View source ${String(index + 1)}`,
      ),
    )
    .join(" · ")}</div>`;
}

function sourceLinksText(urls: readonly string[]): string[] {
  return urls.map((url, index) =>
    urls.length === 1
      ? `  View source: ${url}`
      : `  View source ${String(index + 1)}: ${url}`,
  );
}

function toneColors(tone: ReportPresentationTone): {
  background: string;
  border: string;
  text: string;
} {
  switch (tone) {
    case "ok":
      return { background: "#ecfdf3", border: "#16a34a", text: "#166534" };
    case "review":
      return { background: "#fff7ed", border: "#ea580c", text: "#9a3412" };
    case "incomplete":
      return { background: "#fef2f2", border: "#dc2626", text: "#991b1b" };
  }
}

function severityLabel(
  severity: ReportEnvelopeV1["findings"][number]["severity"],
): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "info":
      return "Note";
  }
}

function checkColor(status: "Passed" | "Problem" | "Not checked"): string {
  switch (status) {
    case "Passed":
      return "#166534";
    case "Problem":
      return "#991b1b";
    case "Not checked":
      return "#6b7280";
  }
}

function formatReportTime(value: string): string {
  const parts = REPORT_TIME_FORMAT.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const match = parts.find((candidate) => candidate.type === type);
    if (match === undefined) {
      throw new Error(`missing date-time part: ${type}`);
    }
    return match.value;
  };
  return `${part("month")} ${part("day")}, ${part("year")} at ${part("hour")}:${part("minute")} ${part("dayPeriod")} ${part("timeZoneName")}`;
}

function technicalDetails(report: ReportEnvelopeV1): TechnicalDetail[] {
  return [
    { label: "Completed", value: formatReportTime(report.completedAt) },
    ...(report.provenance.source === undefined
      ? []
      : [{ label: "Source", value: report.provenance.source }]),
    ...(report.provenance.windowStart === undefined ||
    report.provenance.windowEnd === undefined
      ? []
      : [
          {
            label: "Window",
            value: `${formatReportTime(report.provenance.windowStart)} to ${formatReportTime(report.provenance.windowEnd)}`,
          },
        ]),
    ...(report.provenance.repoSha === undefined
      ? []
      : [
          {
            label: "Repository",
            value: report.provenance.repoSha.slice(0, 12),
          },
        ]),
    ...(report.provenance.temporalUrl === undefined
      ? []
      : [
          {
            label: "Temporal",
            value: "View workflow run",
            url: report.provenance.temporalUrl,
          },
        ]),
  ];
}

function actionHtml(actions: readonly string[]): string {
  if (actions.length === 0) {
    return `<div style="margin:24px 0;padding:16px 18px;border-radius:10px;background:#f3f4f6;"><strong style="color:#111827;">No action is needed.</strong></div>`;
  }
  return `<div style="margin:24px 0;padding:18px;border:1px solid #fdba74;border-radius:10px;background:#fff7ed;"><h2 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:#9a3412;">What you need to do</h2><ul style="margin:0;padding-left:22px;color:#431407;">${actions.map((action) => `<li style="margin:6px 0;">${escapeHtml(action)}</li>`).join("")}</ul></div>`;
}

function findingsHtml(report: ReportEnvelopeV1): string {
  const presentation = presentReport(report);
  if (presentation.findings.length === 0) return "";
  return `<section style="margin-top:28px;"><h2 style="margin:0 0 12px;font-size:19px;color:#111827;">What was found</h2><ul style="margin:0;padding:0;list-style:none;">${presentation.findings
    .map((finding) => {
      const section =
        finding.section === undefined
          ? ""
          : `<div style="margin-bottom:4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${escapeHtml(finding.section)}</div>`;
      const detail =
        finding.detail === undefined
          ? ""
          : `<div style="margin-top:5px;color:#4b5563;">${escapeHtml(finding.detail)}</div>`;
      return `<li style="margin:0 0 12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:9px;background:#ffffff;">${section}<div><strong>${escapeHtml(severityLabel(finding.severity))}:</strong> ${escapeHtml(finding.summary)}</div>${detail}${sourceLinksHtml(evidenceUrls(report, finding.evidenceReceiptIds))}</li>`;
    })
    .join("")}</ul></section>`;
}

function synthesisHtml(synthesis: string | undefined): string {
  return synthesis === undefined
    ? ""
    : `<section style="margin-top:28px;"><h2 style="margin:0 0 8px;font-size:19px;color:#111827;">Additional context</h2><p style="margin:0;color:#374151;">${escapeHtml(synthesis)}</p></section>`;
}

function checksHtml(report: ReportEnvelopeV1): string {
  const checks = presentReport(report)
    .checks.map(
      (check) =>
        `<li style="margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid #e5e7eb;"><div><strong style="color:${checkColor(check.status)};">${escapeHtml(check.status)}</strong> &middot; <strong>${escapeHtml(check.label)}</strong></div><div style="margin-top:4px;color:#4b5563;">${escapeHtml(check.summary)}</div>${sourceLinksHtml(evidenceUrls(report, check.evidenceReceiptIds))}</li>`,
    )
    .join("");
  return `<section style="margin-top:30px;"><h2 style="margin:0 0 12px;font-size:19px;color:#111827;">What was checked</h2><ul style="margin:0;padding:0;list-style:none;">${checks}</ul></section>`;
}

function limitationsHtml(limitations: readonly string[]): string {
  if (limitations.length === 0) return "";
  return `<section style="margin-top:24px;"><h2 style="margin:0 0 8px;font-size:17px;color:#374151;">What may be missing</h2><ul style="margin:0;padding-left:22px;color:#4b5563;">${limitations.map((limitation) => `<li style="margin:5px 0;">${escapeHtml(limitation)}</li>`).join("")}</ul></section>`;
}

function detailsHtml(report: ReportEnvelopeV1): string {
  const rows = technicalDetails(report)
    .map((detail) => {
      const value =
        detail.url === undefined
          ? escapeHtml(detail.value)
          : reportLink(detail.url, detail.value);
      return `<tr><th scope="row" style="padding:3px 14px 3px 0;text-align:left;vertical-align:top;font-size:12px;color:#6b7280;">${escapeHtml(detail.label)}</th><td style="padding:3px 0;font-size:12px;color:#6b7280;">${value}</td></tr>`;
    })
    .join("");
  return `<footer style="margin-top:30px;padding-top:18px;border-top:1px solid #e5e7eb;"><table role="presentation" style="border-collapse:collapse;">${rows}</table></footer>`;
}

export function renderReportHtml(rawReport: ReportEnvelopeV1): string {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const presentation = presentReport(report);
  const colors = toneColors(presentation.tone);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f4f6;color:#111827;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;line-height:1.5;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:28px;">',
    `<div style="display:inline-block;margin-bottom:14px;padding:5px 10px;border:1px solid ${colors.border};border-radius:999px;background:${colors.background};color:${colors.text};font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;">${escapeHtml(presentation.statusLabel)}</div>`,
    `<h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;color:#111827;">${escapeHtml(presentation.heading)}</h1>`,
    `<p style="margin:0;font-size:17px;line-height:1.55;color:#374151;">${escapeHtml(presentation.summary)}</p>`,
    actionHtml(presentation.actions),
    findingsHtml(report),
    synthesisHtml(presentation.synthesis),
    limitationsHtml(presentation.limitations),
    checksHtml(report),
    detailsHtml(report),
    "</td></tr></table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("");
}

function findingsText(report: ReportEnvelopeV1): string[] {
  const findings = presentReport(report).findings;
  if (findings.length === 0) return [];
  return [
    "",
    "What was found",
    ...findings.flatMap((finding) => [
      `- ${severityLabel(finding.severity)}${finding.section === undefined ? "" : ` · ${finding.section}`}: ${finding.summary}${finding.detail === undefined ? "" : ` — ${finding.detail}`}`,
      ...sourceLinksText(evidenceUrls(report, finding.evidenceReceiptIds)),
    ]),
  ];
}

function checksText(report: ReportEnvelopeV1): string[] {
  return [
    "",
    "What was checked",
    ...presentReport(report).checks.flatMap((check) => [
      `- ${check.status} · ${check.label}: ${check.summary}`,
      ...sourceLinksText(evidenceUrls(report, check.evidenceReceiptIds)),
    ]),
  ];
}

export function renderReportText(rawReport: ReportEnvelopeV1): string {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const presentation = presentReport(report);
  const lines = [
    presentation.subject,
    presentation.statusLabel,
    presentation.summary,
    "",
    presentation.actions.length === 0
      ? "No action is needed."
      : "What you need to do",
    ...(presentation.actions.length === 0
      ? []
      : presentation.actions.map((action) => `- ${action}`)),
    ...findingsText(report),
    ...(presentation.synthesis === undefined
      ? []
      : ["", "Additional context", presentation.synthesis]),
    ...(presentation.limitations.length === 0
      ? []
      : [
          "",
          "What may be missing",
          ...presentation.limitations.map((limitation) => `- ${limitation}`),
        ]),
    ...checksText(report),
    "",
    "Details",
    ...technicalDetails(report).map(
      (detail) => `- ${detail.label}: ${detail.url ?? detail.value}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
