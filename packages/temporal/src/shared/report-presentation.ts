import { z } from "zod/v4";
import type { ReportEnvelopeV1 } from "./report.ts";

export const TAILORED_REPORT_TYPES = [
  "agent-task",
  "ci-io-impact",
  "dependency-summary",
  "homelab-audit",
  "link-rot-scan",
  "main-vuln-scan",
  "protobufjs-v8-watch",
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
  if (report.execution === "partial") return copy.partial;
  return copy[report.verdict];
}

function agentTaskTitle(title: string): string {
  const prefixEnd = title.indexOf(": ");
  return prefixEnd === -1 ? title : title.slice(prefixEnd + 2);
}

function agentTaskSubject(report: ReportEnvelopeV1): string {
  const title = agentTaskTitle(report.title);
  if (report.execution !== "complete" || report.verdict === "inconclusive") {
    return `${title} could not finish`;
  }
  if (report.verdict === "attention") return `Action needed: ${title}`;
  return `${title}: report ready`;
}

const SUBJECT_POLICIES = {
  "agent-task": agentTaskSubject,
  "ci-io-impact": (report) =>
    subjectFromCopy(report, {
      clear: "CI I/O report is ready",
      changed: "CI I/O report is ready",
      attention: "Action needed: CI I/O target missed",
      pending: "CI I/O report is still pending",
      inconclusive: "CI I/O report could not finish",
      partial: "CI I/O report could not finish",
      failed: "CI I/O report failed",
    }),
  "dependency-summary": (report) =>
    subjectFromCopy(report, {
      clear: "Dependencies are up to date",
      changed: "Dependency changes found",
      attention: "Action needed: dependency report",
      pending: "Dependency report is still pending",
      inconclusive: "Dependency report could not finish",
      partial: "Dependency report could not finish",
      failed: "Dependency report failed",
    }),
  "homelab-audit": (report) =>
    subjectFromCopy(report, {
      clear: "Your homelab looks healthy",
      changed: "Your homelab changed",
      attention: "Action needed: homelab issues found",
      pending: "Homelab check is still pending",
      inconclusive: "Homelab check could not finish",
      partial: "Homelab check could not finish",
      failed: "Homelab check failed",
    }),
  "link-rot-scan": (report) =>
    subjectFromCopy(report, {
      clear: "No broken links found",
      changed: "Link changes found",
      attention: "Broken or unreachable links found",
      pending: "Link check is still pending",
      inconclusive: "Link check could not finish",
      partial: "Link check could not finish",
      failed: "Link check failed",
    }),
  "main-vuln-scan": (report) =>
    subjectFromCopy(report, {
      clear: "No high-risk vulnerabilities found",
      changed: "Vulnerability changes found",
      attention: "Action needed: vulnerabilities found",
      pending: "Vulnerability scan is still pending",
      inconclusive: "Vulnerability scan could not finish",
      partial: "Vulnerability scan could not finish",
      failed: "Vulnerability scan failed",
    }),
  "protobufjs-v8-watch": (report) =>
    subjectFromCopy(report, {
      clear: "Temporal still uses protobufjs v7",
      changed: "Temporal protobufjs compatibility changed",
      attention: "Temporal can move to protobufjs v8",
      pending: "Temporal still uses protobufjs v7",
      inconclusive: "protobufjs compatibility check could not finish",
      partial: "protobufjs compatibility check could not finish",
      failed: "protobufjs compatibility check failed",
    }),
  "scout-data-dragon": (report) =>
    subjectFromCopy(report, {
      clear: "Scout data is up to date",
      changed: "Scout Data Dragon update created",
      attention: "Action needed: Scout Data Dragon update",
      pending: "Scout Data Dragon check is still pending",
      inconclusive: "Scout Data Dragon check could not finish",
      partial: "Scout Data Dragon update needs attention",
      failed: "Scout Data Dragon update failed",
    }),
  "scout-lane-priors": (report) =>
    subjectFromCopy(report, {
      clear: "Scout lane data is up to date",
      changed: "Scout lane-data update created",
      attention: "Action needed: Scout lane-data update",
      pending: "Scout lane-data check is still pending",
      inconclusive: "Scout lane-data check could not finish",
      partial: "Scout lane-data update needs attention",
      failed: "Scout lane-data update failed",
    }),
  "scout-queue-windows": (report) =>
    subjectFromCopy(report, {
      clear: "Scout queue windows are up to date",
      changed: "Scout queue-window changes found",
      attention: "Action needed: Scout queue-window warnings",
      pending: "Scout queue-window check is still pending",
      inconclusive: "Scout queue-window check could not finish",
      partial: "Scout queue-window update needs attention",
      failed: "Scout queue-window check failed",
    }),
  "scout-season-refresh": (report) =>
    subjectFromCopy(report, {
      clear: "Scout season dates are up to date",
      changed: "Scout season-date update created",
      attention: "Action needed: Scout season-date update",
      pending: "Scout season-date check is still pending",
      inconclusive: "Scout season-date check could not finish",
      partial: "Scout season-date update needs attention",
      failed: "Scout season-date update failed",
    }),
  "tasknotes-canary": (report) =>
    subjectFromCopy(report, {
      clear: "TaskNotes looks healthy",
      changed: "TaskNotes changed",
      attention: "Action needed: TaskNotes problem found",
      pending: "TaskNotes check is still pending",
      inconclusive: "TaskNotes check could not finish",
      partial: "TaskNotes check could not finish",
      failed: "TaskNotes check failed",
    }),
} satisfies Record<(typeof TAILORED_REPORT_TYPES)[number], SubjectPolicy>;

function genericSubject(report: ReportEnvelopeV1): string {
  if (report.execution === "failed") return `${report.title} failed`;
  if (report.execution === "partial" || report.verdict === "inconclusive") {
    return `${report.title} could not finish`;
  }
  if (report.verdict === "attention") {
    return `Action needed: ${report.title}`;
  }
  if (report.verdict === "pending") return `${report.title} is still pending`;
  if (report.verdict === "changed") return `${report.title}: changes found`;
  return `${report.title}: no action needed`;
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

function presentationTone(report: ReportEnvelopeV1): ReportPresentationTone {
  if (
    report.execution !== "complete" ||
    report.verdict === "inconclusive" ||
    (report.verdict === "pending" &&
      report.reportType !== "protobufjs-v8-watch")
  ) {
    return "incomplete";
  }
  if (report.verdict === "attention" || report.actions.length > 0) {
    return "review";
  }
  return "ok";
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
  const tone = presentationTone(report);
  const actions = [
    ...report.actions,
    ...(report.retirementRecommendation === undefined
      ? []
      : [report.retirementRecommendation]),
  ];
  const humanActions =
    tone === "incomplete" && actions.length === 0
      ? ["Open the workflow run and review the reported problem."]
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
