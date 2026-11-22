import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type {
  MonorepoAudit,
  MonorepoExpensiveTask,
  MonorepoFacet,
  MonorepoPackage,
} from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { facetQuery, isSnapshotUnavailable } from "#client/ops/ops-api.ts";
import {
  PageHeading,
  RangePicker,
  ServiceLink,
  SeverityBadge,
} from "#client/ops/ops-ui.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import {
  BudgetMeter,
  DataTable,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";
import "#styles/engineering.css";

function hitRatioSeverity(ratio: number | null): Severity {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "unknown";
  }
  if (ratio >= 0.8) {
    return "ok";
  }
  return ratio >= 0.6 ? "warning" : "error";
}

function InlineHitRatio({
  ratio,
}: {
  readonly ratio: number;
}): React.JSX.Element {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const pct = Math.round(clamped * 100);
  return (
    <span className="eng-inline-ratio">
      <span className="eng-inline-track" aria-hidden="true">
        <span
          className="eng-inline-fill"
          style={{ width: `${String(pct)}%` }}
        />
      </span>
      <span>{`${String(pct)}%`}</span>
    </span>
  );
}

const EXPENSIVE_TASK_COLUMNS: readonly DataTableColumn<MonorepoExpensiveTask>[] =
  [
    {
      key: "taskId",
      header: "Task",
      sortValue: (row) => row.taskId,
      render: (row) => (
        <div className="eng-pkg-cell">
          <span className="eng-pkg-name">{row.taskId}</span>
          <span className="eng-pkg-sub">
            <span>{row.packageName}</span>
            <span className="visual-pill visual-pill-neutral">{row.task}</span>
          </span>
        </div>
      ),
    },
    {
      key: "hits",
      header: "Hits",
      align: "right",
      sortValue: (row) => row.hits,
      render: (row) => formatValue(row.hits, "count"),
    },
    {
      key: "misses",
      header: "Misses",
      align: "right",
      sortValue: (row) => row.misses,
      render: (row) => formatValue(row.misses, "count"),
    },
    {
      key: "hitRatio",
      header: "Hit Ratio",
      align: "right",
      sortValue: (row) => row.hitRatio,
      exportValue: (row) => Math.round(row.hitRatio * 100),
      render: (row) => <InlineHitRatio ratio={row.hitRatio} />,
    },
    {
      key: "medianMissMs",
      header: "Median Miss",
      align: "right",
      sortValue: (row) => row.medianMissMs,
      render: (row) => formatValue(row.medianMissMs, "ms"),
    },
    {
      key: "totalMissMinutes",
      header: "Total Miss Time",
      align: "right",
      sortValue: (row) => row.totalMissMinutes,
      render: (row) => `${row.totalMissMinutes.toFixed(1)} min`,
    },
  ];

const PACKAGE_COLUMNS: readonly DataTableColumn<MonorepoPackage>[] = [
  {
    key: "name",
    header: "Package",
    sortValue: (pkg) => pkg.name,
    render: (pkg) => (
      <div className="eng-pkg-cell">
        <span className="eng-pkg-name">{pkg.name}</span>
        <span className="eng-pkg-sub">
          <code>{pkg.path}</code>
        </span>
      </div>
    ),
  },
  {
    key: "category",
    header: "Category",
    sortValue: (pkg) => pkg.category,
    render: (pkg) => (
      <span className="visual-pill visual-pill-neutral">{pkg.category}</span>
    ),
  },
  {
    key: "serviceId",
    header: "Hosted Service",
    sortValue: (pkg) => pkg.serviceId,
    render: (pkg) =>
      pkg.serviceId === null ? (
        <span className="muted">—</span>
      ) : (
        <ServiceLink id={pkg.serviceId} />
      ),
  },
  {
    key: "extended",
    header: "Extended Tier",
    sortValue: (pkg) => (pkg.hasExtendedTests ? 1 : 0),
    exportValue: (pkg) => pkg.hasExtendedTests,
    render: (pkg) =>
      pkg.hasExtendedTests ? (
        <span className="visual-pill visual-pill-info">
          <span aria-hidden="true">✓</span>Extended
        </span>
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    key: "cacheHitRatio",
    header: "Cache Hit %",
    align: "right",
    sortValue: (pkg) => pkg.cacheHitRatio,
    render: (pkg) => formatValue(pkg.cacheHitRatio, "ratio"),
  },
  {
    key: "medianDurationMs",
    header: "Median Task",
    align: "right",
    sortValue: (pkg) => pkg.medianDurationMs,
    render: (pkg) => formatValue(pkg.medianDurationMs, "ms"),
  },
  {
    key: "openPrCount",
    header: "Open PRs",
    align: "right",
    sortValue: (pkg) => pkg.openPrCount,
    render: (pkg) => formatValue(pkg.openPrCount, "count"),
  },
  {
    key: "renovatePendingCount",
    header: "Pending Renovate",
    align: "right",
    sortValue: (pkg) => pkg.renovatePendingCount,
    render: (pkg) => formatValue(pkg.renovatePendingCount, "count"),
  },
  {
    key: "bugsinkOpenCount",
    header: "Bugsink Open",
    align: "right",
    sortValue: (pkg) => pkg.bugsinkOpenCount,
    render: (pkg) =>
      pkg.bugsinkOpenCount > 0 ? (
        <span className="visual-pill visual-pill-warning">
          <span aria-hidden="true">!</span>
          {String(pkg.bugsinkOpenCount)}
        </span>
      ) : (
        "0"
      ),
  },
  {
    key: "flagCount",
    header: "Flags",
    align: "right",
    sortValue: (pkg) => pkg.flagCount,
    render: (pkg) => formatValue(pkg.flagCount, "count"),
  },
];

function AuditsStrip({
  audits,
}: {
  readonly audits: readonly MonorepoAudit[];
}): React.JSX.Element {
  return (
    <section aria-labelledby="monorepo-audits-heading">
      <h2 className="block-heading" id="monorepo-audits-heading">
        Monorepo audits
      </h2>
      {audits.length === 0 ? (
        <p className="visual-empty">No monorepo audit runs recorded yet.</p>
      ) : (
        <div className="eng-audits-grid">
          {audits.map((audit) => (
            <article key={audit.id} className="eng-audit-card">
              <div className="eng-audit-head">
                <span className="eng-audit-title">{audit.label}</span>
                <SeverityBadge severity={audit.status} />
              </div>
              <div className="eng-audit-meta">
                <code className="visual-branch-chip">{audit.id}</code>
                <span>
                  {audit.lastRunAt === null
                    ? "Never run"
                    : `Ran ${age(audit.lastRunAt)}`}
                </span>
              </div>
              {audit.detail === undefined ? null : (
                <p className="eng-kpi-hint">{audit.detail}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MonorepoBody({
  monorepo,
  range,
  onRangeChange,
}: {
  readonly monorepo: MonorepoFacet;
  readonly range: SeriesRange;
  readonly onRangeChange: (next: SeriesRange) => void;
}): React.JSX.Element {
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pkg of monorepo.packages) {
      counts.set(pkg.category, (counts.get(pkg.category) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    );
    return [
      { value: "all", label: "All", count: monorepo.packages.length },
      ...entries.map(([category, count]) => ({
        value: category,
        label: category,
        count,
      })),
    ];
  }, [monorepo.packages]);

  const filteredPackages = useMemo(
    () =>
      categoryFilter === "all"
        ? monorepo.packages
        : monorepo.packages.filter((pkg) => pkg.category === categoryFilter),
    [categoryFilter, monorepo.packages],
  );

  return (
    <>
      <div className="eng-meters-grid">
        <div className="eng-meter-card">
          <BudgetMeter
            label="7d Turbo Cache Hit Ratio"
            value={monorepo.turboHitRatio7d}
            max={1}
            unit="ratio"
            severity={hitRatioSeverity(monorepo.turboHitRatio7d)}
            detail={`Across ${String(monorepo.verifyRunsAnalyzed)} verify runs analyzed`}
          />
        </div>
        <div
          className="eng-kpi-grid"
          style={{
            marginBottom: 0,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Workspace Packages</span>
            <strong className="eng-kpi-value">
              {formatValue(monorepo.packageCount, "count")}
            </strong>
            <span className="eng-kpi-hint">Isolated Bun workspace</span>
          </div>
          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Saved CI Hours (7d)</span>
            <strong className="eng-kpi-value">
              {formatValue(monorepo.turboSavedHours7d, "hours")}
            </strong>
            <span className="eng-kpi-hint">Remote Turborepo cache</span>
          </div>
          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Verify Runs Analyzed</span>
            <strong className="eng-kpi-value">
              {formatValue(monorepo.verifyRunsAnalyzed, "count")}
            </strong>
            <span className="eng-kpi-hint">7-day CI sample window</span>
          </div>
          <div className="eng-kpi-card">
            <span className="eng-kpi-label">Catalog Pins</span>
            <strong className="eng-kpi-value">
              {formatValue(monorepo.catalogPinsCount, "count")}
            </strong>
            <span className="eng-kpi-hint">Shared version catalog</span>
          </div>
        </div>
      </div>

      <div className="charts-heading">
        <h2 className="block-heading">Build & cache performance</h2>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>
      <div className="chart-grid">
        <SeriesChart
          preset="turbo-hit-ratio"
          range={range}
          title="Turbo cache hit ratio (7d)"
          syncKey="monorepo"
        />
        <SeriesChart
          preset="turbo-network-bps"
          range={range}
          mode="stacked-area"
          title="Turbo cache hit download vs miss upload"
          syncKey="monorepo"
        />
        <SeriesChart
          preset="woodpecker-pipelines"
          range={range}
          mode="bar"
          title="CI pipeline outcomes"
          syncKey="monorepo"
        />
        <SeriesChart
          preset="kueue-cpu-quota"
          range={range}
          title="Kueue CI CPU usage"
          syncKey="monorepo"
        />
      </div>

      <AuditsStrip audits={monorepo.audits} />

      <h2 className="block-heading">Expensive & cache-missing tasks</h2>
      <DataTable
        caption="Expensive and cache-missing Turborepo tasks"
        hideCaption
        rows={monorepo.expensiveTasks}
        rowKey={(row) => row.taskId}
        columns={EXPENSIVE_TASK_COLUMNS}
        defaultSort={{ key: "totalMissMinutes", direction: "descending" }}
        initialCap={15}
        searchPlaceholder="Search task or package…"
        searchText={(row) => `${row.taskId} ${row.packageName} ${row.task}`}
        exportFilename="monorepo-expensive-tasks"
        emptyMessage="No expensive cache misses recorded."
      />

      <h2 className="block-heading">Workspace package directory</h2>
      <DataTable
        caption="Monorepo workspace packages"
        hideCaption
        rows={filteredPackages}
        rowKey={(pkg) => pkg.name}
        columns={PACKAGE_COLUMNS}
        defaultSort={{ key: "name", direction: "ascending" }}
        initialCap={25}
        searchPlaceholder="Search package name or path…"
        searchText={(pkg) =>
          `${pkg.name} ${pkg.path} ${pkg.category} ${pkg.serviceId ?? ""}`
        }
        filters={[
          {
            key: "category",
            label: "Package category",
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: categoryOptions,
          },
        ]}
        exportFilename="monorepo-packages"
        emptyMessage="No workspace packages found."
      />
    </>
  );
}

export function MonorepoPage(): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const facet = Loaded.fromQuery(useQuery(facetQuery("monorepo")));

  return (
    <main className="eng-page">
      <title>Monorepo · Hub</title>
      <PageHeading eyebrow="Workspace & Turborepo" title="Monorepo" />
      <LoadingBlock
        values={{ facet }}
        fallback={<div className="loading-state">Loading Monorepo…</div>}
        renderError={(errors) =>
          isSnapshotUnavailable(errors[0].error) ? (
            <div className="empty-state">
              No Monorepo facet has been ingested yet.
            </div>
          ) : (
            <div className="error-state">
              Monorepo explorer data is unavailable.
            </div>
          )
        }
      >
        {({ facet: envelope }, meta) => (
          <>
            <StaleNotice errors={meta.errors} />
            {envelope.data === null ? (
              <div className="empty-state">
                No Monorepo workspace telemetry snapshot is stored yet.
              </div>
            ) : (
              <MonorepoBody
                monorepo={envelope.data}
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
