import { Loaded } from "@shepherdjerred/loaded";
import type { FacetByKey, FacetKey } from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Metric, SourceId } from "@shepherdjerred/ops-model/snapshot.ts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import type { ChartMode } from "#client/charts/uplot-chart.tsx";
import { facetQuery } from "#client/ops/ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import type { DataTableColumn } from "#client/visuals/index.ts";
import type { SeriesPresetId, SeriesRange } from "#shared/ops-schema";

export type PresetSpec = {
  readonly preset: SeriesPresetId;
  readonly title?: string;
  readonly mode?: ChartMode;
  readonly target?: string;
};

export function txtCol<T>(
  key: string,
  header: string,
  render: (row: T) => ReactNode,
  sortValue?: (row: T) => string | number | null | undefined,
): DataTableColumn<T> {
  return { key, header, render, sortValue };
}

export function numCol<T>(
  key: string,
  header: string,
  getValue: (row: T) => number | null,
): DataTableColumn<T> {
  return {
    key,
    header,
    align: "right",
    sortValue: getValue,
    render: (row) => {
      const val = getValue(row);
      return val === null ? "—" : val.toLocaleString("en-US");
    },
  };
}

export function extLink(
  href: string,
  text: string,
  ariaLabel?: string,
): React.JSX.Element {
  return (
    <a
      className="product-url-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
    >
      {text}
      <ExternalLinkIcon aria-hidden="true" />
    </a>
  );
}

export function kpi(
  id: string,
  label: string,
  value: number,
  opts?: { readonly severity?: Severity; readonly source?: SourceId },
): Metric {
  return {
    id,
    label,
    value,
    unit: "count",
    severity: opts?.severity ?? "ok",
    source: opts?.source ?? "probes",
  };
}

export function PresetGrid(props: {
  readonly heading: string;
  readonly syncKey: string;
  readonly range: SeriesRange;
  readonly charts: readonly PresetSpec[];
}): React.JSX.Element {
  return (
    <section className="product-service-stack" aria-label={props.heading}>
      <h2 className="block-heading">{props.heading}</h2>
      <div className="chart-grid">
        {props.charts.map((c) => (
          <SeriesChart
            key={`${c.preset}:${c.target ?? "all"}`}
            preset={c.preset}
            range={props.range}
            title={c.title}
            mode={c.mode}
            target={c.target}
            syncKey={props.syncKey}
          />
        ))}
      </div>
    </section>
  );
}

export function FacetSection<K extends FacetKey>(props: {
  readonly facetKey: K;
  readonly label: string;
  readonly children: (data: FacetByKey[K]) => ReactNode;
}): React.JSX.Element {
  const state = Loaded.fromQuery(useQuery(facetQuery(props.facetKey)));
  if (state.status === "loading") {
    return <div className="loading-state">{`Loading ${props.label}…`}</div>;
  }
  if (state.status === "error") {
    return (
      <div
        className="error-state"
        role="alert"
      >{`${props.label} telemetry is unavailable.`}</div>
    );
  }
  return (
    <>
      {state.status === "degraded" ? (
        <StaleNotice errors={state.errors} />
      ) : null}
      {state.data.data === null ? (
        <div className="empty-state">{`No ${props.label} facet data ingested yet.`}</div>
      ) : (
        props.children(state.data.data)
      )}
    </>
  );
}
