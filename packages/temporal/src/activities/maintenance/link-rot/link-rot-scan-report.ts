// Pure report assembly for the weekly link-rot scan — no I/O, no
// Bugsink/observability imports, so the workflow bundle can import it directly
// (same pattern as main-vuln-scan-report.ts).
import type { DeadLink, LinkRotScanResult } from "./link-rot-scan.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";

export const LINK_ROT_REPORT_TYPE = "link-rot-scan";
export const LINK_ROT_SCHEDULE_ID = "link-rot-scan-weekly";
export const LINK_ROT_TITLE = "Weekly link-rot scan of main";

const SCAN_RECEIPT_ID = "lychee-scan";
const REMEDIATION_RECEIPT_ID = "link-rot-remediation";

function normalizeSource(source: string): string {
  return source.startsWith("./") ? source.slice(2) : source;
}

function linkSummary(link: DeadLink): string {
  return `${link.url} — ${link.status}`;
}

function linkLocation(link: DeadLink): string {
  const location =
    link.line === undefined
      ? link.source
      : `${link.source}:${String(link.line)}`;
  return `Referenced from ${location}.`;
}

function deadLinkDetail(link: DeadLink, prUrl?: string): string {
  return prUrl === undefined
    ? `${linkLocation(link)} Fix the link, replace it with a live equivalent, or add a justified exclusion to .lycheeignore.`
    : `${linkLocation(link)} Addressed in automated remediation PR ${prUrl}.`;
}

function timedOutLinkDetail(link: DeadLink): string {
  return `${linkLocation(link)} Retry the link or investigate its reachability before treating it as dead or adding an exclusion.`;
}

/**
 * Dead documentation links are warnings by policy — they rot silently but
 * break nothing in production, so today this always returns 0 and the
 * published Alertmanager occurrence only resolves. It reads the built report
 * rather than hard-coding 0 so the fire/resolve path stays genuinely
 * symmetric with the vulnerability scan: a future mapping that introduces a
 * critical finding would page without further wiring.
 */
export function countCriticalReportFindings(
  report: Pick<ActivityReportInput, "findings">,
): number {
  return report.findings.filter((finding) => finding.severity === "critical")
    .length;
}

function buildRemediationCheckAndEvidence(
  observedAt: string,
  remediation: ReportRemediationV1 | undefined,
): {
  checks: ActivityReportInput["checks"];
  evidence: ActivityReportInput["evidence"];
} {
  if (remediation === undefined) {
    return { checks: [], evidence: [] };
  }
  const failedWithoutPr =
    remediation.outcome === "partial" && remediation.prUrl === undefined;
  const skipped = remediation.outcome === "skipped";
  const receiptStatus = failedWithoutPr ? "failure" : "success";
  return {
    checks: [
      {
        id: "dead-link-remediation",
        label: "Automated dead-link remediation",
        required: false,
        status: skipped ? "skipped" : failedWithoutPr ? "failed" : "passed",
        summary: remediation.summary ?? `Outcome: ${remediation.outcome}`,
        evidenceReceiptIds: skipped ? [] : [REMEDIATION_RECEIPT_ID],
      },
    ],
    evidence: skipped
      ? []
      : [
          {
            id: REMEDIATION_RECEIPT_ID,
            source: "Codex SDK dead-link remediation",
            observedAt,
            status: receiptStatus,
            ...(remediation.prUrl === undefined
              ? {}
              : { url: remediation.prUrl }),
            excerpt: (remediation.summary ?? remediation.outcome).slice(
              0,
              2000,
            ),
          },
        ],
  };
}

function buildDeadLinkFindings(
  deadLinks: readonly DeadLink[],
  remediation: ReportRemediationV1 | undefined,
): ActivityReportInput["findings"] {
  const prUrl = remediation?.prUrl;
  const allResolvedInPr =
    prUrl !== undefined && (remediation?.unresolvedCount ?? 0) === 0;
  const changedSources = new Set(remediation?.changedFiles);
  const maxDowngraded =
    prUrl === undefined
      ? 0
      : allResolvedInPr
        ? deadLinks.length
        : (remediation?.resolvedCount ?? 0);
  let downgradedSoFar = 0;

  return deadLinks.map((link) => {
    const canDowngrade =
      prUrl !== undefined &&
      downgradedSoFar < maxDowngraded &&
      (allResolvedInPr || changedSources.has(normalizeSource(link.source)));
    if (canDowngrade) {
      downgradedSoFar += 1;
      return {
        section: "Dead links",
        state: "observing" as const,
        severity: "info" as const,
        summary: linkSummary(link),
        detail: deadLinkDetail(link, prUrl),
        evidenceReceiptIds: [SCAN_RECEIPT_ID, REMEDIATION_RECEIPT_ID],
      };
    }
    return {
      section: "Dead links",
      severity: "warning" as const,
      summary: linkSummary(link),
      detail: deadLinkDetail(link),
      evidenceReceiptIds: [SCAN_RECEIPT_ID],
    };
  });
}

function deadLinkActions(
  dead: number,
  remediation: ReportRemediationV1 | undefined,
): string[] {
  if (dead === 0) {
    return [];
  }
  const prUrl = remediation?.prUrl;
  if (prUrl === undefined) {
    return [
      "Fix or replace each confirmed dead link, or record a justified exclusion in .lycheeignore.",
    ];
  }
  if ((remediation?.unresolvedCount ?? 0) === 0) {
    return remediation?.autoMergeEnabled === true
      ? []
      : [`Review and merge dead-link fix PR ${prUrl}.`];
  }
  return [
    `Review partial dead-link fix PR ${prUrl} and resolve remaining broken links.`,
  ];
}

function linkRotActions(
  dead: number,
  timedOut: number,
  remediation: ReportRemediationV1 | undefined,
): string[] {
  const timeoutActions =
    timedOut === 0
      ? []
      : [
          "Retry timed-out links or investigate their reachability before treating them as dead or adding an exclusion.",
        ];
  return [...deadLinkActions(dead, remediation), ...timeoutActions];
}

function buildLinkRotHeadline(
  result: LinkRotScanResult,
  remediation: ReportRemediationV1 | undefined,
): string {
  const dead = result.deadLinks.length;
  const timedOut = result.timedOutLinks.length;
  const shortSha = result.repoSha.slice(0, 12);
  if (dead === 0 && timedOut === 0) {
    return `lychee checked ${String(result.totalLinks)} links on main@${shortSha}; none are dead.`;
  }
  const prUrl = remediation?.prUrl;
  return prUrl !== undefined && (remediation?.unresolvedCount ?? 0) === 0
    ? `lychee found ${String(dead)} dead and ${String(timedOut)} timed-out links on main@${shortSha}; fix PR opened (${prUrl}).`
    : `lychee found ${String(dead)} dead and ${String(timedOut)} timed-out links on main@${shortSha}.`;
}

function buildLinkRotVerdict(
  dead: number,
  timedOut: number,
  remediation: ReportRemediationV1 | undefined,
): ActivityReportInput["verdict"] {
  if (dead === 0 && timedOut === 0) {
    return "clear";
  }
  const allDeadResolvedInPr =
    remediation?.prUrl !== undefined &&
    (remediation.unresolvedCount ?? 0) === 0;
  return allDeadResolvedInPr && timedOut === 0 ? "changed" : "attention";
}

export function buildLinkRotReport(
  startedAt: string,
  result: LinkRotScanResult,
  remediation?: ReportRemediationV1,
): ActivityReportInput {
  const dead = result.deadLinks.length;
  const timedOut = result.timedOutLinks.length;
  const ignoredRootRelative = result.ignoredRootRelativeLinks;
  const internalLinkSummary =
    ignoredRootRelative === 0
      ? ""
      : ` ${String(ignoredRootRelative)} site-root-relative ${ignoredRootRelative === 1 ? "link was" : "links were"} delegated to their owning site checks.`;
  const remediationArtifacts = buildRemediationCheckAndEvidence(
    result.observedAt,
    remediation,
  );

  return {
    reportType: LINK_ROT_REPORT_TYPE,
    title: LINK_ROT_TITLE,
    scheduleId: LINK_ROT_SCHEDULE_ID,
    startedAt,
    execution: "complete",
    verdict: buildLinkRotVerdict(dead, timedOut, remediation),
    headline: buildLinkRotHeadline(result, remediation),
    checks: [
      {
        id: "lychee-scan-completed",
        label: "lychee link scan of main completed",
        required: true,
        status: "passed",
        summary: `Checked ${String(result.totalLinks)} links (${String(result.successfulLinks)} alive, ${String(result.excludedLinks)} excluded) on main@${result.repoSha.slice(0, 12)}.${internalLinkSummary}`,
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      },
      ...remediationArtifacts.checks,
    ],
    evidence: [
      {
        id: SCAN_RECEIPT_ID,
        source: "lychee (shallow clone of main, root lychee.toml)",
        observedAt: result.observedAt,
        status: "success",
        command: result.command,
        exitCode: result.exitCode,
        excerpt: result.excerpt,
      },
      ...remediationArtifacts.evidence,
    ],
    findings: [
      ...buildDeadLinkFindings(result.deadLinks, remediation),
      // Timeouts are usually slow or bot-throttled hosts rather than rot;
      // surface them without treating them as confirmed-dead.
      ...result.timedOutLinks.map((link) => ({
        section: "Timed-out links",
        severity: "info" as const,
        summary: linkSummary(link),
        detail: timedOutLinkDetail(link),
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      })),
    ],
    limitations: [
      "Scope: tracked Markdown, web links only, verbatim/code-block URLs skipped; 403/429 responses count as alive (bot-hostile hosts). Site-root-relative links are validated by the owning site's build checks. See root lychee.toml.",
      ...(remediation?.outcome === "partial" &&
      remediation.summary !== undefined
        ? [remediation.summary]
        : []),
    ],
    actions: linkRotActions(dead, timedOut, remediation),
    ...(remediation === undefined ? {} : { remediation }),
    provenance: {
      source: "https://github.com/shepherdjerred/monorepo",
      repoSha: result.repoSha,
    },
  };
}

export function buildLinkRotFailureReport(
  startedAt: string,
  error: unknown,
): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: LINK_ROT_REPORT_TYPE,
    title: LINK_ROT_TITLE,
    scheduleId: LINK_ROT_SCHEDULE_ID,
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "The lychee scan of main failed; no link-rot verdict.",
    checks: [
      {
        id: "lychee-scan-completed",
        label: "lychee link scan of main completed",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["scan-failure"],
      },
    ],
    evidence: [
      {
        id: "scan-failure",
        source: "link-rot scan workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "The clone or lychee scan did not produce a parseable report.",
    ],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "https://github.com/shepherdjerred/monorepo" },
  };
}
