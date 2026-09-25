import { findMetric, findSection } from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Section, Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import {
  MetricTile,
  PageHeading,
  RangePicker,
  SeverityBadge,
  SignalList,
  WithSnapshot,
} from "./ops-ui.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { formatInstant } from "#client/time.ts";
import { useRange } from "#client/charts/use-range.ts";
import { formatValue } from "#shared/ops-format";
import type { SnapshotResponse } from "#shared/ops-schema";

/**
 * Attributes the collector attaches to `quota-window` signals. `windowId` is
 * the stable key; `windowKind` is Brim's label for display.
 */
const QuotaAttributesSchema = z.object({
  provider: z.string().min(1),
  windowId: z.string().min(1),
  windowKind: z.string().min(1),
  usedRatio: z.number().min(0),
  resetsAt: z.iso.datetime({ offset: true }).optional(),
});

function quotaSeverity(ratio: number): Severity {
  if (ratio >= OPS_POLICY.quotaErrorRatio) return "error";
  return ratio >= OPS_POLICY.quotaWarningRatio ? "warning" : "ok";
}

function resetsIn(value: string | undefined): string {
  if (value === undefined) return "reset time unknown";
  const hours = Temporal.Instant.from(value)
    .since(Temporal.Now.instant())
    .total({ unit: "hours" });
  if (hours <= 0) return "resetting now";
  return hours < 48
    ? `resets in ${String(Math.round(hours))}h`
    : `resets in ${String(Math.round(hours / 24))}d`;
}

function QuotaMeter({
  signal,
}: {
  readonly signal: Signal;
}): React.JSX.Element {
  const parsed = QuotaAttributesSchema.safeParse(signal.attributes);
  if (!parsed.success)
    return (
      <li className="quota quota-invalid" role="alert">
        {signal.title}: the collector sent this quota window without its
        provider, window id, window kind, or usage attributes.
      </li>
    );
  const { provider, windowId, windowKind, usedRatio, resetsAt } = parsed.data;
  const severity = quotaSeverity(usedRatio);
  const percent = Math.min(usedRatio, 1) * 100;
  return (
    <li className="quota">
      <div className="quota-label">
        <strong>{provider}</strong>
        <span>
          {windowKind === windowId ? windowId : `${windowKind} · ${windowId}`}
        </span>
      </div>
      <div
        className={`meter meter-${severity}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={`${provider} ${windowId} quota used`}
      >
        <span style={{ width: `${String(percent)}%` }} />
      </div>
      <div className="quota-value">
        <strong>{formatValue(usedRatio, "ratio")}</strong>
        <span
          title={resetsAt === undefined ? undefined : formatInstant(resetsAt)}
        >
          {resetsIn(resetsAt)}
        </span>
      </div>
    </li>
  );
}

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
        <SeverityBadge severity={severity} />
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
        {overBudget ? ", over budget" : ", within budget"}. Cluster-billed LLM
        spend for the UTC month; subscriptions are fixed.
      </p>
    </section>
  );
}

function AiBody({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const [range, setRange] = useRange("30d");
  const section = findSection(snapshot, "ai");
  const quotas = section.signals
    .filter((signal) => signal.kind === "quota-window")
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const other = section.signals.filter(
    (signal) => signal.kind !== "quota-window",
  );
  return (
    <>
      <PageHeading eyebrow="AI budget" title="AI usage & spend">
        <SeverityBadge severity={section.severity} large />
      </PageHeading>
      <div className="ai-grid">
        <section className="panel list-panel" aria-labelledby="quota-heading">
          <header className="panel-heading">
            <h2 id="quota-heading">Subscription quota</h2>
          </header>
          {quotas.length === 0 ? (
            <p className="list-empty">No quota windows reported.</p>
          ) : (
            <ul className="quota-list">
              {quotas.map((signal) => (
                <QuotaMeter key={signal.id} signal={signal} />
              ))}
            </ul>
          )}
        </section>
        <div className="stack">
          <SpendPanel section={section} />
          <div className="metric-row">
            {section.metrics
              .filter(
                (metric) =>
                  metric.id !== METRIC_IDS.aiCostMonthToDateUsd &&
                  metric.id !== METRIC_IDS.aiCostProjectedUsd,
              )
              .map((metric) => (
                <MetricTile key={metric.id} metric={metric} />
              ))}
          </div>
        </div>
      </div>
      {other.length === 0 ? null : (
        <section className="panel list-panel" aria-label="Other AI signals">
          <SignalList signals={other} empty="" />
        </section>
      )}
      <div className="charts-heading">
        <h2 className="block-heading">Usage over time</h2>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="chart-grid">
        <SeriesChart preset="ai-cost-by-source" range={range} />
        <SeriesChart preset="ai-tokens-by-tool" range={range} />
        <SeriesChart preset="cluster-llm-cost" range={range} />
        <SeriesChart preset="ai-quota" range={range} />
        <SeriesChart preset="openai-project-cost" range={range} />
      </div>
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
