import { StatusGlyph } from "@shepherdjerred/console-ui";
import { findMetric, findSection } from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Section,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { QuotaPanel } from "./ai-quota-table.tsx";
import { ToolSpendPanel } from "./ai-tool-spend.tsx";
import {
  MetricStrip,
  PageHeading,
  RangePicker,
  WithSnapshot,
} from "./ops-ui.tsx";
import { SignalList } from "./signal-list.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import { formatValue } from "#shared/ops-format";

function SpendPanel({
  section,
}: {
  readonly section: Section;
}): React.JSX.Element {
  const budget = OPS_POLICY.monthlyApiBudgetUsd;
  const spent =
    findMetric(section, METRIC_IDS.aiCostMonthToDateUsd)?.value ?? null;
  const projected =
    findMetric(section, METRIC_IDS.aiCostProjectedUsd)?.value ?? null;
  const overBudget =
    projected !== null &&
    projected > budget * OPS_POLICY.budgetProjectionWarningRatio;
  const severity: Severity =
    spent === null ? "unknown" : overBudget ? "warning" : "ok";
  return (
    <section className="panel spend-panel" aria-labelledby="spend-heading">
      <header className="panel-heading">
        <h2 id="spend-heading">API spend this month</h2>
        <StatusGlyph severity={severity} />
      </header>
      <p className="hero-figure">
        {formatValue(spent, "usd")}
        <span> of {formatValue(budget, "usd")} budget</span>
      </p>
      <div
        className={`meter meter-${severity} spend-meter`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent ?? 0}
        aria-label="Month-to-date spend against budget"
      >
        <span
          style={{
            width: `${String(Math.min((spent ?? 0) / budget, 1) * 100)}%`,
          }}
        />
        {projected === null ? null : (
          <i
            className="projection"
            style={{
              left: `${String(Math.min(projected / budget, 1) * 100)}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="panel-summary">
        Projected month end {formatValue(projected, "usd")}
        {overBudget ? ", over budget" : ", within budget"}. Cluster LLM spend
        for the UTC month, priced from the catalog; subscriptions are fixed.
      </p>
    </section>
  );
}

/** The metrics the spend panel already shows as its figure and projection. */
const SPEND_METRICS: ReadonlySet<string> = new Set([
  METRIC_IDS.aiCostMonthToDateUsd,
  METRIC_IDS.aiCostProjectedUsd,
]);

/**
 * In reading order: the verdict and why, spend beside the other headline
 * numbers, every quota window beside what each tool used, the trends, and
 * last the signals that are neither a quota window nor a tool's usage.
 */
function AiBody({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const [range, setRange] = useRange("30d");
  const section = findSection(snapshot, "ai");
  const quotas = section.signals.filter(
    (signal) => signal.kind === "quota-window",
  );
  const tools = section.signals.filter(
    (signal) => signal.kind === "tool-usage",
  );
  const other = section.signals.filter(
    (signal) => signal.kind !== "quota-window" && signal.kind !== "tool-usage",
  );
  const tiles = section.metrics.filter(
    (metric) => !SPEND_METRICS.has(metric.id),
  );
  return (
    <>
      <PageHeading title="AI usage & spend">
        <div className="page-status">
          <StatusGlyph severity={section.severity} />
          {section.severity === "ok" ? null : <p>{section.summary}</p>}
        </div>
      </PageHeading>
      <div className="ai-row">
        <SpendPanel section={section} />
        {tiles.length === 0 ? null : <MetricStrip metrics={tiles} />}
      </div>
      <div className="ai-row">
        <QuotaPanel signals={quotas} generatedAt={snapshot.generatedAt} />
        <ToolSpendPanel signals={tools} />
      </div>
      <div className="charts-heading">
        <h2 className="block-heading">Usage over time</h2>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="chart-grid">
        <SeriesChart preset="ai-cost-by-source" range={range} syncKey="ai" />
        <SeriesChart preset="ai-tokens-by-tool" range={range} syncKey="ai" />
        <SeriesChart preset="cluster-llm-cost" range={range} syncKey="ai" />
        <SeriesChart preset="ai-quota" range={range} syncKey="ai" />
        <SeriesChart preset="provider-billed-cost" range={range} syncKey="ai" />
        <SeriesChart
          preset="llm-token-cache-mix"
          range={range}
          mode="stacked-area"
          syncKey="ai"
          title="Cluster LLM token & cache mix"
        />
      </div>
      {other.length === 0 ? null : (
        <section
          className="panel list-panel"
          aria-labelledby="ai-signals-heading"
        >
          <header className="panel-heading">
            <h2 id="ai-signals-heading">
              Other signals <span className="count">{other.length}</span>
            </h2>
          </header>
          <SignalList
            signals={other}
            empty=""
            newIds={new Set(snapshot.newSignalIds)}
          />
        </section>
      )}
    </>
  );
}

export function AiPage(): React.JSX.Element {
  return (
    <WithSnapshot title="AI">
      {(snapshot) => <AiBody snapshot={snapshot} />}
    </WithSnapshot>
  );
}
