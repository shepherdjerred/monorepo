import { mkdir } from "node:fs/promises";
import path from "node:path";
import { reportMailboxForType } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { escapeHtml } from "@shepherdjerred/ops-model/email/primitives.ts";
import { reportSubject } from "#shared/reports/report-presentation.ts";
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
  slug?: string;
  reportType: string;
  title: string;
  execution: ReportEnvelopeV1["execution"];
  verdict: ReportEnvelopeV1["verdict"];
  headline: string;
  remediation?: ReportEnvelopeV1["remediation"];
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
    slug: "link-rot-scan-remediated",
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan of main",
    execution: "complete",
    verdict: "changed",
    headline: "Replaced two permanently redirected documentation links.",
    remediation: {
      outcome: "pr-created",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
      branchName: "automation/link-rot-2026-08-30",
      autoMergeEnabled: true,
      changedFiles: ["README.md", "packages/temporal/README.md"],
      resolvedCount: 2,
      unresolvedCount: 0,
      summary:
        "Updated two moved documentation URLs and configured automatic merge once CI passes.",
    },
  },
  {
    reportType: "main-vuln-scan",
    title: "Weekly Trivy vulnerability scan of main",
    execution: "complete",
    verdict: "clear",
    headline: "No HIGH or CRITICAL vulnerabilities were found.",
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
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    execution: "complete",
    verdict: "clear",
    headline:
      "6 destinations tracked; 0 blocked. Solver spending or reservations this month: $0.14.",
  },
  {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    execution: "complete",
    verdict: "clear",
    headline: "TaskNotes has 842 tasks, no skipped files, and healthy pods.",
  },
] satisfies PreviewDefinition[];

function previewFindings(
  definition: PreviewDefinition,
  evidenceId: string,
): ReportEnvelopeV1["findings"] {
  const needsReview = definition.verdict === "attention";
  if (!needsReview && definition.verdict !== "changed") {
    return [];
  }
  return [
    {
      section: needsReview ? "Needs review" : "Changes",
      severity: needsReview ? "warning" : "info",
      summary: definition.headline,
      detail: needsReview
        ? "Review the source evidence before making a change."
        : "The automation completed the expected update.",
      evidenceReceiptIds: [evidenceId],
    },
  ];
}

function previewCheckSummary(
  incomplete: boolean,
  needsReview: boolean,
): string {
  if (incomplete) return "The check did not complete.";
  return needsReview
    ? "The check completed and found something to review."
    : "The check completed successfully.";
}

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
        summary: previewCheckSummary(incomplete, needsReview),
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
    findings: previewFindings(definition, evidenceId),
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
    ...(definition.remediation === undefined
      ? {}
      : { remediation: definition.remediation }),
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
  entries: readonly {
    name: string;
    subject: string;
    from: string;
    to: string;
  }[],
): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporal email previews</title></head>',
    "<body style=\"margin:0;padding:24px;background:#0f1311;color:#edf2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">",
    '<main style="max-width:1120px;margin:0 auto;"><h1>Temporal email previews</h1><p>Deterministic Hub Editorial fixtures and semantic @sjer.red routing for every human-facing report type.</p>',
    ...entries.map(
      (entry) =>
        `<section style="margin:32px 0;"><h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(entry.subject)}</h2><p style="margin:0 0 10px;font-size:13px;color:#9eaaa3;"><strong>From:</strong> <code>${escapeHtml(entry.from)}</code> &middot; <strong>To:</strong> <code>${escapeHtml(entry.to)}</code></p><iframe title="${escapeHtml(entry.subject)}" src="./${escapeHtml(entry.name)}.html" style="display:block;width:100%;height:780px;border:1px solid #2d3531;border-radius:12px;background:white;"></iframe><p><a style="color:#4cc393;" href="./${escapeHtml(entry.name)}.txt">Plain-text version</a></p></section>`,
    ),
    "</main></body></html>",
  ].join("");
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const galleryEntries: {
  name: string;
  subject: string;
  from: string;
  to: string;
}[] = [];
for (const [index, definition] of PREVIEWS.entries()) {
  const slug = definition.slug ?? definition.reportType;
  const report = previewReport(definition, index);
  const mailbox = reportMailboxForType(definition.reportType);
  await Bun.write(
    path.join(OUTPUT_DIRECTORY, `${slug}.html`),
    renderReportHtml(report),
  );
  await Bun.write(
    path.join(OUTPUT_DIRECTORY, `${slug}.txt`),
    renderReportText(report),
  );
  galleryEntries.push({
    name: slug,
    subject: reportSubject(report),
    from: mailbox.from,
    to: mailbox.to,
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
