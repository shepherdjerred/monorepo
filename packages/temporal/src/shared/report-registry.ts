export type ReportScheduleRegistration = {
  scheduleId: string;
  reportType: string;
  cadenceHours: number;
  graceHours: number;
  receiptRequiredAfter: string;
};

const REPORT_RECEIPT_ACTIVATION = "2026-08-11T23:52:18.000Z";

/**
 * Activation for schedules rolled out with the weekly scanner reports.
 *
 * A registration's activation must not precede its real rollout by more than
 * `graceHours`. Before a schedule's first receipt exists, `evaluateFreshness`
 * bounds the pending window at `receiptRequiredAfter + cadenceHours +
 * graceHours`, so reusing REPORT_RECEIPT_ACTIVATION here would hand a brand-new
 * weekly schedule a deadline of 2026-08-19 — already expired — and the
 * 15-minute monitor would report `missing` and page
 * `TemporalReportHeartbeatStale` for a full cadence before the schedule could
 * run even once. Setting it later than the rollout is safe (the pending window
 * simply starts later); setting it earlier is not. Bump this date if the
 * rollout slips past it.
 */
const SCANNER_REPORT_ACTIVATION = "2026-09-01T00:00:00.000Z";

export function defaultReportGraceHours(cadenceHours: number): number {
  if (cadenceHours < 24) return 0.5;
  return cadenceHours < 168 ? 2 : 6;
}

export const REPORT_SCHEDULE_REGISTRY: readonly ReportScheduleRegistration[] = [
  {
    scheduleId: "homelab-audit-daily",
    reportType: "homelab-audit",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "deps-summary-weekly",
    reportType: "dependency-summary",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "scout-data-dragon-version-check",
    reportType: "scout-data-dragon",
    cadenceHours: 48,
    graceHours: defaultReportGraceHours(48),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "scout-data-dragon-weekly-refresh",
    reportType: "scout-data-dragon",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "scout-queue-windows-daily",
    reportType: "scout-queue-windows",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "scout-season-refresh-weekly",
    reportType: "scout-season-refresh",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "tasknotes-skipped-files-canary",
    reportType: "tasknotes-canary",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "protobufjs-v8-watch-weekly",
    reportType: "protobufjs-v8-watch",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
  {
    scheduleId: "main-vuln-scan-weekly",
    reportType: "main-vuln-scan",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: SCANNER_REPORT_ACTIVATION,
  },
  {
    scheduleId: "link-rot-scan-weekly",
    reportType: "link-rot-scan",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
    receiptRequiredAfter: SCANNER_REPORT_ACTIVATION,
  },
  {
    scheduleId: "ci-io-post-merge-impact",
    reportType: "ci-io-impact",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
    receiptRequiredAfter: REPORT_RECEIPT_ACTIVATION,
  },
];
