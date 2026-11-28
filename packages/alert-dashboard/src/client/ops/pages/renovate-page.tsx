import { StatusGlyph } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type {
  RenovateFacet,
  RenovateItem,
} from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import { TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import { facetQuery, isSnapshotUnavailable } from "#client/ops/ops-api.ts";
import { PageHeading, RangePicker } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import {
  BudgetMeter,
  StackedMeter,
  type StackedMeterSegment,
} from "#client/visuals/index.ts";
import type { SeriesRange } from "#shared/ops-schema";
import "#styles/engineering.css";

import { RenovateQueueTabs } from "./renovate-drawer.tsx";
import { ExtLink, TYPE_COLOR, UPDATE_TYPES } from "./renovate-helpers.tsx";
import { RenovateRanking } from "./renovate-ranking.tsx";

export const RENOVATE_TAB_IDS = [
  "prs",
  "approval",
  "held",
  "hygiene",
  "merged",
] as const;
const RenovateTabSchema = z.enum(RENOVATE_TAB_IDS);
export type RenovateTabId = z.infer<typeof RenovateTabSchema>;

export function parseRenovateTab(raw: string | null): RenovateTabId {
  const parsed = RenovateTabSchema.safeParse(raw);
  return parsed.success ? parsed.data : "prs";
}

export function filterRenovateItemsByTab(
  items: readonly RenovateItem[],
  tab: Exclude<RenovateTabId, "merged">,
): RenovateItem[] {
  switch (tab) {
    case "prs":
      return items.filter((i) => i.prNumber !== undefined);
    case "approval":
      return items.filter((i) => i.state === "awaiting-approval");
    case "held":
      return items.filter(
        (i) =>
          i.state === "pending-checks" ||
          i.state === "rate-limited" ||
          i.state === "awaiting-schedule",
      );
    case "hygiene":
      return items.filter(
        (i) =>
          i.state === "errored" ||
          i.state === "edited-blocked" ||
          i.state === "ignored",
      );
  }
}

function RenovateBanners({
  renovate,
}: {
  readonly renovate: RenovateFacet;
}): React.JSX.Element | null {
  if (renovate.lookupWarnings.length === 0 && !renovate.truncated) {
    return null;
  }
  const issueHref =
    renovate.issueUrl ??
    (renovate.issueNumber === null
      ? `${TOOL_HOSTS.github}/issues`
      : `${TOOL_HOSTS.github}/issues/${String(renovate.issueNumber)}`);
  const warnLabel = `${String(renovate.lookupWarnings.length)} Renovate package lookup warning${renovate.lookupWarnings.length === 1 ? "" : "s"}`;
  return (
    <div className="eng-callouts">
      {renovate.lookupWarnings.length === 0 ? null : (
        <section
          className="eng-callout eng-callout-warning"
          aria-label="Lookup warnings"
        >
          <StatusGlyph severity="warning" />
          <div className="eng-callout-body">
            <p className="eng-callout-title">{warnLabel}</p>
            <ul className="eng-callout-list">
              {renovate.lookupWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {renovate.truncated ? (
        <section className="eng-callout" aria-label="Truncation notice">
          <StatusGlyph severity="info" />
          <div className="eng-callout-body">
            <p className="eng-callout-title">
              Dependency Dashboard issue body is truncated upstream.{" "}
              <ExtLink href={issueHref}>
                {renovate.issueNumber === null
                  ? "View GitHub issues"
                  : `Open Issue #${String(renovate.issueNumber)}`}
              </ExtLink>
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function buildKpis(renovate: RenovateFacet): readonly {
  readonly label: string;
  readonly val: string;
  readonly hint: string;
  readonly sev: Severity;
}[] {
  const awaiting = renovate.counts["awaiting-approval"];
  const ticked = renovate.items.filter(
    (i) => i.state === "awaiting-approval" && i.checked,
  ).length;
  const rateLim = renovate.counts["rate-limited"];
  const sched = renovate.counts["awaiting-schedule"];
  const errored = renovate.counts.errored;
  const blocked = renovate.counts["edited-blocked"];
  const hygiene = errored + blocked + renovate.deprecations.length;
  return [
    {
      label: "Awaiting approval",
      val: String(awaiting),
      hint: `${String(ticked)} checked for PR creation`,
      sev: awaiting > 25 ? "info" : "ok",
    },
    {
      label: "30d soak / checks",
      val: String(renovate.counts["pending-checks"]),
      hint: "Pending CI or stability soak",
      sev: "ok",
    },
    {
      label: "Rate-limited & scheduled",
      val: String(rateLim + sched),
      hint: `${String(rateLim)} rate-limited · ${String(sched)} scheduled`,
      sev: "ok",
    },
    {
      label: "Errored / blocked / deprecated",
      val: String(hygiene),
      hint: `${String(errored)} errored · ${String(blocked)} blocked · ${String(renovate.deprecations.length)} deprecated`,
      sev: errored > 0 ? "error" : hygiene > 0 ? "warning" : "ok",
    },
    {
      label: "Merged (7d / 30d)",
      val: `${String(renovate.merged7dCount)} / ${String(renovate.merged30dCount)}`,
      hint:
        renovate.medianMergeHours === null
          ? "Median merge time —"
          : `Median ${renovate.medianMergeHours.toFixed(1)}h to merge`,
      sev: "ok",
    },
  ];
}

function RenovateBody(p: {
  readonly renovate: RenovateFacet;
  readonly range: SeriesRange;
  readonly onRangeChange: (next: SeriesRange) => void;
}): React.JSX.Element {
  const { renovate, range, onRangeChange } = p;
  const [params, setParams] = useSearchParams();
  const activeTab = parseRenovateTab(params.get("tab"));
  const expandedIds = useMemo(
    () => (params.get("expand") ?? "").split(",").filter((e) => e.length > 0),
    [params],
  );
  const kpis = buildKpis(renovate);
  const ecoSegs: StackedMeterSegment[] = Object.entries(
    renovate.ecosystemCounts,
  )
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: key, value }));
  const typeSegs: StackedMeterSegment[] = UPDATE_TYPES.filter(
    (k) => (renovate.updateTypeCounts[k] ?? 0) > 0,
  ).map((k) => ({
    key: k,
    label: k,
    value: renovate.updateTypeCounts[k] ?? 0,
    color: TYPE_COLOR[k],
  }));
  const tabs: readonly {
    readonly id: RenovateTabId;
    readonly label: string;
    readonly count: number;
  }[] = [
    {
      id: "prs",
      label: "Open PRs",
      count: filterRenovateItemsByTab(renovate.items, "prs").length,
    },
    {
      id: "approval",
      label: "Pending approval",
      count: filterRenovateItemsByTab(renovate.items, "approval").length,
    },
    {
      id: "held",
      label: "Soaking & held",
      count: filterRenovateItemsByTab(renovate.items, "held").length,
    },
    {
      id: "hygiene",
      label: "Hygiene & deprecations",
      count:
        filterRenovateItemsByTab(renovate.items, "hygiene").length +
        renovate.deprecations.length,
    },
    {
      id: "merged",
      label: "Recent merges",
      count: renovate.recentMerged.length,
    },
  ];
  const tabItems = useMemo(
    () =>
      activeTab === "merged"
        ? []
        : filterRenovateItemsByTab(renovate.items, activeTab),
    [activeTab, renovate.items],
  );

  return (
    <>
      <RenovateBanners renovate={renovate} />
      <RenovateRanking ranking={renovate.ranking} />
      <div className="eng-meters-grid">
        <div className="eng-meter-card">
          <BudgetMeter
            label="Open Renovate PRs"
            value={renovate.openPrCount}
            max={Math.max(1, renovate.prConcurrentLimit)}
            unit="count"
            severity={
              renovate.openPrCount > renovate.prConcurrentLimit
                ? "warning"
                : "info"
            }
            detail={`Concurrency limit ${String(renovate.prConcurrentLimit)} open PRs`}
          />
        </div>
        <div className="eng-meter-card">
          <BudgetMeter
            label="LLM delta coverage"
            value={renovate.llmEnrichedCount}
            max={Math.max(1, renovate.items.length, renovate.llmEnrichedCount)}
            unit="count"
            severity={renovate.llmBreakingCount > 0 ? "warning" : "ok"}
            detail={`${String(renovate.llmBreakingCount)} breaking delta${renovate.llmBreakingCount === 1 ? "" : "s"} across ${String(Math.max(renovate.items.length, renovate.llmEnrichedCount))} tracked updates`}
          />
        </div>
      </div>
      <div className="eng-kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="eng-kpi-card" data-sev={k.sev}>
            <div className="eng-kpi-top">
              <span className="eng-kpi-label">{k.label}</span>
              {k.sev === "ok" || k.sev === "info" ? null : (
                <StatusGlyph severity={k.sev} />
              )}
            </div>
            <strong className="eng-kpi-value">{k.val}</strong>
            <span className="eng-kpi-hint">{k.hint}</span>
          </div>
        ))}
      </div>
      <div className="charts-heading">
        <h2 className="block-heading">Backlog & velocity</h2>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>
      <div className="chart-grid">
        <SeriesChart
          preset="renovate-pending"
          range={range}
          mode="stacked-area"
          title="Backlog by state"
          syncKey="renovate"
        />
        <SeriesChart
          preset="renovate-merges-7d"
          range={range}
          mode="bar"
          title="Renovate merges (7d)"
          syncKey="renovate"
        />
        <SeriesChart
          preset="pr-oldest-age"
          range={range}
          title="Oldest open PR age"
          syncKey="renovate"
        />
        <div className="eng-mix-panel">
          <h3>Ecosystem & update-type mix</h3>
          <StackedMeter label="Ecosystem breakdown" segments={ecoSegs} />
          <StackedMeter label="Update-type mix" segments={typeSegs} />
        </div>
      </div>
      <RenovateQueueTabs
        renovate={renovate}
        activeTab={activeTab}
        tabs={tabs}
        tabItems={tabItems}
        expandedIds={expandedIds}
        onSelectTab={(nextTab) => {
          const updated = new URLSearchParams(params);
          updated.set("tab", nextTab);
          setParams(updated, { replace: true });
        }}
      />
    </>
  );
}

export function RenovatePage(): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const facet = Loaded.fromQuery(useQuery(facetQuery("renovate")));
  return (
    <main className="eng-page">
      <title>Renovate · Hub</title>
      <PageHeading title="Renovate" meta="Dependency velocity" />
      <LoadingBlock
        values={{ facet }}
        fallback={<div className="loading-state">Loading Renovate…</div>}
        renderError={(errors) =>
          isSnapshotUnavailable(errors[0].error) ? (
            <div className="empty-state">
              No Renovate facet has been ingested yet.
            </div>
          ) : (
            <div className="error-state">
              Renovate dashboard data is unavailable.
            </div>
          )
        }
      >
        {({ facet: envelope }, meta) => (
          <>
            <StaleNotice errors={meta.errors} />
            {envelope.data === null ? (
              <div className="empty-state">
                No Renovate dependency dashboard snapshot is stored yet.
              </div>
            ) : (
              <RenovateBody
                renovate={envelope.data}
                range={range}
                onRangeChange={setRange}
              />
            )}
          </>
        )}
      </LoadingBlock>
    </main>
  );
}
