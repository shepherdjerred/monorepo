import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import {
  OPS_MAILBOXES,
  type MailboxPair,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import { ReportRunIngestBatchSchema } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import {
  RECURRING_REPORT_SCHEDULES,
  TEMPORAL_REPORT_SCHEDULES,
} from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";

import type { DigestService } from "#application/ops-digest-service";
import {
  buildFallbackArchivedDigestReport,
  buildFeedCandidates,
  digestSubjectFallback,
  digestToLatestRunSummary,
  incidentStatusOf,
  toLatestRunSummary,
  toReportRunSibling,
} from "#application/reports/report-mappers";
import type {
  ReportFeedCursor,
  ReportRepository,
} from "#application/reports/report-ports";
import { renderDigestEmail } from "#domain/ops-digest-email";
import { digestPeriodKey } from "#domain/ops-period";
import { renderReportEnvelopeEmail } from "#domain/reports/report-email";
import {
  buildPacificDayWindow,
  buildScheduleDays,
  computeScheduleFreshness,
  digestRunToDeliveryStatus,
  digestRunToVerdict,
  filterAndSortFeedItems,
  needsOperatorReview,
  pacificWindowStartNs,
  type DayRunObservation,
} from "#domain/reports/report-overview";
import { JsonTextSchema } from "#shared/json-text";
import {
  DigestRunDetailSchema,
  IncidentMailDetailSchema,
  ReportRunDetailSchema,
  ReportRunIngestResponseSchema,
  ReportsFeedQuerySchema,
  ReportsFeedResponseSchema,
  ReportsOverviewResponseSchema,
  type DigestRunDetail,
  type IncidentMailDetail,
  type ReportRunDetail,
  type ReportRunIngestResponse,
  type ReportsFeedQueryInput,
  type ReportsFeedResponse,
  type ReportsOverviewResponse,
  type ScheduleOverviewItem,
} from "#shared/reports-schema";
import { epochNanosecondsToInstantText, type Clock } from "#shared/time";

export type ReportServiceOptions = {
  repository: ReportRepository;
  digests: DigestService;
  clock: Clock;
  digestMailbox?: MailboxPair;
  incidentMailbox?: MailboxPair;
};

export class ReportService {
  readonly #repository: ReportRepository;
  readonly #digests: DigestService;
  readonly #clock: Clock;
  readonly #digestMailbox: MailboxPair;
  readonly #incidentMailbox: MailboxPair;

  constructor(options: ReportServiceOptions) {
    this.#repository = options.repository;
    this.#digests = options.digests;
    this.#clock = options.clock;
    this.#digestMailbox = options.digestMailbox ?? OPS_MAILBOXES.digests;
    this.#incidentMailbox = options.incidentMailbox ?? OPS_MAILBOXES.alerts;
  }

  async ingest(rawJson: string): Promise<ReportRunIngestResponse> {
    const batch = ReportRunIngestBatchSchema.parse(
      JsonTextSchema.parse(rawJson),
    );
    const result = await this.#repository.upsertReportRuns(
      batch.items,
      this.#clock.now().epochNanoseconds,
    );
    return ReportRunIngestResponseSchema.parse(result);
  }

  async overview(): Promise<ReportsOverviewResponse> {
    const now = this.#clock.now();
    const nowNs = now.epochNanoseconds;
    const windowStartNs = pacificWindowStartNs(now);
    const sevenDaysAgoNs = now.subtract({ hours: 7 * 24 }).epochNanoseconds;
    const pacificDates = buildPacificDayWindow(now);

    const [
      latestTemporalBySchedule,
      latestDigests,
      windowReportRuns,
      windowDigestRuns,
      outboxCounts,
    ] = await Promise.all([
      this.#repository.listLatestRunsPerSchedule(
        TEMPORAL_REPORT_SCHEDULES.map((schedule) => schedule.scheduleId),
      ),
      this.#repository.listLatestDigestsByKind(),
      this.#repository.listReportRuns({ sinceCompletedAtNs: windowStartNs }),
      this.#repository.listDigestRuns({ sinceCreatedAtNs: windowStartNs }),
      this.#repository.incidentOutboxCounts(),
    ]);

    const temporalRunsBySchedule = new Map<string, DayRunObservation[]>();
    for (const run of windowReportRuns) {
      if (run.scheduleId === null) continue;
      const bucket = temporalRunsBySchedule.get(run.scheduleId);
      const entry: DayRunObservation = {
        completedAtNs: run.completedAtNs,
        verdict: run.verdict,
        deliveryStatus: run.deliveryStatus,
        execution: run.execution,
        prUrl: run.prUrl,
      };
      if (bucket === undefined) {
        temporalRunsBySchedule.set(run.scheduleId, [entry]);
      } else {
        bucket.push(entry);
      }
    }

    const digestRunsByKind: Record<DigestKind, DayRunObservation[]> = {
      daily: [],
      weekly: [],
    };
    for (const digest of windowDigestRuns) {
      if (digest.status === "sending") continue;
      digestRunsByKind[digest.kind].push({
        completedAtNs: digest.sentAtNs ?? digest.createdAtNs,
        verdict: digestRunToVerdict(digest),
        deliveryStatus: digestRunToDeliveryStatus(digest.status),
      });
    }

    const schedules: ScheduleOverviewItem[] = RECURRING_REPORT_SCHEDULES.map(
      (schedule): ScheduleOverviewItem => {
        if (schedule.streamKind === "temporal-report") {
          const latest =
            latestTemporalBySchedule.get(schedule.scheduleId) ?? null;
          return {
            ...schedule,
            freshness: computeScheduleFreshness(
              schedule,
              latest?.completedAtNs ?? null,
              nowNs,
            ),
            latestRun: latest === null ? null : toLatestRunSummary(latest),
            days: buildScheduleDays(
              pacificDates,
              temporalRunsBySchedule.get(schedule.scheduleId) ?? [],
            ),
          };
        }
        const kind: DigestKind =
          schedule.scheduleId === "ops-digest-daily" ? "daily" : "weekly";
        const latest = latestDigests[kind];
        const latestCompletedAtNs =
          latest === null ? null : (latest.sentAtNs ?? latest.createdAtNs);
        return {
          ...schedule,
          freshness: computeScheduleFreshness(
            schedule,
            latestCompletedAtNs,
            nowNs,
          ),
          latestRun: latest === null ? null : digestToLatestRunSummary(latest),
          days: buildScheduleDays(pacificDates, digestRunsByKind[kind]),
        };
      },
    );

    const scheduleReviewCount = schedules.filter(
      (schedule) =>
        schedule.latestRun !== null && needsOperatorReview(schedule.latestRun),
    ).length;
    const recentAgentTaskReviewCount = windowReportRuns.filter(
      (run) =>
        run.reportType === "agent-task" &&
        run.completedAtNs >= sevenDaysAgoNs &&
        needsOperatorReview(run),
    ).length;
    const autoPrCount7d = windowReportRuns.filter(
      (run) => run.completedAtNs >= sevenDaysAgoNs && run.prUrl !== null,
    ).length;
    const quietSkips7d =
      windowReportRuns.filter(
        (run) =>
          run.completedAtNs >= sevenDaysAgoNs &&
          run.deliveryStatus === "skipped",
      ).length +
      windowDigestRuns.filter(
        (digest) =>
          (digest.sentAtNs ?? digest.createdAtNs) >= sevenDaysAgoNs &&
          digest.status === "skipped",
      ).length;

    return ReportsOverviewResponseSchema.parse({
      kpis: {
        needsReviewCount: scheduleReviewCount + recentAgentTaskReviewCount,
        autoPrCount7d,
        quietSkips7d,
        freshSchedules: schedules.filter((s) => s.freshness === "fresh").length,
        totalSchedules: schedules.length,
        pendingIncidentEmails: outboxCounts.pending,
        failedIncidentEmails: outboxCounts.failed,
      },
      schedules,
    });
  }

  async feed(rawQuery: ReportsFeedQueryInput): Promise<ReportsFeedResponse> {
    const query = ReportsFeedQuerySchema.parse(rawQuery);
    const pageSize = Math.max(query.limit, 100);
    const isDigestScheduleFilter =
      query.scheduleId === "ops-digest-daily" ||
      query.scheduleId === "ops-digest-weekly";
    const temporalDeliveryFilter =
      query.delivery === "canceled" ? undefined : query.delivery;
    const includeTemporal =
      (query.tab === "all" ||
        query.tab === "reports" ||
        query.tab === "agent-tasks") &&
      !isDigestScheduleFilter &&
      query.delivery !== "canceled";
    const includeDigests =
      (query.tab === "all" || query.tab === "digests") &&
      query.hasPr !== "1" &&
      query.delivery !== "canceled" &&
      (query.scheduleId === undefined || isDigestScheduleFilter);
    const includeIncidents =
      (query.tab === "all" || query.tab === "incidents") &&
      query.hasPr !== "1" &&
      query.scheduleId === undefined;

    const collectFromSource = async <T>(
      fetchPage: (
        before: ReportFeedCursor | undefined,
      ) => Promise<readonly T[]>,
      cursorOf: (row: T) => ReportFeedCursor,
      toCandidates: (
        rows: readonly T[],
      ) => ReturnType<typeof buildFeedCandidates>,
    ): Promise<ReturnType<typeof buildFeedCandidates>> => {
      const matched: ReturnType<typeof buildFeedCandidates>[number][] = [];
      let before: ReportFeedCursor | undefined;
      for (;;) {
        const page = await fetchPage(before);
        if (page.length === 0) break;
        const candidates = toCandidates(page);
        const byId = new Map(candidates.map((item) => [item.id, item]));
        for (const accepted of filterAndSortFeedItems(candidates, {
          ...query,
          limit: page.length,
        })) {
          const full = byId.get(accepted.id);
          if (full !== undefined) {
            matched.push(full);
          }
        }
        if (matched.length >= query.limit || page.length < pageSize) {
          break;
        }
        const last = page.at(-1);
        if (last === undefined) break;
        before = cursorOf(last);
      }
      return matched;
    };

    const digestKindFilter: DigestKind | undefined =
      query.scheduleId === "ops-digest-daily"
        ? "daily"
        : query.scheduleId === "ops-digest-weekly"
          ? "weekly"
          : undefined;

    const [reportMatches, digestMatches, incidentMatches] = await Promise.all([
      includeTemporal
        ? collectFromSource(
            (before) =>
              this.#repository.listReportRuns({
                ...(query.scheduleId === undefined
                  ? {}
                  : { scheduleId: query.scheduleId }),
                ...(query.tab === "agent-tasks"
                  ? { reportType: "agent-task" }
                  : query.tab === "reports"
                    ? { excludeReportType: "agent-task" }
                    : {}),
                ...(query.verdict === undefined
                  ? {}
                  : { verdict: query.verdict }),
                ...(temporalDeliveryFilter === undefined
                  ? {}
                  : { deliveryStatus: temporalDeliveryFilter }),
                ...(query.hasPr === "1" ? { hasPr: true } : {}),
                ...(before === undefined ? {} : { before }),
                limit: pageSize,
              }),
            (row) => ({ timestampNs: row.completedAtNs, id: row.id }),
            (reportRuns) =>
              buildFeedCandidates({
                reportRuns,
                digestRuns: [],
                incidentMails: [],
                digestMailbox: this.#digestMailbox,
                incidentMailbox: this.#incidentMailbox,
              }),
          )
        : Promise.resolve([]),
      includeDigests
        ? collectFromSource(
            (before) =>
              this.#repository.listDigestRuns({
                ...(digestKindFilter === undefined
                  ? {}
                  : { kind: digestKindFilter }),
                ...(before === undefined ? {} : { before }),
                limit: pageSize,
              }),
            (row) => ({ timestampNs: row.createdAtNs, id: row.id }),
            (digestRuns) =>
              buildFeedCandidates({
                reportRuns: [],
                digestRuns,
                incidentMails: [],
                digestMailbox: this.#digestMailbox,
                incidentMailbox: this.#incidentMailbox,
              }),
          )
        : Promise.resolve([]),
      includeIncidents
        ? collectFromSource(
            (before) =>
              this.#repository.listIncidentMails({
                limit: pageSize,
                ...(before === undefined ? {} : { before }),
              }),
            (row) => ({ timestampNs: row.createdAtNs, id: row.id }),
            (incidentMails) =>
              buildFeedCandidates({
                reportRuns: [],
                digestRuns: [],
                incidentMails,
                digestMailbox: this.#digestMailbox,
                incidentMailbox: this.#incidentMailbox,
              }),
          )
        : Promise.resolve([]),
    ]);

    return ReportsFeedResponseSchema.parse({
      items: filterAndSortFeedItems(
        [...reportMatches, ...digestMatches, ...incidentMatches],
        query,
      ),
    });
  }

  async runDetail(id: string): Promise<ReportRunDetail | null> {
    const row = await this.#repository.getReportRun(id);
    if (row === null) return null;
    const rendered = renderReportEnvelopeEmail(row.envelope, row.eyebrow);
    const recentRows =
      row.scheduleId === null
        ? []
        : await this.#repository.listRecentScheduleRuns(row.scheduleId, 14);
    return ReportRunDetailSchema.parse({
      id: row.id,
      report: row.envelope,
      subject: row.subject,
      eyebrow: row.eyebrow,
      mailboxFrom: row.mailboxFrom,
      mailboxTo: row.mailboxTo,
      deliveryStatus: row.deliveryStatus,
      ...(row.skipReason === null ? {} : { skipReason: row.skipReason }),
      messageId: row.messageId,
      acceptedAt:
        row.acceptedAtNs === null
          ? null
          : epochNanosecondsToInstantText(row.acceptedAtNs),
      receivedAt: epochNanosecondsToInstantText(row.receivedAtNs),
      htmlBody: row.htmlBody ?? rendered.htmlBody,
      plainBody: rendered.plainBody,
      recentRuns: recentRows.map((entry) => toReportRunSibling(entry)),
    });
  }

  async digestDetail(
    kind: DigestKind,
    periodKey: string,
  ): Promise<DigestRunDetail | null> {
    const stored = await this.#repository.getDigestRun(kind, periodKey);
    const now = this.#clock.now();
    const currentKey = digestPeriodKey(kind, now);

    if (stored === null) {
      if (periodKey !== currentKey) return null;
      const report = await this.#digests.report(kind);
      const email = renderDigestEmail(report);
      return DigestRunDetailSchema.parse({
        kind,
        periodKey,
        status: "live-preview",
        createdAt: epochNanosecondsToInstantText(now.epochNanoseconds),
        sentAt: null,
        subject: email.subject,
        mailboxFrom: this.#digestMailbox.from,
        mailboxTo: this.#digestMailbox.to,
        report,
        htmlBody: email.htmlBody,
        plainBody: email.plainBody,
      });
    }

    const report =
      stored.reportPayload ??
      (periodKey === currentKey
        ? await this.#digests.report(kind)
        : buildFallbackArchivedDigestReport(stored));
    const rendered =
      stored.htmlBody !== null &&
      stored.plainBody !== null &&
      stored.subject !== null
        ? null
        : renderDigestEmail(report);
    const status = stored.status === "sending" ? "live-preview" : stored.status;

    return DigestRunDetailSchema.parse({
      kind,
      periodKey: stored.periodKey,
      status,
      ...(stored.skipReason === null ? {} : { skipReason: stored.skipReason }),
      createdAt: epochNanosecondsToInstantText(stored.createdAtNs),
      sentAt:
        stored.sentAtNs === null
          ? null
          : epochNanosecondsToInstantText(stored.sentAtNs),
      subject:
        stored.subject ?? rendered?.subject ?? digestSubjectFallback(stored),
      mailboxFrom: this.#digestMailbox.from,
      mailboxTo: this.#digestMailbox.to,
      report,
      htmlBody: stored.htmlBody ?? rendered?.htmlBody ?? "<p>Digest</p>",
      plainBody: stored.plainBody ?? rendered?.plainBody ?? "Digest\n",
    });
  }

  async incidentDetail(id: string): Promise<IncidentMailDetail | null> {
    const found = await this.#repository.getIncidentMail(id);
    if (found === null) return null;
    const { mail, occurrences } = found;
    return IncidentMailDetailSchema.parse({
      id: mail.id,
      messageId: mail.messageId,
      subject: mail.subject,
      mailboxFrom: this.#incidentMailbox.from,
      mailboxTo: this.#incidentMailbox.to,
      status: incidentStatusOf(mail),
      createdAt: epochNanosecondsToInstantText(mail.createdAtNs),
      sentAt:
        mail.sentAtNs === null
          ? null
          : epochNanosecondsToInstantText(mail.sentAtNs),
      canceledAt:
        mail.canceledAtNs === null
          ? null
          : epochNanosecondsToInstantText(mail.canceledAtNs),
      canceledBy: mail.canceledBy,
      cancellationReason: mail.cancellationReason,
      attemptCount: mail.attemptCount,
      lastError: mail.lastError,
      htmlBody: mail.htmlBody,
      plainBody: mail.plainBody,
      occurrences,
    });
  }
}
