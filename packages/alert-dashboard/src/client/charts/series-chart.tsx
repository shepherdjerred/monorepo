import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";

import {
  UplotChart,
  type ChartMode,
  type ChartThreshold,
} from "./uplot-chart.tsx";
import { seriesQuery } from "#client/ops/ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatValue } from "#shared/ops-format";
import type {
  SeriesPresetId,
  SeriesRange,
  SeriesResponse,
} from "#shared/ops-schema";
import "#styles/visuals.css";

function latest(points: readonly (readonly [number, number])[]): number | null {
  return points.at(-1)?.[1] ?? null;
}

function describe(response: SeriesResponse): string {
  if (response.series.length === 0) {
    return `${response.title}: no data`;
  }
  return `${response.title}, latest: ${response.series
    .map(
      (entry) =>
        `${entry.name} ${formatValue(latest(entry.points), response.unit)}`,
    )
    .join(", ")}`;
}

function SeriesBody({
  response,
  mode,
  threshold,
  syncKey,
}: {
  readonly response: SeriesResponse;
  readonly mode?: ChartMode | undefined;
  readonly threshold?: ChartThreshold | undefined;
  readonly syncKey?: string | undefined;
}): React.JSX.Element {
  if (response.series.every((entry) => entry.points.length === 0)) {
    return (
      <p className="chart-empty">
        No samples in this range yet. The metric may not be exported.
      </p>
    );
  }
  return (
    <>
      <UplotChart
        series={response.series}
        unit={response.unit}
        label={describe(response)}
        mode={mode}
        threshold={threshold}
        syncKey={syncKey}
      />
      <details className="chart-table">
        <summary>Data table</summary>
        <table className="ui-table">
          <thead>
            <tr>
              <th scope="col">Series</th>
              <th scope="col" className="num">
                Latest
              </th>
              <th scope="col" className="num">
                Peak
              </th>
            </tr>
          </thead>
          <tbody>
            {response.series.map((entry) => (
              <tr key={entry.name}>
                <th scope="row">{entry.name}</th>
                <td className="num">
                  {formatValue(latest(entry.points), response.unit)}
                </td>
                <td className="num">
                  {formatValue(
                    entry.points.length === 0
                      ? null
                      : Math.max(...entry.points.map(([, value]) => value)),
                    response.unit,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export type SeriesChartProps = {
  readonly preset: SeriesPresetId;
  readonly range: SeriesRange;
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly mode?: ChartMode | undefined;
  readonly threshold?: ChartThreshold | undefined;
  readonly syncKey?: string | undefined;
  /** Target filter key reserved for target-scoped series queries. */
  readonly target?: string | undefined;
};

/** Pure presentation of a `Loaded<SeriesResponse>` chart panel. */
export function SeriesChartPanel({
  value,
  range,
  title,
  subtitle,
  mode,
  threshold,
  syncKey,
  target,
  onRetry,
}: {
  readonly value: Loaded<SeriesResponse>;
  readonly range: SeriesRange;
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly mode?: ChartMode | undefined;
  readonly threshold?: ChartThreshold | undefined;
  readonly syncKey?: string | undefined;
  readonly target?: string | undefined;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const response = Loaded.getOrElse(value, undefined);
  return (
    <figure className="chart-panel" data-target={target}>
      <figcaption>
        <div className="visual-chart-heading">
          <h3>{title ?? response?.title ?? "Loading…"}</h3>
          {subtitle === undefined ? null : (
            <p className="visual-chart-subtitle">{subtitle}</p>
          )}
        </div>
        <span className="chart-range">{range}</span>
      </figcaption>
      {value.status === "degraded" ? (
        <StaleNotice errors={value.errors} />
      ) : null}
      <div className="visual-chart-stage">
        {value.status === "loading" ? (
          <div className="chart-placeholder" aria-busy="true" />
        ) : value.status === "error" ? (
          <div className="chart-error" role="alert">
            <p>Prometheus did not answer for this chart.</p>
            <button
              type="button"
              className="button visual-chart-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : response === undefined ? null : (
          <SeriesBody
            response={response}
            mode={mode}
            threshold={threshold}
            syncKey={syncKey}
          />
        )}
      </div>
    </figure>
  );
}

/** One named Prometheus preset as a titled chart panel. */
export function SeriesChart({
  preset,
  range,
  title,
  subtitle,
  mode,
  threshold,
  syncKey,
  target,
}: SeriesChartProps): React.JSX.Element {
  const query = useQuery(seriesQuery(preset, range, target));
  const value = Loaded.fromQuery(query);
  return (
    <SeriesChartPanel
      value={value}
      range={range}
      title={title}
      subtitle={subtitle}
      mode={mode}
      threshold={threshold}
      syncKey={syncKey}
      target={target}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
