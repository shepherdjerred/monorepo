import { Temporal } from "@js-temporal/polyfill";
import type {
  FliptFlagSummary,
  FliptNamespaceStatus,
} from "@shepherdjerred/ops-model/facets.ts";
import type { Metric } from "@shepherdjerred/ops-model/snapshot.ts";
import { useMemo, useState } from "react";

import {
  BugsinkServiceView,
  ScoutServiceView,
} from "./product-analytics-views.tsx";
import {
  GolinkServiceView,
  renderSimpleProductAppView,
} from "./product-app-views.tsx";
import {
  FacetSection,
  kpi,
  PresetGrid,
  txtCol,
} from "./product-view-helpers.tsx";
import { MetricTile } from "#client/ops/ops-ui.tsx";
import {
  DataTable,
  StackedMeter,
  StatusMatrix,
  type DataTableColumn,
  type StatusMatrixCell,
} from "#client/visuals/index.ts";
import type { SeriesRange } from "#shared/ops-schema";
import "#styles/product.css";

function mapFliptCell(status: FliptNamespaceStatus): StatusMatrixCell {
  switch (status) {
    case "ok":
      return { status: "ok", label: "OK" };
    case "drift":
      return { status: "warning", label: "Drift" };
    case "missing":
      return { status: "missing", label: "Missing" };
  }
}

function isReviewOverdue(reviewBy: string): boolean {
  try {
    return (
      Temporal.PlainDate.compare(
        Temporal.PlainDate.from(reviewBy),
        Temporal.Now.plainDateISO(),
      ) < 0
    );
  } catch {
    return false;
  }
}

function enabledPill(enabled: boolean): React.JSX.Element {
  return (
    <span
      className={`visual-pill ${enabled ? "visual-pill-ok" : "visual-pill-neutral"}`}
    >
      {enabled ? "✓ Enabled" : "— Off"}
    </span>
  );
}

const FLIPT_FLAG_COLUMNS: readonly DataTableColumn<FliptFlagSummary>[] = [
  txtCol(
    "key",
    "Flag key",
    (f) => <span className="mono">{f.key}</span>,
    (f) => f.key,
  ),
  txtCol(
    "namespace",
    "Namespace",
    (f) => <span className="mono">{f.namespace}</span>,
    (f) => f.namespace,
  ),
  txtCol(
    "prod",
    "Prod",
    (f) => enabledPill(f.prodEnabled),
    (f) => (f.prodEnabled ? 1 : 0),
  ),
  txtCol(
    "beta",
    "Beta",
    (f) => enabledPill(f.betaEnabled),
    (f) => (f.betaEnabled ? 1 : 0),
  ),
  txtCol(
    "exception",
    "Default-off exception & review",
    (f) => {
      if (f.defaultOffReason === undefined && f.reviewBy === undefined) {
        return <span className="muted">—</span>;
      }
      const overdue = f.reviewBy !== undefined && isReviewOverdue(f.reviewBy);
      return (
        <div className="product-cell-stack">
          {f.defaultOffReason === undefined ? null : (
            <span className="product-cell-primary">{f.defaultOffReason}</span>
          )}
          {f.reviewBy === undefined ? null : (
            <span
              className={`visual-pill ${overdue ? "visual-pill-error" : "visual-pill-warning"}`}
            >
              {overdue
                ? `✕ Overdue (${f.reviewBy})`
                : `! Review by ${f.reviewBy}`}
            </span>
          )}
        </div>
      );
    },
    (f) => f.reviewBy ?? f.defaultOffReason ?? null,
  ),
];

function matchesFlagState(
  flag: FliptFlagSummary,
  stateFilter: string,
): boolean {
  switch (stateFilter) {
    case "prod-on":
      return flag.prodEnabled;
    case "beta-only":
      return !flag.prodEnabled && flag.betaEnabled;
    case "default-off":
      return !flag.prodEnabled || flag.defaultOffReason !== undefined;
    default:
      return true;
  }
}

function FlagsInventorySection(props: {
  readonly flags: readonly FliptFlagSummary[];
  readonly namespaces: readonly string[];
}): React.JSX.Element {
  const [nsFilter, setNsFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const filtered = useMemo(
    () =>
      props.flags.filter(
        (f) =>
          (nsFilter === "all" || f.namespace === nsFilter) &&
          matchesFlagState(f, stateFilter),
      ),
    [props.flags, nsFilter, stateFilter],
  );

  return (
    <DataTable
      caption="Managed feature flags inventory"
      hideCaption
      rows={filtered}
      rowKey={(f) => `${f.namespace}:${f.key}`}
      columns={FLIPT_FLAG_COLUMNS}
      defaultSort={{ key: "key", direction: "ascending" }}
      searchPlaceholder="Search flag key, namespace, or exception reason…"
      searchText={(f) => `${f.namespace} ${f.key} ${f.defaultOffReason ?? ""}`}
      filters={[
        {
          key: "state",
          label: "Rollout state",
          value: stateFilter,
          onChange: setStateFilter,
          options: [
            { value: "all", label: "All", count: props.flags.length },
            { value: "prod-on", label: "Prod on" },
            { value: "beta-only", label: "Beta only" },
            { value: "default-off", label: "Default-off" },
          ],
        },
        {
          key: "namespace",
          label: "Namespace",
          value: nsFilter,
          onChange: setNsFilter,
          options: [
            { value: "all", label: "All namespaces" },
            ...props.namespaces.map((ns) => ({ value: ns, label: ns })),
          ],
        },
      ]}
      initialCap={25}
      emptyMessage="No managed flags match the active filters."
    />
  );
}

function FlagsServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <div className="product-scope product-service-stack">
      <FacetSection facetKey="flipt" label="Flipt">
        {(flipt) => {
          const betaOnly = Math.max(
            0,
            flipt.betaEnabledCount - flipt.prodEnabledCount,
          );
          const offBoth = Math.max(
            0,
            flipt.totalFlags -
              Math.max(flipt.prodEnabledCount, flipt.betaEnabledCount),
          );
          const kpis: readonly Metric[] = [
            kpi("flipt.total", "Total Flags", flipt.totalFlags),
            kpi("flipt.prod", "Prod Enabled", flipt.prodEnabledCount),
            kpi("flipt.beta", "Beta Enabled", flipt.betaEnabledCount),
            kpi(
              "flipt.exceptions",
              "Default-Off Exceptions",
              flipt.defaultOffExceptionsCount,
              { severity: flipt.defaultOffExceptionsCount > 0 ? "info" : "ok" },
            ),
            kpi(
              "flipt.overdue",
              "Overdue Exceptions",
              flipt.overdueExceptionsCount,
              { severity: flipt.overdueExceptionsCount > 0 ? "error" : "ok" },
            ),
          ];
          const nsNames = [
            ...new Set([
              ...flipt.namespaces.map((n) => n.namespace),
              ...flipt.flags.map((f) => f.namespace),
            ]),
          ];
          return (
            <>
              <div className="product-kpi-grid">
                {kpis.map((m) => (
                  <MetricTile key={m.id} metric={m} />
                ))}
              </div>
              <div className="product-meter-card">
                <StackedMeter
                  label="Rollout mix across managed flags"
                  segments={[
                    {
                      key: "prod",
                      label: "Prod enabled",
                      value: flipt.prodEnabledCount,
                      color: "var(--status-good)",
                    },
                    {
                      key: "beta-only",
                      label: "Beta only",
                      value: betaOnly,
                      color: "var(--status-info)",
                    },
                    {
                      key: "off",
                      label: "Default-off",
                      value: offBoth,
                      color: "var(--status-warning)",
                    },
                  ]}
                />
              </div>
              <PresetGrid
                heading="Evaluation throughput"
                syncKey="flags"
                range={range}
                charts={[{ preset: "flipt-evaluations" }]}
              />
              <h2 className="block-heading">
                Namespace prod / beta drift matrix
              </h2>
              <StatusMatrix
                caption="Flipt namespace sync status across prod and beta"
                hideCaption
                rowHeaderLabel="Namespace"
                columns={[
                  { key: "prod", label: "Prod" },
                  { key: "beta", label: "Beta" },
                ]}
                rows={flipt.namespaces.map((ns) => ({
                  key: ns.namespace,
                  label: ns.name,
                  meta: `${ns.namespace} · ${String(ns.flagCount)} flags`,
                  cells: {
                    prod: mapFliptCell(ns.prodStatus),
                    beta: mapFliptCell(ns.betaStatus),
                  },
                }))}
              />
              <h2 className="block-heading">Managed flags inventory</h2>
              <FlagsInventorySection flags={flipt.flags} namespaces={nsNames} />
            </>
          );
        }}
      </FacetSection>
    </div>
  );
}

/** Renders rich Hub 2.0 product, error, flag, media, shortlink, mail, and Storm service views. */
export function renderProductServiceView(
  id: string,
  range: SeriesRange,
): React.JSX.Element | null {
  switch (id) {
    case "scout-for-lol":
      return <ScoutServiceView range={range} />;
    case "bugsink":
      return <BugsinkServiceView range={range} />;
    case "flags":
      return <FlagsServiceView range={range} />;
    case "golink":
      return <GolinkServiceView range={range} />;
    default:
      return renderSimpleProductAppView(id, range);
  }
}
