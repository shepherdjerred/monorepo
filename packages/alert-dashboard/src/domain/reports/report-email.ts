import {
  formatPacificTimestamp,
  safeHttpUrl,
  type EmailActionLink,
  type EmailCheckItem,
  type EmailDetailRow,
  type EmailDocument,
  type EmailItemCard,
  type EmailSection,
  type EmailTone,
} from "@shepherdjerred/ops-model/email/primitives.ts";
import { renderEmailHtml } from "@shepherdjerred/ops-model/email/render-html.ts";
import { renderEmailText } from "@shepherdjerred/ops-model/email/render-text.ts";
import type {
  ReportCheckV1,
  ReportEnvelopeV1,
  ReportFindingV1,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { hubReportRunUrl } from "@shepherdjerred/ops-model/tool-links.ts";

export function isActionableFinding(finding: ReportFindingV1): boolean {
  return (
    finding.severity !== "info" &&
    (finding.state === undefined || finding.state === "active")
  );
}

export function countActionableFindings(
  findings: readonly ReportFindingV1[],
): number {
  return findings.filter((finding) => isActionableFinding(finding)).length;
}

export function countFailedChecks(checks: readonly ReportCheckV1[]): number {
  return checks.filter((check) => check.status === "failed").length;
}

function envelopeTone(report: ReportEnvelopeV1): EmailTone {
  if (report.execution !== "complete") return "critical";
  switch (report.verdict) {
    case "clear":
      return "ok";
    case "changed":
      return "info";
    case "attention":
      return report.findings.some(
        (finding) =>
          finding.severity === "critical" && isActionableFinding(finding),
      )
        ? "critical"
        : "warning";
    case "pending":
    case "inconclusive":
      return "warning";
  }
}

function envelopeBadge(report: ReportEnvelopeV1): string {
  if (report.execution === "failed") return "Failed";
  if (report.execution === "partial") return "Incomplete";
  switch (report.verdict) {
    case "clear":
      return "All clear";
    case "changed":
      return report.remediation?.prUrl === undefined ? "Changed" : "PR opened";
    case "attention":
      return "Needs review";
    case "pending":
      return "Pending";
    case "inconclusive":
      return "Inconclusive";
  }
}

function findingCard(
  report: ReportEnvelopeV1,
  finding: ReportFindingV1,
): EmailItemCard {
  const evidenceById = new Map(
    report.evidence.map((receipt) => [receipt.id, receipt]),
  );
  const urls = [
    ...new Set(
      finding.evidenceReceiptIds.flatMap((id) => {
        const href = safeHttpUrl(evidenceById.get(id)?.url);
        return href === null ? [] : [href];
      }),
    ),
  ];
  const links: EmailActionLink[] = urls.map((url, index) => ({
    label:
      urls.length === 1 ? "View source" : `View source ${String(index + 1)}`,
    url,
  }));
  const tone: EmailTone =
    finding.severity === "critical"
      ? "critical"
      : finding.severity === "warning"
        ? "warning"
        : "info";
  const badge =
    finding.severity === "critical"
      ? "Critical"
      : finding.severity === "warning"
        ? "Warning"
        : "Note";
  return {
    tone,
    badge,
    ...(finding.section === undefined ? {} : { kicker: finding.section }),
    title: finding.summary,
    ...(finding.detail === undefined ? {} : { body: finding.detail }),
    ...(links.length === 0 ? {} : { links }),
  };
}

function buildChecksSection(report: ReportEnvelopeV1): EmailSection {
  const evidenceById = new Map(
    report.evidence.map((receipt) => [receipt.id, receipt]),
  );
  const attentionChecks: EmailCheckItem[] = [];
  const passedLabels: string[] = [];
  for (const check of report.checks) {
    if (check.status === "passed") {
      passedLabels.push(check.label);
      continue;
    }
    const urls = [
      ...new Set(
        check.evidenceReceiptIds.flatMap((id) => {
          const href = safeHttpUrl(evidenceById.get(id)?.url);
          return href === null ? [] : [href];
        }),
      ),
    ];
    const links: EmailActionLink[] = urls.map((url, index) => ({
      label:
        urls.length === 1 ? "View source" : `View source ${String(index + 1)}`,
      url,
    }));
    attentionChecks.push({
      status: check.status === "failed" ? "problem" : "skipped",
      label: check.label,
      summary: check.summary,
      ...(links.length === 0 ? {} : { links }),
    });
  }
  return {
    kind: "checks",
    heading: "Checks",
    attentionChecks,
    passedLabels,
  };
}

function buildDetails(report: ReportEnvelopeV1): EmailDetailRow[] {
  const temporalHref = safeHttpUrl(report.provenance.temporalUrl);
  const prHref = safeHttpUrl(report.remediation?.prUrl);
  return [
    {
      label: "Completed",
      value: formatPacificTimestamp(report.completedAt),
      mono: false,
    },
    {
      label: "Workflow",
      value: report.provenance.workflowId,
      ...(temporalHref === null ? { mono: true } : { url: temporalHref }),
    },
    ...(report.provenance.repoSha === undefined
      ? []
      : [
          {
            label: "Commit",
            value: report.provenance.repoSha.slice(0, 12),
            mono: true,
          },
        ]),
    ...(prHref === null
      ? []
      : [
          {
            label: "Pull request",
            value: prHref,
            url: prHref,
          },
        ]),
  ];
}

export function buildReportEnvelopeDocument(
  report: ReportEnvelopeV1,
  eyebrow: string,
): EmailDocument {
  const activeOrAllFindings = report.findings.filter(
    (finding) =>
      finding.state !== "recovered" && finding.state !== "suppressed",
  );
  const proseParagraphs = [
    ...(report.remediation?.summary === undefined
      ? []
      : [report.remediation.summary]),
    ...(report.synthesis === undefined ? [] : [report.synthesis]),
  ];
  const sections: EmailSection[] = [
    ...(activeOrAllFindings.length === 0
      ? []
      : [
          {
            kind: "items" as const,
            heading: "Findings",
            items: activeOrAllFindings.map((finding) =>
              findingCard(report, finding),
            ),
          },
        ]),
    ...(proseParagraphs.length === 0
      ? []
      : [
          {
            kind: "prose" as const,
            heading: "Notes",
            paragraphs: proseParagraphs,
          },
        ]),
    ...(report.limitations.length === 0
      ? []
      : [
          {
            kind: "prose" as const,
            heading: "Not covered",
            bullets: report.limitations,
          },
        ]),
    buildChecksSection(report),
  ];

  const hubHref = hubReportRunUrl(report.reportRunId);
  const prHref = safeHttpUrl(report.remediation?.prUrl);
  const temporalHref = safeHttpUrl(report.provenance.temporalUrl);
  const primaryAction: EmailActionLink =
    prHref === null
      ? { label: "Open in Hub", url: hubHref }
      : { label: "Review pull request", url: prHref };
  const secondaryActions: EmailActionLink[] = [
    ...(prHref === null ? [] : [{ label: "Open in Hub", url: hubHref }]),
    ...(temporalHref === null
      ? []
      : [{ label: "View workflow run", url: temporalHref }]),
  ];
  const singleAction =
    report.actions.length === 1 ? report.actions[0] : undefined;

  return {
    eyebrow,
    tone: envelopeTone(report),
    badge: envelopeBadge(report),
    preheader: report.headline,
    heading: report.title,
    lead: report.headline,
    ...(singleAction === undefined ? {} : { nextStep: singleAction }),
    ...(report.actions.length > 1
      ? {
          callout: {
            tone: "warning",
            title: "Next steps",
            bullets: report.actions,
          },
        }
      : {}),
    sections,
    primaryAction,
    ...(secondaryActions.length === 0 ? {} : { secondaryActions }),
    details: buildDetails(report),
  };
}

export function renderReportEnvelopeEmail(
  report: ReportEnvelopeV1,
  eyebrow: string,
): { htmlBody: string; plainBody: string } {
  const document = buildReportEnvelopeDocument(report, eyebrow);
  return {
    htmlBody: renderEmailHtml(document),
    plainBody: renderEmailText(document),
  };
}
