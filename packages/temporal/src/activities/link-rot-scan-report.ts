// Pure report assembly for the weekly link-rot scan — no I/O, no
// Sentry/observability imports, so the workflow bundle can import it directly
// (same pattern as main-vuln-scan-report.ts).
import type { DeadLink, LinkRotScanResult } from "./link-rot-scan.ts";
import type { ActivityReportInput } from "./report-delivery.ts";

export const LINK_ROT_REPORT_TYPE = "link-rot-scan";
export const LINK_ROT_SCHEDULE_ID = "link-rot-scan-weekly";
export const LINK_ROT_TITLE = "Weekly link-rot scan of main";

const SCAN_RECEIPT_ID = "lychee-scan";

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

function deadLinkDetail(link: DeadLink): string {
  return `${linkLocation(link)} Fix the link, replace it with a live equivalent, or add a justified exclusion to .lycheeignore.`;
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

export function buildLinkRotReport(
  startedAt: string,
  result: LinkRotScanResult,
): ActivityReportInput {
  const dead = result.deadLinks.length;
  const timedOut = result.timedOutLinks.length;
  const clean = dead === 0 && timedOut === 0;
  return {
    reportType: LINK_ROT_REPORT_TYPE,
    title: LINK_ROT_TITLE,
    scheduleId: LINK_ROT_SCHEDULE_ID,
    startedAt,
    execution: "complete",
    verdict: clean ? "clear" : "attention",
    headline: clean
      ? `lychee checked ${String(result.totalLinks)} links on main@${result.repoSha.slice(0, 12)}; none are dead.`
      : `lychee found ${String(dead)} dead and ${String(timedOut)} timed-out links on main@${result.repoSha.slice(0, 12)}.`,
    checks: [
      {
        id: "lychee-scan-completed",
        label: "lychee link scan of main completed",
        required: true,
        status: "passed",
        summary: `Checked ${String(result.totalLinks)} links (${String(result.successfulLinks)} alive, ${String(result.excludedLinks)} excluded) on main@${result.repoSha.slice(0, 12)}.`,
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      },
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
    ],
    findings: [
      ...result.deadLinks.map((link) => ({
        section: "Dead links",
        severity: "warning" as const,
        summary: linkSummary(link),
        detail: deadLinkDetail(link),
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      })),
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
      "Scope: tracked Markdown, web links only, verbatim/code-block URLs skipped; 403/429 responses count as alive (bot-hostile hosts). See root lychee.toml.",
    ],
    actions: [
      ...(dead === 0
        ? []
        : [
            "Fix or replace each confirmed dead link, or record a justified exclusion in .lycheeignore.",
          ]),
      ...(timedOut === 0
        ? []
        : [
            "Retry timed-out links or investigate their reachability before treating them as dead or adding an exclusion.",
          ]),
    ],
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
