import { StatusGlyph } from "@shepherdjerred/console-ui";
import type {
  MonorepoCodeReview,
  MonorepoCodeReviewProvider,
} from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  APP_HOSTS,
  temporalWorkflowLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { Identifier } from "#client/visuals/identifier.tsx";
import {
  DataTable,
  StackedMeter,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { pillSeverity } from "#client/visuals/pill.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";

const COORDINATOR_LINK = temporalWorkflowLink("code-review-coordinator");

function poolStatusSeverity(
  status: MonorepoCodeReviewProvider["status"],
): "ok" | "warning" | "info" {
  switch (status) {
    case "ready":
      return "ok";
    case "cooldown":
    case "disabled":
    case "unknown":
      return "warning";
    case "standby":
      return "info";
  }
}

function poolStatusLabel(row: MonorepoCodeReviewProvider): string {
  switch (row.status) {
    case "ready":
      return "Ready";
    case "cooldown": {
      const hhmm =
        row.cooldownUntil === null ? null : row.cooldownUntil.slice(11, 16);
      return hhmm === null || hhmm === ""
        ? "Cooldown"
        : `Cooldown · ${hhmm} UTC`;
    }
    case "standby":
      return "Standby";
    case "disabled":
      return "Disabled";
    case "unknown":
      return "Unknown";
  }
}

function sortOrderForProvider(row: MonorepoCodeReviewProvider): number {
  if (row.configuredWeight > 0) {
    return 0;
  }
  return row.assignments7d > 0 ? 1 : 2;
}

function formatAttemptBreakdown(row: MonorepoCodeReviewProvider): string {
  const total =
    row.completed7d + row.timedOut7d + row.usageLimited7d + row.skipped7d;
  if (total === 0) {
    return "—";
  }
  const parts = [`${String(row.completed7d)} ok`];
  if (row.timedOut7d > 0) {
    parts.push(`${String(row.timedOut7d)} timeout`);
  }
  if (row.usageLimited7d > 0) {
    parts.push(`${String(row.usageLimited7d)} limited`);
  }
  if (row.skipped7d > 0) {
    parts.push(`${String(row.skipped7d)} skip`);
  }
  return parts.join(" · ");
}

function buildProviderColumns(
  totalAssignments7d: number,
): readonly DataTableColumn<MonorepoCodeReviewProvider>[] {
  return [
    {
      key: "provider",
      header: "Provider",
      sortValue: (row) => row.displayName,
      render: (row) => (
        <div className="eng-pkg-cell">
          <span className="eng-pkg-name">{row.displayName}</span>
          <span className="eng-pkg-sub">
            <code>
              <Identifier value={row.id} />
            </code>
            <span
              className="visual-pill"
              data-sev={row.tier === "free" ? "ok" : "info"}
            >
              {row.tier === "free" ? "$0 free" : "Paid exception"}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Pool status",
      sortValue: (row) => `${String(sortOrderForProvider(row))}:${row.status}`,
      render: (row) => {
        const sev = poolStatusSeverity(row.status);
        return (
          <span className="visual-pill" data-sev={pillSeverity(sev)}>
            <StatusGlyph severity={sev} />
            {poolStatusLabel(row)}
          </span>
        );
      },
    },
    {
      key: "configuredWeight",
      header: "Weight & target",
      align: "right",
      sortValue: (row) => row.configuredWeight,
      exportValue: (row) => row.configuredWeight,
      render: (row) => {
        const targetPct =
          row.targetShareRatio === null
            ? "standby"
            : `${String(Math.round(row.targetShareRatio * 100))}%`;
        return (
          <div className="eng-pkg-cell">
            <span>{`${String(row.configuredWeight)} (${targetPct})`}</span>
            <span className="eng-pkg-sub">
              {`score ${String(row.currentSmoothWeight)}`}
            </span>
          </div>
        );
      },
    },
    {
      key: "assignments7d",
      header: "Assignments (7d)",
      align: "right",
      sortValue: (row) => row.assignments7d,
      exportValue: (row) => row.assignments7d,
      render: (row) => {
        if (row.assignments7d === 0 || totalAssignments7d <= 0) {
          return formatValue(row.assignments7d, "count");
        }
        const pct = Math.round((row.assignments7d / totalAssignments7d) * 100);
        return `${formatValue(row.assignments7d, "count")} (${String(pct)}%)`;
      },
    },
    {
      key: "outcomes7d",
      header: "Attempt outcomes (7d)",
      sortValue: (row) => row.completed7d,
      exportValue: (row) => formatAttemptBreakdown(row),
      render: (row) => (
        <span className="eng-code-review-breakdown">
          {formatAttemptBreakdown(row)}
        </span>
      ),
    },
    {
      key: "cooldowns7d",
      header: "Cooldowns (7d)",
      align: "right",
      sortValue: (row) => row.cooldowns7d,
      render: (row) => formatValue(row.cooldowns7d, "count"),
    },
  ];
}

function resolvePoolCardState(codeReview: MonorepoCodeReview): {
  severity: Severity;
  value: string;
  hint: string;
} {
  if (!codeReview.enabled) {
    return {
      severity: "warning",
      value: `${String(codeReview.readyProvidersCount)} / ${String(codeReview.activeProvidersCount)}`,
      hint: "Gate disabled in Flags",
    };
  }
  if (!codeReview.coordinatorObserved) {
    return {
      severity: "unknown",
      value: `— / ${String(codeReview.activeProvidersCount)}`,
      hint: "Coordinator state unavailable",
    };
  }
  const severity: Severity =
    codeReview.activeProvidersCount === 0 ||
    codeReview.readyProvidersCount === 0
      ? "warning"
      : "ok";
  const hint =
    codeReview.coolingDownProvidersCount > 0
      ? `${String(codeReview.coolingDownProvidersCount)} provider(s) cooling down`
      : "Weighted round-robin ready";
  return {
    severity,
    value: `${String(codeReview.readyProvidersCount)} / ${String(codeReview.activeProvidersCount)}`,
    hint,
  };
}

function resolveCoordinatorCardState(codeReview: MonorepoCodeReview): {
  value: string;
  hint: string;
} {
  if (!codeReview.coordinatorObserved) {
    return { value: "—", hint: "Coordinator state unavailable" };
  }
  return {
    value: formatValue(codeReview.coordinatorProcessedCount, "count"),
    hint: codeReview.coordinatorRunning
      ? "Singleton workflow running"
      : "Coordinator idle",
  };
}

export function MonorepoCodeReviewSection({
  codeReview,
  range,
}: {
  readonly codeReview: MonorepoCodeReview;
  readonly range: SeriesRange;
}): React.JSX.Element {
  const o = codeReview.outcomes7d;
  const blockingTotal = o.blockingFindings + o.p0Veto + o.reviewWithdrawn;
  const totalOutcomes =
    o.clean +
    o.priorRound +
    o.threadsResolved +
    o.quotaExempt +
    o.providerTimeout +
    o.allSkipped +
    blockingTotal;
  const savedPct =
    totalOutcomes > 0 ? Math.round((o.priorRound / totalOutcomes) * 100) : 0;

  const poolCard = resolvePoolCardState(codeReview);
  const coordinatorCard = resolveCoordinatorCardState(codeReview);

  const totalAssignments7d = useMemo(
    () => codeReview.providers.reduce((sum, row) => sum + row.assignments7d, 0),
    [codeReview.providers],
  );

  const sortedProviders = useMemo(
    () =>
      [...codeReview.providers].sort((left, right) => {
        const orderDiff =
          sortOrderForProvider(left) - sortOrderForProvider(right);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return right.configuredWeight === left.configuredWeight
          ? right.assignments7d - left.assignments7d
          : right.configuredWeight - left.configuredWeight;
      }),
    [codeReview.providers],
  );

  const columns = useMemo(
    () => buildProviderColumns(totalAssignments7d),
    [totalAssignments7d],
  );

  return (
    <section
      id="code-review"
      aria-labelledby="monorepo-code-review-heading"
      className="eng-code-review-section"
    >
      <div className="charts-heading eng-code-review-heading">
        <h2 id="monorepo-code-review-heading" className="block-heading">
          PR code review pool
        </h2>
        <div className="eng-heading-links">
          <a
            className="eng-ext-link"
            href={APP_HOSTS.flags}
            target="_blank"
            rel="noreferrer"
          >
            Flags weights
            <ExternalLinkIcon aria-hidden="true" />
          </a>
          <a
            className="eng-ext-link"
            href={COORDINATOR_LINK.url}
            target="_blank"
            rel="noreferrer"
          >
            Coordinator workflow
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="eng-meters-grid">
        <div className="eng-mix-panel">
          <StackedMeter
            label="7d ci/code-review gate outcomes"
            unit="count"
            segments={[
              {
                key: "clean",
                label: "Clean review",
                value: o.clean,
                color: "var(--ui-sev-ok)",
              },
              {
                key: "prior-round",
                label: "Prior-round saved",
                value: o.priorRound,
                color: "var(--ui-accent)",
              },
              {
                key: "resolved",
                label: "Threads resolved",
                value: o.threadsResolved,
                color: "var(--ui-sev-info)",
              },
              {
                key: "timeout",
                label: "Timeout fallback",
                value: o.providerTimeout,
                color: "var(--ui-sev-warning)",
              },
              {
                key: "quota-exempt",
                label: "Quota-exempt pass",
                value: o.quotaExempt,
                color: "var(--ui-muted)",
              },
              {
                key: "skipped",
                label: "Skipped",
                value: o.allSkipped,
              },
              {
                key: "blocking",
                label: "Blocking P0/P1",
                value: blockingTotal,
                color: "var(--ui-sev-error)",
              },
            ]}
          />
        </div>

        <div
          className="eng-kpi-grid"
          style={{
            marginBottom: 0,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          <div className="eng-kpi-card" data-sev={poolCard.severity}>
            <div className="eng-kpi-top">
              <span className="eng-kpi-label">Active review pool</span>
              {poolCard.severity === "ok" ? null : (
                <StatusGlyph severity={poolCard.severity} />
              )}
            </div>
            <strong className="eng-kpi-value">{poolCard.value}</strong>
            <span className="eng-kpi-hint">{poolCard.hint}</span>
          </div>

          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Re-reviews saved (7d)</span>
            <strong className="eng-kpi-value">
              {formatValue(o.priorRound, "count")}
            </strong>
            <span className="eng-kpi-hint">
              {`${String(savedPct)}% of 7d PR pushes conserved`}
            </span>
          </div>

          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Median turnaround (7d)</span>
            <strong className="eng-kpi-value">
              {formatValue(codeReview.medianDurationSeconds7d, "seconds")}
            </strong>
            <span className="eng-kpi-hint">
              {`p95 ${formatValue(codeReview.p95DurationSeconds7d, "seconds")}`}
            </span>
          </div>

          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Coordinator events</span>
            <strong className="eng-kpi-value">{coordinatorCard.value}</strong>
            <span className="eng-kpi-hint">{coordinatorCard.hint}</span>
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <SeriesChart
          preset="pr-code-review-assignments"
          range={range}
          mode="bar"
          title="Code review assignments by provider"
          syncKey="monorepo"
        />
        <SeriesChart
          preset="pr-code-review-outcomes"
          range={range}
          mode="bar"
          title="Code review gate outcomes"
          syncKey="monorepo"
        />
      </div>

      <DataTable
        caption="PR code-review provider pool"
        hideCaption
        rows={sortedProviders}
        rowKey={(row) => row.id}
        columns={columns}
        initialCap={10}
        searchPlaceholder="Search provider or status…"
        searchText={(row) =>
          `${row.displayName} ${row.id} ${row.tier} ${row.status}`
        }
        exportFilename="monorepo-code-review-providers"
        emptyMessage="No PR code-review providers registered."
      />
    </section>
  );
}
