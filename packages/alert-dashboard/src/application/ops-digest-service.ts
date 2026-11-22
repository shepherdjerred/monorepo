import {
  allSignals,
  attentionSignals,
  needsMeSignals,
  newSignals,
  type FreshSnapshot,
} from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { Signal, Snapshot } from "@shepherdjerred/ops-model/snapshot.ts";
import { Temporal } from "@js-temporal/polyfill";
import {
  DigestRunResponseSchema,
  type DigestKind,
  type DigestRunResponse,
} from "@shepherdjerred/ops-model/digest.ts";

import type {
  CompletedDailyDigestSummary,
  DigestRunKey,
  OpsRepository,
  PostalPort,
  SeriesPort,
} from "#application/ports";
import {
  DigestInProgressError,
  DigestMailerUnconfiguredError,
  DigestSendError,
  UpstreamUnavailableError,
} from "#application/ops-errors";
import type { OpsService } from "#application/ops-service";
import { renderDigestEmail } from "#domain/ops-digest-email";
import {
  digestMessageId,
  digestPeriod,
  type DigestPeriod,
} from "#domain/ops-period";
import { REVIEW_QUERIES } from "#domain/ops-series";
import {
  DigestReportSchema,
  type DigestReport,
  type IncidentStats,
  type Trend,
} from "#shared/ops-schema";
import type { Clock } from "#shared/time";

/** A claimed send older than this is presumed abandoned and reclaimable. */
const CLAIM_LEASE = Temporal.Duration.from({ minutes: 5 });
const DIGEST_CHANGE_LIMIT = 200;
const WEEK = Temporal.Duration.from({ hours: 7 * 24 });

export type DigestServiceOptions = {
  repository: OpsRepository;
  ops: OpsService;
  series: SeriesPort;
  /** `null` when Postal is not configured for this process. */
  mailer: PostalPort | null;
  clock: Clock;
  dailyDigestQuietClear?: boolean;
};

function metricValue(snapshot: Snapshot | null, id: string): number | null {
  if (snapshot === null) return null;
  for (const section of snapshot.sections) {
    const metric = section.metrics.find((entry) => entry.id === id);
    if (metric !== undefined) return metric.value;
  }
  return null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return null;
  return lower === undefined || sorted.length % 2 === 1
    ? upper
    : (lower + upper) / 2;
}

function signalsSince(
  signals: readonly Signal[],
  start: Temporal.Instant,
): Signal[] {
  return signals.filter(
    (signal) =>
      signal.since !== undefined &&
      Temporal.Instant.compare(Temporal.Instant.from(signal.since), start) >= 0,
  );
}

function isQuietClearDigestReport(report: DigestReport): boolean {
  return (
    report.status.severity === "ok" &&
    !report.status.stale &&
    report.needsMe.length === 0 &&
    report.attention.length === 0 &&
    report.newSinceLast.length === 0 &&
    report.incidents.opened === 0
  );
}

function isPreviousDailyDigestClear(
  previous: CompletedDailyDigestSummary | null,
): boolean {
  return (
    previous !== null &&
    previous.severity === "ok" &&
    (previous.needsMeCount ?? 0) === 0 &&
    (previous.attentionCount ?? 0) === 0
  );
}

export class DigestService {
  readonly #repository: OpsRepository;
  readonly #ops: OpsService;
  readonly #series: SeriesPort;
  readonly #mailer: PostalPort | null;
  readonly #clock: Clock;
  readonly #dailyDigestQuietClear: boolean;

  constructor(options: DigestServiceOptions) {
    this.#repository = options.repository;
    this.#ops = options.ops;
    this.#series = options.series;
    this.#mailer = options.mailer;
    this.#clock = options.clock;
    this.#dailyDigestQuietClear = options.dailyDigestQuietClear ?? true;
  }

  /** The report a digest sent now would contain, without sending it. */
  report(kind: DigestKind): Promise<DigestReport> {
    return this.#report(digestPeriod(kind, this.#clock.now()));
  }

  /**
   * Send the digest for the current period at most once. Periods recorded as
   * skipped while sending was gated or unchanged-clear stay skipped.
   */
  async run(kind: DigestKind): Promise<DigestRunResponse> {
    const now = this.#clock.now();
    const period = digestPeriod(kind, now);
    const key: DigestRunKey = {
      kind,
      periodKey: period.key,
      messageId: digestMessageId(kind, period.key),
    };
    const response = (status: "sent" | "skipped", duplicate: boolean) =>
      DigestRunResponseSchema.parse({
        kind,
        periodKey: period.key,
        status,
        duplicate,
      });

    const mailer = this.#mailer;
    if (mailer === null) throw new DigestMailerUnconfiguredError();

    const claim = await this.#repository.claimDigestRun(
      key,
      now.epochNanoseconds,
      now.subtract(CLAIM_LEASE).epochNanoseconds,
    );
    if (claim.outcome === "done") return response(claim.status, true);
    if (claim.outcome === "busy") throw new DigestInProgressError(key);

    try {
      const status = await this.#deliverOrSkipClaimedRun(
        kind,
        period,
        key,
        mailer,
      );
      return response(status, false);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.#repository.markDigestFailed(key, reason);
      throw new DigestSendError(key, reason);
    }
  }

  async #deliverOrSkipClaimedRun(
    kind: DigestKind,
    period: DigestPeriod,
    key: DigestRunKey,
    mailer: PostalPort,
  ): Promise<"sent" | "skipped"> {
    const latest = await this.#ops.freshSnapshot();
    const report = await this.#report(period, latest?.fresh ?? null);
    const email = renderDigestEmail(report);
    const archive = {
      subject: email.subject,
      severity: report.status.severity,
      summary: report.status.summary,
      needsMeCount: report.needsMe.length,
      attentionCount: report.attention.length,
      reportPayload: report,
      htmlBody: email.htmlBody,
      plainBody: email.plainBody,
    };

    if (await this.#shouldSkipQuietClear(kind, period.key, report)) {
      const completedAt = this.#clock.now();
      await this.#repository.markDigestSkipped(key, {
        ...archive,
        skipReason: "unchanged-clear",
      });
      await this.#advanceDailyCursor(
        latest?.stored.snapshot ?? null,
        completedAt,
      );
      return "skipped";
    }

    await mailer.send({
      messageId: key.messageId,
      subject: email.subject,
      htmlBody: email.htmlBody,
      plainBody: email.plainBody,
      tag: `ops-digest-${kind}`,
    });
    const sentAt = this.#clock.now();
    await this.#repository.markDigestSent(key, {
      sentAtNs: sentAt.epochNanoseconds,
      ...archive,
    });
    if (kind === "daily") {
      await this.#advanceDailyCursor(latest?.stored.snapshot ?? null, sentAt);
    }
    return "sent";
  }

  async #shouldSkipQuietClear(
    kind: DigestKind,
    periodKey: string,
    report: DigestReport,
  ): Promise<boolean> {
    if (kind !== "daily" || !this.#dailyDigestQuietClear) return false;
    if (!isQuietClearDigestReport(report)) return false;
    const previous =
      await this.#repository.previousCompletedDailyDigest(periodKey);
    return isPreviousDailyDigestClear(previous);
  }

  async #advanceDailyCursor(
    snapshot: Snapshot | null,
    at: Temporal.Instant,
  ): Promise<void> {
    if (snapshot === null) return;
    await this.#repository.putCursor({
      consumer: "digest",
      lastSeenAtNs: at.epochNanoseconds,
      seenSignalIds: allSignals(snapshot).map((signal) => signal.id),
    });
  }

  async #report(
    period: DigestPeriod,
    knownFresh?: FreshSnapshot | null,
  ): Promise<DigestReport> {
    const latest =
      knownFresh === undefined ? await this.#ops.freshSnapshot() : undefined;
    const fresh = knownFresh ?? latest?.fresh ?? null;
    const sinceNs = period.start.epochNanoseconds;
    const untilNs = period.end.epochNanoseconds;
    const [newSinceLast, changes, incidents, trends] = await Promise.all([
      this.#newSinceLast(period, fresh),
      this.#ops.changesBetween({
        sinceNs,
        untilNs,
        limit: DIGEST_CHANGE_LIMIT,
      }),
      this.#incidents(sinceNs, untilNs),
      period.kind === "weekly"
        ? this.#weeklyTrends(period, fresh)
        : Promise.resolve([]),
    ]);
    return DigestReportSchema.parse({
      kind: period.kind,
      periodKey: period.key,
      periodStart: period.start.toString(),
      periodEnd: period.end.toString(),
      status:
        fresh === null
          ? {
              severity: "unknown",
              summary: "No ops snapshot has been ingested yet",
              stale: true,
              snapshotGeneratedAt: null,
            }
          : {
              severity: fresh.severity,
              summary: fresh.summary,
              stale: fresh.stale,
              snapshotGeneratedAt: Temporal.Instant.from(
                fresh.generatedAt,
              ).toString(),
            },
      attention: fresh === null ? [] : attentionSignals(fresh),
      needsMe: fresh === null ? [] : needsMeSignals(fresh),
      newSinceLast,
      changes,
      incidents,
      trends,
    });
  }

  /** New signals worth reading: a newly healthy check is not news. */
  async #newSinceLast(
    period: DigestPeriod,
    fresh: FreshSnapshot | null,
  ): Promise<Signal[]> {
    const signals = await this.#newSignals(period, fresh);
    return signals.filter((signal) => signal.severity !== "ok");
  }

  async #newSignals(
    period: DigestPeriod,
    fresh: FreshSnapshot | null,
  ): Promise<Signal[]> {
    if (fresh === null) return [];
    if (period.kind === "weekly")
      return signalsSince(allSignals(fresh), period.start);
    const cursor = await this.#repository.getCursor("digest");
    return newSignals(fresh, new Set(cursor?.seenSignalIds));
  }

  async #incidents(sinceNs: bigint, untilNs: bigint): Promise<IncidentStats> {
    const stats = await this.#repository.incidentStats({ sinceNs, untilNs });
    const minutes = stats.resolveDurationsNs.map(
      (duration) => Number(duration / 1_000_000n) / 60_000,
    );
    return {
      opened: stats.opened,
      resolved: stats.resolveDurationsNs.length,
      medianMinutesToResolve: median(minutes),
    };
  }

  async #scalar(promql: string): Promise<number | null> {
    try {
      return await this.#series.scalar(promql);
    } catch (error) {
      // A review with one unavailable trend is still worth sending; the
      // trend renders as "no data" rather than blocking the digest.
      if (error instanceof UpstreamUnavailableError) return null;
      throw error;
    }
  }

  async #weeklyTrends(
    period: DigestPeriod,
    fresh: FreshSnapshot | null,
  ): Promise<Trend[]> {
    const previousEnd = period.start;
    const previousStart = previousEnd.subtract(WEEK);
    const [
      previous,
      aiSpend,
      aiSpendPrevious,
      llmSpend,
      llmSpendPrevious,
      deploys,
      deploysPrevious,
      incidentsPrevious,
      incidents,
    ] = await Promise.all([
      this.#repository.snapshotAtOrBefore(previousEnd.epochNanoseconds),
      this.#scalar(REVIEW_QUERIES.aiSpend7d),
      this.#scalar(REVIEW_QUERIES.aiSpendPrevious7d),
      this.#scalar(REVIEW_QUERIES.llmSpend7d),
      this.#scalar(REVIEW_QUERIES.llmSpendPrevious7d),
      this.#repository.countChanges({
        kind: "deploy",
        sinceNs: period.start.epochNanoseconds,
        untilNs: period.end.epochNanoseconds,
      }),
      this.#repository.countChanges({
        kind: "deploy",
        sinceNs: previousStart.epochNanoseconds,
        untilNs: previousEnd.epochNanoseconds,
      }),
      this.#repository.incidentStats({
        sinceNs: previousStart.epochNanoseconds,
        untilNs: previousEnd.epochNanoseconds,
      }),
      this.#repository.incidentStats({
        sinceNs: period.start.epochNanoseconds,
        untilNs: period.end.epochNanoseconds,
      }),
    ]);
    const current = fresh;
    const prior = previous?.snapshot ?? null;
    const fromSnapshots = (
      id: string,
      label: string,
      unit: Trend["unit"],
      higherIsBetter: boolean,
    ): Trend => ({
      id,
      label,
      unit,
      current: metricValue(current, id),
      previous: metricValue(prior, id),
      higherIsBetter,
    });
    return [
      fromSnapshots(METRIC_IDS.prsMerged7d, "PRs merged", "count", true),
      fromSnapshots(
        METRIC_IDS.prMedianHoursToMerge30d,
        "Median time to merge (30d)",
        "hours",
        false,
      ),
      {
        id: "incidents.opened",
        label: "Incidents opened",
        unit: "count",
        current: incidents.opened,
        previous: incidentsPrevious.opened,
        higherIsBetter: false,
      },
      {
        id: "incidents.resolved",
        label: "Incidents resolved",
        unit: "count",
        current: incidents.resolveDurationsNs.length,
        previous: incidentsPrevious.resolveDurationsNs.length,
        higherIsBetter: true,
      },
      {
        id: "deploys",
        label: "Deploys",
        unit: "count",
        current: deploys,
        previous: deploysPrevious,
        higherIsBetter: true,
      },
      {
        id: "ai.spend.mac_7d",
        label: "AI tool spend (Mac)",
        unit: "usd",
        current: aiSpend,
        previous: aiSpendPrevious,
        higherIsBetter: false,
      },
      {
        id: "ai.spend.cluster_7d",
        label: "Cluster LLM spend",
        unit: "usd",
        current: llmSpend,
        previous: llmSpendPrevious,
        higherIsBetter: false,
      },
      fromSnapshots(
        METRIC_IDS.bugsinkUnresolved,
        "Unresolved Bugsink issues",
        "count",
        false,
      ),
      fromSnapshots(
        METRIC_IDS.renovatePending,
        "Renovate updates pending",
        "count",
        false,
      ),
    ];
  }
}
