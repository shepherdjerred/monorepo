import { StatusGlyph } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import type {
  ReportsFeedQueryInput,
  ReportsKpis,
} from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import { reportsFeedQuery, reportsOverviewQuery } from "./reports-api.ts";
import { ReportsFeedSection } from "./reports-feed-section.tsx";
import { parseReportsFeedParams } from "./reports-format.ts";
import { ScheduleMatrix } from "./schedule-matrix.tsx";

export function buildReportsKpis(kpis: ReportsKpis): readonly {
  readonly label: string;
  readonly val: string;
  readonly hint: string;
  readonly sev: Severity;
}[] {
  const allFresh =
    kpis.totalSchedules > 0 && kpis.freshSchedules === kpis.totalSchedules;
  const outboxSev: Severity =
    kpis.failedIncidentEmails > 0
      ? "error"
      : kpis.pendingIncidentEmails > 0
        ? "warning"
        : "ok";
  return [
    {
      label: "Needs review",
      val: String(kpis.needsReviewCount),
      hint:
        kpis.needsReviewCount === 0
          ? "Zero schedules or tasks awaiting sign-off"
          : "Attention verdicts, review PRs, or failed mail",
      sev: kpis.needsReviewCount > 0 ? "warning" : "ok",
    },
    {
      label: "Automated PRs (7d)",
      val: String(kpis.autoPrCount7d),
      hint: "LLM & deterministic PRs opened",
      sev: kpis.autoPrCount7d > 0 ? "info" : "ok",
    },
    {
      label: "Quiet heartbeats (7d)",
      val: String(kpis.quietSkips7d),
      hint: "Unchanged clear daily emails absorbed by Hub",
      sev: "ok",
    },
    {
      label: "Schedule freshness",
      val: `${String(kpis.freshSchedules)} / ${String(kpis.totalSchedules)}`,
      hint: allFresh
        ? "All recurring streams within cadence + grace"
        : `${String(Math.max(0, kpis.totalSchedules - kpis.freshSchedules))} stream stale or awaiting first run`,
      sev: allFresh ? "ok" : "warning",
    },
    {
      label: "Incident outbox",
      val: String(kpis.pendingIncidentEmails + kpis.failedIncidentEmails),
      hint: `${String(kpis.pendingIncidentEmails)} pending · ${String(kpis.failedIncidentEmails)} failed`,
      sev: outboxSev,
    },
  ];
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined || value.length === 0) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

export type EngKpiStripItem = {
  readonly label: string;
  readonly val: string;
  readonly hint: string;
  readonly sev: Severity;
};

export function EngKpiStrip({
  className,
  items,
}: {
  readonly className?: string | undefined;
  readonly items: readonly EngKpiStripItem[];
}): React.JSX.Element {
  return (
    <div
      className={`eng-kpi-grid${className === undefined ? "" : ` ${className}`}`}
    >
      {items.map((kpi) => (
        <div key={kpi.label} className="eng-kpi-card" data-sev={kpi.sev}>
          <div className="eng-kpi-top">
            <span className="eng-kpi-label">{kpi.label}</span>
            {kpi.sev === "ok" || kpi.sev === "info" ? null : (
              <StatusGlyph severity={kpi.sev} />
            )}
          </div>
          <strong className="eng-kpi-value">{kpi.val}</strong>
          <span className="eng-kpi-hint">{kpi.hint}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const feedQuery = useMemo(() => parseReportsFeedParams(params), [params]);

  const overview = Loaded.fromQuery(useQuery(reportsOverviewQuery()));
  const feed = Loaded.fromQuery(useQuery(reportsFeedQuery(feedQuery)));

  const updateQuery = useCallback(
    (patch: Partial<ReportsFeedQueryInput>) => {
      const next = new URLSearchParams(params);
      if ("tab" in patch) {
        setOrDelete(next, "tab", patch.tab === "all" ? undefined : patch.tab);
      }
      if ("scheduleId" in patch) {
        setOrDelete(next, "scheduleId", patch.scheduleId);
      }
      if ("mailbox" in patch) {
        setOrDelete(next, "mailbox", patch.mailbox);
      }
      if ("verdict" in patch) {
        setOrDelete(next, "verdict", patch.verdict);
      }
      if ("delivery" in patch) {
        setOrDelete(next, "delivery", patch.delivery);
      }
      if ("hasPr" in patch) {
        setOrDelete(next, "hasPr", patch.hasPr);
      }
      if ("q" in patch) {
        setOrDelete(next, "q", patch.q);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const resetFilters = useCallback(() => {
    const next = new URLSearchParams();
    const currentTab = params.get("tab");
    if (currentTab !== null && currentTab !== "all") {
      next.set("tab", currentTab);
    }
    setParams(next, { replace: true });
  }, [params, setParams]);

  return (
    <main className="eng-page rep-page">
      <title>Reports · Hub</title>
      <PageHeading
        meta="Scheduled reports, digests &amp; outbound mail"
        title="Reports"
      />
      <LoadingBlock
        values={{ overview }}
        fallback={<div className="loading-state">Loading reports…</div>}
        renderError={() => (
          <div className="error-state">
            Reports and outbound mail history are unavailable.
          </div>
        )}
      >
        {({ overview: overviewData }, meta) => {
          const kpis = buildReportsKpis(overviewData.kpis);
          return (
            <>
              <StaleNotice errors={meta.errors} />
              <EngKpiStrip className="rep-kpi-grid" items={kpis} />

              <ScheduleMatrix
                schedules={overviewData.schedules}
                selectedMailbox={feedQuery.mailbox}
                selectedScheduleId={feedQuery.scheduleId}
                onSelectMailbox={(mailbox) => {
                  updateQuery({ mailbox });
                }}
                onToggleSchedule={(scheduleId) => {
                  updateQuery({
                    scheduleId:
                      feedQuery.scheduleId === scheduleId
                        ? undefined
                        : scheduleId,
                  });
                }}
              />

              <ReportsFeedSection
                feed={feed}
                searchInput={params.get("q") ?? ""}
                query={feedQuery}
                onUpdateQuery={updateQuery}
                onResetFilters={resetFilters}
              />
            </>
          );
        }}
      </LoadingBlock>
    </main>
  );
}
