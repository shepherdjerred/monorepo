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
import { hubReportRunUrl } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  presentReport,
  reportEyebrow,
  type ReportEmailPresentation,
  type ReportPresentationTone,
} from "./report-presentation.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
  type ReportRemediationV1,
} from "./report.ts";

function mapPresentationTone(tone: ReportPresentationTone): EmailTone {
  switch (tone) {
    case "ok":
      return "ok";
    case "review":
      return "warning";
    case "incomplete":
      return "critical";
  }
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
        const href = safeHttpUrl(evidence.get(id)?.url);
        return href === null ? [] : [href];
      }),
    ),
  ];
}

function sourceActionLinks(urls: readonly string[]): EmailActionLink[] {
  return urls.map((url, index) => ({
    label:
      urls.length === 1 ? "View source" : `View source ${String(index + 1)}`,
    url,
  }));
}

function mapFindingSeverity(
  severity: ReportEnvelopeV1["findings"][number]["severity"],
): { tone: EmailTone; badge: string } {
  switch (severity) {
    case "critical":
      return { tone: "critical", badge: "Critical" };
    case "warning":
      return { tone: "warning", badge: "Warning" };
    case "info":
      return { tone: "info", badge: "Note" };
  }
}

function buildRemediationSection(
  remediation: ReportRemediationV1,
  prHref: string,
): Extract<EmailSection, { kind: "items" }> {
  const autoMerge = remediation.autoMergeEnabled === true;
  const fileCount = remediation.changedFiles.length;
  const card: EmailItemCard = {
    tone: autoMerge ? "ok" : "info",
    badge: autoMerge ? "Auto-merge enabled" : "Awaiting review",
    title:
      remediation.outcome === "pr-reused"
        ? "Remediation pull request updated"
        : "Remediation pull request opened",
    ...(remediation.summary === undefined ? {} : { body: remediation.summary }),
    details: [
      {
        label: "Changed files",
        value: `${String(fileCount)} ${fileCount === 1 ? "file" : "files"}`,
        mono: false,
      },
      ...(remediation.branchName === undefined
        ? []
        : [
            {
              label: "Branch",
              value: remediation.branchName,
              mono: true,
            },
          ]),
    ],
    links: [{ label: "Review pull request", url: prHref }],
  };
  return {
    kind: "items",
    heading: "Automated remediation",
    items: [card],
  };
}

function buildFindingCards(
  report: ReportEnvelopeV1,
  presentation: ReportEmailPresentation,
): EmailItemCard[] {
  return presentation.findings.map((finding) => {
    const { tone, badge } = mapFindingSeverity(finding.severity);
    const links = sourceActionLinks(
      evidenceUrls(report, finding.evidenceReceiptIds),
    );
    return {
      tone,
      badge,
      ...(finding.section === undefined ? {} : { kicker: finding.section }),
      title: finding.summary,
      ...(finding.detail === undefined ? {} : { body: finding.detail }),
      ...(links.length === 0 ? {} : { links }),
    };
  });
}

function buildChecksSection(
  report: ReportEnvelopeV1,
  presentation: ReportEmailPresentation,
): Extract<EmailSection, { kind: "checks" }> {
  const attentionChecks: EmailCheckItem[] = [];
  const passedLabels: string[] = [];

  for (const check of presentation.checks) {
    if (check.status === "Passed") {
      passedLabels.push(check.label);
      continue;
    }
    const links = sourceActionLinks(
      evidenceUrls(report, check.evidenceReceiptIds),
    );
    attentionChecks.push({
      status: check.status === "Problem" ? "problem" : "skipped",
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

function firstEvidenceHref(report: ReportEnvelopeV1): string | null {
  for (const receipt of report.evidence) {
    const href = safeHttpUrl(receipt.url);
    if (href !== null) {
      return href;
    }
  }
  return null;
}

function resolveDocumentActions(
  report: ReportEnvelopeV1,
  prHref: string | null,
): {
  primaryAction: EmailActionLink;
  secondaryActions: EmailActionLink[];
} {
  const hubHref = hubReportRunUrl(report.reportRunId);
  const temporalHref = safeHttpUrl(report.provenance.temporalUrl);
  if (prHref !== null) {
    return {
      primaryAction: { label: "Review pull request", url: prHref },
      secondaryActions: [
        { label: "Open in Hub", url: hubHref },
        ...(temporalHref === null
          ? []
          : [{ label: "View workflow run", url: temporalHref }]),
      ],
    };
  }
  const sourceHref = firstEvidenceHref(report);
  const secondaryActions =
    temporalHref === null
      ? sourceHref === null
        ? []
        : [{ label: "View source", url: sourceHref }]
      : [{ label: "View workflow run", url: temporalHref }];
  return {
    primaryAction: { label: "Open in Hub", url: hubHref },
    secondaryActions,
  };
}

function buildTechnicalDetails(report: ReportEnvelopeV1): EmailDetailRow[] {
  const temporalHref = safeHttpUrl(report.provenance.temporalUrl);
  return [
    {
      label: "Completed",
      value: formatPacificTimestamp(report.completedAt),
      mono: false,
    },
    ...(report.provenance.source === undefined
      ? []
      : [
          {
            label: "Source",
            value: report.provenance.source,
            mono: false,
          },
        ]),
    ...(report.provenance.windowStart === undefined ||
    report.provenance.windowEnd === undefined
      ? []
      : [
          {
            label: "Window",
            value: `${formatPacificTimestamp(report.provenance.windowStart)} – ${formatPacificTimestamp(report.provenance.windowEnd)}`,
            mono: false,
          },
        ]),
    ...(report.provenance.repoSha === undefined
      ? []
      : [
          {
            label: "Commit",
            value: report.provenance.repoSha.slice(0, 12),
            mono: true,
          },
        ]),
    ...(temporalHref === null
      ? []
      : [
          {
            label: "Workflow",
            value: "View workflow run",
            url: temporalHref,
          },
        ]),
  ];
}

export function buildReportEmailDocument(
  rawReport: ReportEnvelopeV1,
): EmailDocument {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const presentation = presentReport(report);
  const prHref = safeHttpUrl(report.remediation?.prUrl);
  const findingCards = buildFindingCards(report, presentation);
  const sections: EmailSection[] = [
    ...(prHref !== null && report.remediation !== undefined
      ? [buildRemediationSection(report.remediation, prHref)]
      : []),
    ...(findingCards.length === 0
      ? []
      : [
          {
            kind: "items" as const,
            heading: "Findings",
            items: findingCards,
          },
        ]),
    ...(presentation.synthesis === undefined
      ? []
      : [
          {
            kind: "prose" as const,
            heading: "Notes",
            paragraphs: [presentation.synthesis],
          },
        ]),
    ...(presentation.limitations.length === 0
      ? []
      : [
          {
            kind: "prose" as const,
            heading: "Not covered",
            bullets: presentation.limitations,
          },
        ]),
    buildChecksSection(report, presentation),
  ];

  const { primaryAction, secondaryActions } = resolveDocumentActions(
    report,
    prHref,
  );
  const singleAction =
    presentation.actions.length === 1 ? presentation.actions[0] : undefined;

  return {
    eyebrow: reportEyebrow(report.reportType),
    tone: mapPresentationTone(presentation.tone),
    badge: presentation.statusLabel,
    preheader: presentation.summary,
    heading: presentation.heading,
    lead: presentation.summary,
    ...(singleAction === undefined ? {} : { nextStep: singleAction }),
    ...(presentation.actions.length > 1
      ? {
          callout: {
            tone: "warning",
            title: "Next steps",
            bullets: presentation.actions,
          },
        }
      : {}),
    sections,
    primaryAction,
    ...(secondaryActions.length === 0 ? {} : { secondaryActions }),
    details: buildTechnicalDetails(report),
  };
}

export function renderReportHtml(rawReport: ReportEnvelopeV1): string {
  return renderEmailHtml(buildReportEmailDocument(rawReport));
}

export function renderReportText(rawReport: ReportEnvelopeV1): string {
  return renderEmailText(buildReportEmailDocument(rawReport));
}
