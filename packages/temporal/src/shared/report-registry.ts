export type ReportScheduleRegistration = {
  scheduleId: string;
  reportType: string;
  cadenceHours: number;
  graceHours: number;
};

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
  },
  {
    scheduleId: "deps-summary-weekly",
    reportType: "dependency-summary",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
  },
  {
    scheduleId: "scout-data-dragon-version-check",
    reportType: "scout-data-dragon",
    cadenceHours: 48,
    graceHours: defaultReportGraceHours(48),
  },
  {
    scheduleId: "scout-data-dragon-weekly-refresh",
    reportType: "scout-data-dragon",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
  },
  {
    scheduleId: "scout-queue-windows-daily",
    reportType: "scout-queue-windows",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
  },
  {
    scheduleId: "scout-season-refresh-weekly",
    reportType: "scout-season-refresh",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
  },
  {
    scheduleId: "tasknotes-skipped-files-canary",
    reportType: "tasknotes-canary",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
  },
  {
    scheduleId: "protobufjs-v8-watch-weekly",
    reportType: "protobufjs-v8-watch",
    cadenceHours: 168,
    graceHours: defaultReportGraceHours(168),
  },
  {
    scheduleId: "ci-io-post-merge-impact",
    reportType: "ci-io-impact",
    cadenceHours: 24,
    graceHours: defaultReportGraceHours(24),
  },
];
