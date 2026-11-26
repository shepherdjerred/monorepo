import { Temporal } from "@js-temporal/polyfill";
import {
  ReportVerdictSchema,
  type ReportVerdict,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type { AutomationMode } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import { z } from "zod";

import {
  ReportFeedDeliveryStatusSchema,
  ReportsFeedTabSchema,
  type DigestRunDetailStatus,
  type IncidentMailStatus,
  type ReportFeedDeliveryStatus,
  type ReportsFeedQueryInput,
  type ReportsFeedTab,
  type ScheduleDayCell,
  type ScheduleFreshness,
} from "#shared/reports-schema";

export const PACIFIC_TZ = "America/Los_Angeles";

export const SEMANTIC_MAILBOXES = [
  "reports@sjer.red",
  "ops@sjer.red",
  "scout@sjer.red",
  "deps@sjer.red",
  "digests@sjer.red",
  "alerts@sjer.red",
] as const;

export const SCHEDULE_MAILBOXES = [
  "reports@sjer.red",
  "ops@sjer.red",
  "scout@sjer.red",
  "deps@sjer.red",
  "digests@sjer.red",
] as const;

const DetailViewModeSchema = z.enum(["inspector", "email"]);
export type DetailViewMode = z.infer<typeof DetailViewModeSchema>;

export function parseDetailViewMode(raw: string | null): DetailViewMode {
  const parsed = DetailViewModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : "inspector";
}

export function parseReportsTab(raw: string | null): ReportsFeedTab {
  const parsed = ReportsFeedTabSchema.safeParse(raw);
  return parsed.success ? parsed.data : "all";
}

export function parseReportsFeedParams(
  params: URLSearchParams,
): ReportsFeedQueryInput {
  const tab = parseReportsTab(params.get("tab"));
  const scheduleRaw = params.get("scheduleId")?.trim();
  const mailboxRaw = params.get("mailbox")?.trim();
  const verdictParsed = ReportVerdictSchema.safeParse(params.get("verdict"));
  const deliveryParsed = ReportFeedDeliveryStatusSchema.safeParse(
    params.get("delivery"),
  );
  const hasPr = params.get("hasPr") === "1" ? ("1" as const) : undefined;
  const qRaw = params.get("q")?.trim();

  return {
    tab,
    ...(scheduleRaw !== undefined && scheduleRaw.length > 0
      ? { scheduleId: scheduleRaw }
      : {}),
    ...(mailboxRaw !== undefined && mailboxRaw.length > 0
      ? { mailbox: mailboxRaw }
      : {}),
    ...(verdictParsed.success ? { verdict: verdictParsed.data } : {}),
    ...(deliveryParsed.success ? { delivery: deliveryParsed.data } : {}),
    ...(hasPr === undefined ? {} : { hasPr }),
    ...(qRaw !== undefined && qRaw.length > 0 ? { q: qRaw } : {}),
  };
}

export function formatPacificShort(iso: string): string {
  const zdt = Temporal.Instant.from(iso).toZonedDateTimeISO(PACIFIC_TZ);
  const monthDay = zdt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
  const hh = String(zdt.hour).padStart(2, "0");
  const mm = String(zdt.minute).padStart(2, "0");
  return `${monthDay}, ${hh}:${mm} PT`;
}

export function formatPacificFull(iso: string | null): string {
  if (iso === null) return "—";
  const zdt = Temporal.Instant.from(iso).toZonedDateTimeISO(PACIFIC_TZ);
  const datePart = zdt.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const hh = String(zdt.hour).padStart(2, "0");
  const mm = String(zdt.minute).padStart(2, "0");
  const ss = String(zdt.second).padStart(2, "0");
  return `${datePart}, ${hh}:${mm}:${ss} PT`;
}

export function formatPacificDate(yyyyMmDd: string): string {
  return Temporal.PlainDate.from(yyyyMmDd).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const seconds = Math.max(
    0,
    Math.round(
      Temporal.Instant.from(completedAt)
        .since(Temporal.Instant.from(startedAt))
        .total({ unit: "seconds" }),
    ),
  );
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0
    ? `${String(minutes)}m`
    : `${String(minutes)}m ${String(rem)}s`;
}

export type PillTone = "ok" | "info" | "warning" | "error" | "neutral";

export function automationModeMeta(mode: AutomationMode): {
  readonly label: string;
  readonly tone: PillTone;
} {
  switch (mode) {
    case "llm-pr-automerge":
      return { label: "Auto-merge PR", tone: "info" };
    case "llm-pr-review":
      return { label: "LLM review PR", tone: "warning" };
    case "deterministic-pr":
      return { label: "Deterministic PR", tone: "info" };
    case "diagnostic":
      return { label: "Diagnostic", tone: "neutral" };
    case "digest":
      return { label: "Digest", tone: "neutral" };
  }
}

export function freshnessMeta(freshness: ScheduleFreshness): {
  readonly label: string;
  readonly tone: PillTone;
} {
  switch (freshness) {
    case "fresh":
      return { label: "Fresh", tone: "ok" };
    case "stale":
      return { label: "Stale", tone: "warning" };
    case "empty":
      return { label: "No runs yet", tone: "neutral" };
  }
}

export function deliveryStatusMeta(
  status: ReportFeedDeliveryStatus | DigestRunDetailStatus | IncidentMailStatus,
): {
  readonly label: string;
  readonly tone: PillTone;
} {
  switch (status) {
    case "sent":
      return { label: "Emailed", tone: "info" };
    case "skipped":
      return { label: "Quiet in Hub", tone: "neutral" };
    case "pending":
      return { label: "Pending", tone: "warning" };
    case "failed":
      return { label: "Failed", tone: "error" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
    case "live-preview":
      return { label: "Live preview", tone: "info" };
  }
}

export function verdictToSeverity(verdict: ReportVerdict): Severity {
  switch (verdict) {
    case "clear":
      return "ok";
    case "changed":
      return "info";
    case "attention":
      return "warning";
    case "pending":
      return "info";
    case "inconclusive":
      return "unknown";
  }
}

export function verdictLabel(verdict: ReportVerdict): string {
  switch (verdict) {
    case "clear":
      return "Clear";
    case "changed":
      return "Changed";
    case "attention":
      return "Needs review";
    case "pending":
      return "Pending";
    case "inconclusive":
      return "Inconclusive";
  }
}

export function dayCellLabel(cell: ScheduleDayCell): string {
  const dayText = formatPacificDate(cell.date);
  const runs = cell.runCount === 1 ? "1 run" : `${String(cell.runCount)} runs`;
  switch (cell.state) {
    case "none":
      return `${dayText}: No runs`;
    case "clear":
      return `${dayText}: Clear (${runs})`;
    case "quiet-clear":
      return `${dayText}: Quiet in Hub, clear (${runs})`;
    case "changed":
      return `${dayText}: ${cell.prUrl === undefined ? "Changed" : "PR opened"} (${runs})`;
    case "attention":
      return `${dayText}: Needs review (${runs})`;
    case "failed":
      return `${dayText}: Failed (${runs})`;
  }
}

export function prActionLabel(autoMergeEnabled?: boolean): string {
  return autoMergeEnabled === true ? "Auto-merge PR" : "Review PR";
}

export function nextRovingTabIndex(
  key: string,
  index: number,
  total: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % total;
    case "ArrowLeft":
      return (index - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
