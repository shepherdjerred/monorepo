import { Temporal } from "@js-temporal/polyfill";
import { extractEmailAddress } from "@shepherdjerred/ops-model/email/mailbox.ts";
import type {
  ReportExecution,
  ReportVerdict,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type { ReportDeliveryStatus } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import type { RecurringReportSchedule } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";

import { DIGEST_TIME_ZONE } from "#domain/ops-period";
import type {
  ReportFeedItem,
  ReportsFeedQuery,
  ScheduleDayCell,
  ScheduleDayState,
  ScheduleFreshness,
} from "#shared/reports-schema";

export const REPORTS_WINDOW_DAYS = 30;

const DAY_STATE_RANK: Record<ScheduleDayState, number> = {
  none: 0,
  "quiet-clear": 1,
  clear: 2,
  changed: 3,
  attention: 4,
  failed: 5,
};

export type DayRunObservation = {
  completedAtNs: bigint;
  verdict: ReportVerdict;
  deliveryStatus: ReportDeliveryStatus;
  execution?: ReportExecution;
  prUrl?: string | null;
};

/** 30 Pacific calendar dates (`YYYY-MM-DD`), oldest first, ending on `now`. */
export function buildPacificDayWindow(now: Temporal.Instant): string[] {
  const today = now.toZonedDateTimeISO(DIGEST_TIME_ZONE).toPlainDate();
  return Array.from({ length: REPORTS_WINDOW_DAYS }, (_, index) =>
    today.subtract({ days: REPORTS_WINDOW_DAYS - 1 - index }).toString(),
  );
}

/** Start of the oldest day in the 30-day Pacific strip, in epoch nanoseconds. */
export function pacificWindowStartNs(now: Temporal.Instant): bigint {
  const today = now.toZonedDateTimeISO(DIGEST_TIME_ZONE).toPlainDate();
  const oldest = today.subtract({ days: REPORTS_WINDOW_DAYS - 1 });
  return oldest.toZonedDateTime({
    timeZone: DIGEST_TIME_ZONE,
    plainTime: Temporal.PlainTime.from("00:00:00"),
  }).epochNanoseconds;
}

export function pacificDateOfNs(epochNs: bigint): string {
  return Temporal.Instant.fromEpochNanoseconds(epochNs)
    .toZonedDateTimeISO(DIGEST_TIME_ZONE)
    .toPlainDate()
    .toString();
}

export function computeScheduleFreshness(
  schedule: Pick<RecurringReportSchedule, "cadenceHours" | "graceHours">,
  latestCompletedAtNs: bigint | null,
  nowNs: bigint,
): ScheduleFreshness {
  if (latestCompletedAtNs === null) return "empty";
  const budgetMs = Math.round(
    (schedule.cadenceHours + schedule.graceHours) * 3_600_000,
  );
  const budgetNs = BigInt(budgetMs) * 1_000_000n;
  return nowNs - latestCompletedAtNs <= budgetNs ? "fresh" : "stale";
}

export function singleRunDayState(
  run: DayRunObservation,
): Exclude<ScheduleDayState, "none"> {
  if (run.deliveryStatus === "failed" || run.execution === "failed") {
    return "failed";
  }
  if (run.verdict === "attention") {
    return "attention";
  }
  if (
    run.verdict === "changed" ||
    (run.prUrl !== undefined && run.prUrl !== null)
  ) {
    return "changed";
  }
  if (run.verdict === "clear" && run.deliveryStatus === "skipped") {
    return "quiet-clear";
  }
  return run.verdict === "inconclusive" && run.execution === "partial"
    ? "attention"
    : "clear";
}

export function buildScheduleDays(
  dates: readonly string[],
  runs: readonly DayRunObservation[],
): ScheduleDayCell[] {
  const byDate = new Map<string, DayRunObservation[]>();
  for (const run of runs) {
    const date = pacificDateOfNs(run.completedAtNs);
    const bucket = byDate.get(date);
    if (bucket === undefined) {
      byDate.set(date, [run]);
    } else {
      bucket.push(run);
    }
  }

  return dates.map((date): ScheduleDayCell => {
    const bucket = byDate.get(date);
    if (bucket === undefined || bucket.length === 0) {
      return { date, state: "none", runCount: 0 };
    }
    const sorted = bucket.toSorted((left, right) =>
      left.completedAtNs > right.completedAtNs
        ? -1
        : left.completedAtNs < right.completedAtNs
          ? 1
          : 0,
    );
    let state: ScheduleDayState = "none";
    let prUrl: string | undefined;
    for (const run of sorted) {
      const candidate = singleRunDayState(run);
      if (DAY_STATE_RANK[candidate] > DAY_STATE_RANK[state]) {
        state = candidate;
      }
      if (
        prUrl === undefined &&
        run.prUrl !== undefined &&
        run.prUrl !== null
      ) {
        prUrl = run.prUrl;
      }
    }
    return {
      date,
      state,
      runCount: sorted.length,
      ...(prUrl === undefined ? {} : { prUrl }),
    };
  });
}

export function digestRunToVerdict(input: {
  status: "sending" | "sent" | "skipped" | "failed";
  severity: string | null;
  needsMeCount: number | null;
  attentionCount: number | null;
}): ReportVerdict {
  if (input.status === "sending") return "pending";
  if (input.status === "failed") return "inconclusive";
  if (
    (input.needsMeCount ?? 0) > 0 ||
    (input.attentionCount ?? 0) > 0 ||
    input.severity === "error" ||
    input.severity === "warning"
  ) {
    return "attention";
  }
  if (input.severity === "unknown") return "inconclusive";
  return input.severity === "info" ? "changed" : "clear";
}

export function digestRunToDeliveryStatus(
  status: "sending" | "sent" | "skipped" | "failed",
): ReportDeliveryStatus {
  return status === "sending" ? "pending" : status;
}

export function needsOperatorReview(input: {
  execution?: ReportExecution | undefined;
  verdict: ReportVerdict;
  deliveryStatus: ReportDeliveryStatus;
  prUrl?: string | null | undefined;
  autoMergeEnabled?: boolean | null | undefined;
}): boolean {
  if (input.deliveryStatus === "failed") return true;
  if (input.execution !== undefined && input.execution !== "complete") {
    return true;
  }
  if (input.verdict === "attention" || input.verdict === "inconclusive") {
    return true;
  }
  if (
    input.prUrl !== undefined &&
    input.prUrl !== null &&
    input.autoMergeEnabled !== true
  ) {
    return true;
  }
  return false;
}

function matchesTab(
  item: ReportFeedItem,
  tab: ReportsFeedQuery["tab"],
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "reports":
      return item.kind === "temporal-report";
    case "digests":
      return item.kind === "ops-digest";
    case "agent-tasks":
      return item.kind === "agent-task";
    case "incidents":
      return item.kind === "incident-mail";
  }
}

function matchesMailbox(item: ReportFeedItem, mailbox: string): boolean {
  const needle = mailbox.trim().toLowerCase();
  const fromAddress = extractEmailAddress(item.mailboxFrom).toLowerCase();
  return (
    item.mailboxTo.toLowerCase() === needle ||
    item.mailboxFrom.toLowerCase() === needle ||
    fromAddress === needle
  );
}

export function filterAndSortFeedItems(
  items: readonly (ReportFeedItem & { occurredAtNs: bigint })[],
  query: ReportsFeedQuery,
): ReportFeedItem[] {
  const searchNeedle = query.q?.toLowerCase();
  return items
    .filter((item) => {
      if (!matchesTab(item, query.tab)) return false;
      if (
        query.scheduleId !== undefined &&
        item.scheduleId !== query.scheduleId
      )
        return false;
      if (query.mailbox !== undefined && !matchesMailbox(item, query.mailbox))
        return false;
      if (query.verdict !== undefined && item.verdict !== query.verdict)
        return false;
      if (
        query.delivery !== undefined &&
        item.deliveryStatus !== query.delivery
      )
        return false;
      if (query.hasPr === "1" && item.prUrl === undefined) return false;
      if (searchNeedle !== undefined) {
        const haystack = [
          item.id,
          item.title,
          item.subject,
          item.headline,
          item.eyebrow,
          item.scheduleId ?? "",
          item.mailboxFrom,
          item.mailboxTo,
        ];
        if (
          !haystack.some((field) => field.toLowerCase().includes(searchNeedle))
        )
          return false;
      }
      return true;
    })
    .toSorted((left, right) =>
      left.occurredAtNs === right.occurredAtNs
        ? right.id.localeCompare(left.id)
        : left.occurredAtNs > right.occurredAtNs
          ? -1
          : 1,
    )
    .slice(0, query.limit)
    .map(({ occurredAtNs: _occurredAtNs, ...item }) => item);
}
