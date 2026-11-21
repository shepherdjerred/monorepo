import { z } from "zod/v4";
import type { ReportEnvelopeV1 } from "./report.ts";

export const TAILORED_REPORT_TYPES = [
  "agent-task",
  "dependency-summary",
  "homelab-audit",
  "link-rot-scan",
  "main-vuln-scan",
  "scout-data-dragon",
  "scout-lane-priors",
  "scout-queue-windows",
  "scout-season-refresh",
  "tasknotes-canary",
] as const;

const TailoredReportTypeSchema = z.enum(TAILORED_REPORT_TYPES);

export type ReportPresentationTone = "ok" | "review" | "incomplete";

export type HumanReportCheck = {
  label: string;
  status: "Passed" | "Problem" | "Not checked";
  summary: string;
  evidenceReceiptIds: string[];
};

export type ReportEmailPresentation = {
  subject: string;
  heading: string;
  statusLabel: "No action needed" | "Review needed" | "Check incomplete";
  tone: ReportPresentationTone;
  summary: string;
  actions: string[];
  findings: ReportEnvelopeV1["findings"];
  synthesis: string | undefined;
  checks: HumanReportCheck[];
  limitations: string[];
};

type SubjectCopy = {
  clear: string;
  changed: string;
  attention: string;
  pending: string;
  inconclusive: string;
  partial: string;
  failed: string;
};

type SubjectPolicy = (report: ReportEnvelopeV1) => string;

function subjectFromCopy(report: ReportEnvelopeV1, copy: SubjectCopy): string {
  if (report.execution === "failed") return copy.failed;
  return report.execution === "partial" ? copy.partial : copy[report.verdict];
}

function agentTaskTitle(title: string): string {
  const prefixEnd = title.indexOf(": ");
  return prefixEnd === -1 ? title : title.slice(prefixEnd + 2);
}

function agentTaskSubject(report: ReportEnvelopeV1): string {
  const title = agentTaskTitle(report.title);
  if (
    report.execution !== "complete" ||
    report.verdict === "inconclusive" ||
    report.verdict === "pending"
  ) {
    return `${title}: Could not finish`;
  }
  return report.verdict === "attention"
    ? `${title}: Action needed`
    : `${title}: Report ready`;
}

const SUBJECT_POLICIES = {
  "agent-task": agentTaskSubject,
  "dependency-summary": (report) =>
    subjectFromCopy(report, {
      clear: "Dependencies: Up to date",
      changed: "Dependencies: Updates available",
      attention: "Dependencies: Action needed",
      pending: "Dependencies: Check pending",
      inconclusive: "Dependencies: Check incomplete",
      partial: "Dependencies: Check incomplete",
      failed: "Dependencies: Check failed",
    }),
  "homelab-audit": (report) =>
    subjectFromCopy(report, {
      clear: "Homelab check: All clear",
      changed: "Homelab check: Changes detected",
      attention: "Homelab check: Issues need review",
      pending: "Homelab check: Still pending",
      inconclusive: "Homelab check: Could not finish",
      partial: "Homelab check: Could not finish",
      failed: "Homelab check: Run failed",
    }),
  "link-rot-scan": (report) =>
    subjectFromCopy(report, {
      clear: "Link check: All links reachable",
      changed: "Link check: Link changes detected",
      attention: "Link check: Broken links found",
      pending: "Link check: Still pending",
      inconclusive: "Link check: Could not finish",
      partial: "Link check: Could not finish",
      failed: "Link check: Run failed",
    }),
  "main-vuln-scan": (report) =>
    subjectFromCopy(report, {
      clear: "Security scan: No high-risk issues",
      changed: "Security scan: Advisory changes found",
      attention: "Security scan: Vulnerabilities need review",
      pending: "Security scan: Still pending",
      inconclusive: "Security scan: Could not finish",
      partial: "Security scan: Could not finish",
      failed: "Security scan: Run failed",
    }),
  "scout-data-dragon": (report) =>
    subjectFromCopy(report, {
      clear: "Scout update: Patch data up to date",
      changed: "Scout update: Data Dragon PR opened",
      attention: "Scout update: Data Dragon needs review",
      pending: "Scout update: Data Dragon check pending",
      inconclusive: "Scout update: Data Dragon incomplete",
      partial: "Scout update: Data Dragon needs review",
      failed: "Scout update: Data Dragon failed",
    }),
  "scout-lane-priors": (report) =>
    subjectFromCopy(report, {
      clear: "Scout lane data: Up to date",
      changed: "Scout lane data: Update PR opened",
      attention: "Scout lane data: Needs review",
      pending: "Scout lane data: Still pending",
      inconclusive: "Scout lane data: Could not finish",
      partial: "Scout lane data: Needs review",
      failed: "Scout lane data: Update failed",
    }),
  "scout-queue-windows": (report) =>
    subjectFromCopy(report, {
      clear: "Scout queues: Windows up to date",
      changed: "Scout queues: Window changes detected",
      attention: "Scout queues: Warnings need review",
      pending: "Scout queues: Check pending",
      inconclusive: "Scout queues: Could not finish",
      partial: "Scout queues: Needs review",
      failed: "Scout queues: Check failed",
    }),
  "scout-season-refresh": (report) =>
    subjectFromCopy(report, {
      clear: "Scout season: Dates up to date",
      changed: "Scout season: Update PR opened",
      attention: "Scout season: Dates need review",
      pending: "Scout season: Check pending",
      inconclusive: "Scout season: Could not finish",
      partial: "Scout season: Dates need review",
      failed: "Scout season: Update failed",
    }),
  "tasknotes-canary": (report) =>
    subjectFromCopy(report, {
      clear: "TaskNotes check: All clear",
      changed: "TaskNotes check: Changes detected",
      attention: "TaskNotes check: Issue needs review",
      pending: "TaskNotes check: Still pending",
      inconclusive: "TaskNotes check: Could not finish",
      partial: "TaskNotes check: Could not finish",
      failed: "TaskNotes check: Run failed",
    }),
} satisfies Record<(typeof TAILORED_REPORT_TYPES)[number], SubjectPolicy>;

function genericSubject(report: ReportEnvelopeV1): string {
  if (report.execution === "failed") return `${report.title}: Run failed`;
  if (report.execution === "partial" || report.verdict === "inconclusive") {
    return `${report.title}: Could not finish`;
  }
  if (report.verdict === "attention") {
    return `${report.title}: Action needed`;
  }
  if (report.verdict === "pending") return `${report.title}: Still pending`;
  return report.verdict === "changed"
    ? `${report.title}: Changes detected`
    : `${report.title}: All clear`;
}

export function hasTailoredReportPresentation(reportType: string): boolean {
  return TailoredReportTypeSchema.safeParse(reportType).success;
}

export function reportSubject(report: ReportEnvelopeV1): string {
  const reportType = TailoredReportTypeSchema.safeParse(report.reportType);
  return reportType.success
    ? SUBJECT_POLICIES[reportType.data](report)
    : genericSubject(report);
}

function presentationTone(
  report: ReportEnvelopeV1,
  actionCount: number,
): ReportPresentationTone {
  if (
    report.execution !== "complete" ||
    report.verdict === "inconclusive" ||
    report.verdict === "pending"
  ) {
    return "incomplete";
  }
  return report.verdict === "attention" || actionCount > 0 ? "review" : "ok";
}

function checkStatus(
  status: ReportEnvelopeV1["checks"][number]["status"],
): HumanReportCheck["status"] {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Problem";
    case "skipped":
      return "Not checked";
  }
}

const FINDING_RANK = {
  critical: 0,
  warning: 1,
  info: 2,
} satisfies Record<ReportEnvelopeV1["findings"][number]["severity"], number>;

export function presentReport(
  report: ReportEnvelopeV1,
): ReportEmailPresentation {
  const actions = [
    ...report.actions,
    ...(report.retirementRecommendation === undefined
      ? []
      : [report.retirementRecommendation]),
  ];
  const tone = presentationTone(report, actions.length);
  const humanActions =
    actions.length > 0
      ? actions
      : tone === "incomplete"
        ? ["Open the workflow run and review the reported problem."]
        : tone === "review"
          ? ["Open the workflow run and review the reported issue."]
          : actions;
  return {
    subject: reportSubject(report),
    heading: reportSubject(report),
    statusLabel:
      tone === "ok"
        ? "No action needed"
        : tone === "review"
          ? "Review needed"
          : "Check incomplete",
    tone,
    summary: report.headline,
    actions: humanActions,
    findings: [...report.findings].sort(
      (left, right) =>
        FINDING_RANK[left.severity] - FINDING_RANK[right.severity],
    ),
    synthesis: report.synthesis,
    checks: report.checks.map((check) => ({
      label: check.label,
      status: checkStatus(check.status),
      summary: check.summary,
      evidenceReceiptIds: check.evidenceReceiptIds,
    })),
    limitations: report.limitations,
  };
}
