import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  renderReportHtml,
  renderReportText,
} from "#shared/reports/report-renderer.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";

const OUTPUT_DIRECTORY = "/tmp/temporal-report-email-previews";
const FIXED_STARTED_AT = "2026-08-30T15:00:00.000Z";
const FIXED_COMPLETED_AT = "2026-08-30T15:01:00.000Z";

type PreviewDefinition = {
  reportType: string;
  title: string;
  execution: ReportEnvelopeV1["execution"];
  verdict: ReportEnvelopeV1["verdict"];
  headline: string;
};

const PREVIEWS = [
  {
    reportType: "agent-task",
    title: "Agent Task: Inspect production evidence",
    execution: "complete",
    verdict: "clear",
    headline: "Every declared production check passed.",
  },
  {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    execution: "complete",
    verdict: "pending",
    headline: "The comparison window is still collecting enough builds.",
  },
  {
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    execution: "complete",
    verdict: "clear",
    headline: "No dependency changes were found in the verified window.",
  },
  {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    execution: "complete",
    verdict: "attention",
    headline: "One warning finding needs review.",
  },
  {
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "attention",
    headline: "Two dead links and one timed-out link were found.",
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "clear",
    headline: "No HIGH or CRITICAL vulnerabilities were found.",
  },
  {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    execution: "complete",
    verdict: "attention",
    headline: "The current Temporal release accepts protobufjs v8.",
  },
  {
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly refresh",
    execution: "complete",
    verdict: "changed",
    headline: "Data Dragon 26.17 replaced 26.16 and opened an update PR.",
  },
  {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    execution: "partial",
    verdict: "attention",
    headline: "The update PR exists, but automatic merge could not be enabled.",
  },
  {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    execution: "complete",
    verdict: "attention",
    headline: "One queue closure needs confirmation against the patch notes.",
  },
  {
    reportType: "scout-season-refresh",
    title: "Scout season schedule",
    execution: "failed",
    verdict: "inconclusive",
    headline: "The season-date check failed before it could reach a verdict.",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "clear",
    headline: "TaskNotes has 842 tasks, no skipped files, and healthy pods.",
  },
] satisfies PreviewDefinition[];

function previewReport(
  definition: PreviewDefinition,
  index: number,
): ReportEnvelopeV1 {
  const incomplete = definition.execution !== "complete";
  const needsReview = definition.verdict === "attention";
  const evidenceId = `${definition.reportType}-evidence`;
  return ReportEnvelopeV1Schema.parse({
    schemaVersion: 1,
    reportRunId: `${definition.reportType}:preview-${String(index + 1)}`,
    reportType: definition.reportType,
    title: definition.title,
    scheduleId: `${definition.reportType}-preview`,
    startedAt: FIXED_STARTED_AT,
    completedAt: FIXED_COMPLETED_AT,
    execution: definition.execution,
    verdict: definition.verdict,
    headline: definition.headline,
    checks: [
      {
        id: `${definition.reportType}-check`,
        label: "Primary report check",
        required: true,
        status: incomplete || needsReview ? "failed" : "passed",
        summary: incomplete
          ? "The check did not complete."
          : needsReview
            ? "The check completed and found something to review."
            : "The check completed successfully.",
        evidenceReceiptIds: [evidenceId],
      },
    ],
    evidence: [
      {
        id: evidenceId,
        source: "deterministic email preview fixture",
        observedAt: FIXED_COMPLETED_AT,
        status: incomplete ? "failure" : "success",
        url: `https://example.com/reports/${definition.reportType}`,
        command: "internal preview command hidden from the email",
      },
    ],
    findings:
      needsReview || definition.verdict === "changed"
        ? [
            {
              section: needsReview ? "Needs review" : "Changes",
              severity: needsReview ? "warning" : "info",
              summary: definition.headline,
              detail: needsReview
                ? "Review the source evidence before making a change."
                : "The automation completed the expected update.",
              evidenceReceiptIds: [evidenceId],
            },
          ]
        : [],
    limitations: incomplete
      ? ["No complete conclusion is available from this run."]
      : [],
    actions:
      needsReview || incomplete
        ? ["Open the workflow run and review the reported problem."]
        : [],
    ...(definition.reportType === "homelab-audit"
      ? {
          synthesis:
            "Storage is healthy. The warning is isolated to one workload and is not spreading.",
        }
      : {}),
    provenance: {
      workflowId: `${definition.reportType}-preview-workflow`,
      runId: `preview-run-${String(index + 1)}`,
      temporalUrl: `https://temporal.example.test/namespaces/prod/workflows/${definition.reportType}`,
      repoSha: "0123456789abcdef0123456789abcdef01234567",
      source: "deterministic preview fixture",
      windowStart: "2026-08-29T15:00:00.000Z",
      windowEnd: FIXED_STARTED_AT,
    },
  });
}

function galleryHtml(
  entries: readonly { name: string; subject: string }[],
): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporal email previews</title></head>',
    "<body style=\"margin:0;padding:24px;background:#111827;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">",
    '<main style="max-width:1120px;margin:0 auto;"><h1>Temporal email previews</h1><p>Deterministic fixtures for every human-facing report type.</p>',
    ...entries.map(
      (entry) =>
        `<section style="margin:32px 0;"><h2 style="font-size:18px;">${entry.subject}</h2><iframe title="${entry.subject}" src="./${entry.name}.html" style="display:block;width:100%;height:850px;border:1px solid #374151;border-radius:12px;background:white;"></iframe><p><a style="color:#93c5fd;" href="./${entry.name}.txt">Plain-text version</a></p></section>`,
    ),
    "</main></body></html>",
  ].join("");
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const galleryEntries: { name: string; subject: string }[] = [];
for (const [index, definition] of PREVIEWS.entries()) {
  const report = previewReport(definition, index);
  await Bun.write(
    path.join(OUTPUT_DIRECTORY, `${definition.reportType}.html`),
    renderReportHtml(report),
  );
  await Bun.write(
    path.join(OUTPUT_DIRECTORY, `${definition.reportType}.txt`),
    renderReportText(report),
  );
  galleryEntries.push({
    name: definition.reportType,
    subject: renderReportText(report).split("\n", 1)[0] ?? definition.title,
  });
}
await Bun.write(
  path.join(OUTPUT_DIRECTORY, "index.html"),
  galleryHtml(galleryEntries),
);

console.warn(
  JSON.stringify({
    level: "info",
    message: "Rendered deterministic Temporal report email previews",
    reports: galleryEntries.length,
    indexPath: path.join(OUTPUT_DIRECTORY, "index.html"),
  }),
);
