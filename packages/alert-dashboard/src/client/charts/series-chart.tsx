import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";

import { seriesQuery } from "#client/ops/ops-api.ts";
import { UplotChart } from "./uplot-chart.tsx";
import { formatValue } from "#shared/ops-format";
import type {
  SeriesPresetId,
  SeriesRange,
  SeriesResponse,
} from "#shared/ops-schema";

function latest(points: readonly (readonly [number, number])[]): number | null {
  return points.at(-1)?.[1] ?? null;
}

function describe(response: SeriesResponse): string {
  if (response.series.length === 0) return `${response.title}: no data`;
  return `${response.title}, latest: ${response.series
    .map(
      (entry) =>
        `${entry.name} ${formatValue(latest(entry.points), response.unit)}`,
    )
    .join(", ")}`;
}

function SeriesBody({
  response,
}: {
  readonly response: SeriesResponse;
}): React.JSX.Element {
  if (response.series.every((entry) => entry.points.length === 0))
    return (
      <p className="chart-empty">
        No samples in this range yet. The metric may not be exported.
      </p>
    );
  return (
    <>
      <UplotChart
        series={response.series}
        unit={response.unit}
        label={describe(response)}
      />
      <details className="chart-table">
        <summary>Data table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Series</th>
              <th scope="col">Latest</th>
              <th scope="col">Peak</th>
            </tr>
          </thead>
          <tbody>
            {response.series.map((entry) => (
              <tr key={entry.name}>
                <td>{entry.name}</td>
                <td>{formatValue(latest(entry.points), response.unit)}</td>
                <td>
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

/** One named Prometheus preset as a titled chart panel. */
export function SeriesChart({
  preset,
  range,
  title,
}: {
  readonly preset: SeriesPresetId;
  readonly range: SeriesRange;
  readonly title?: string;
}): React.JSX.Element {
  const value = Loaded.fromQuery(useQuery(seriesQuery(preset, range)));
  const response = Loaded.getOrElse(value, undefined);
  return (
    <figure className="chart-panel">
      <figcaption>
        <h3>{title ?? response?.title ?? "Loading…"}</h3>
        <span className="chart-range">{range}</span>
      </figcaption>
      {value.status === "loading" ? (
        <div className="chart-placeholder" aria-busy="true" />
      ) : value.status === "error" ? (
        <p className="chart-error" role="alert">
          Prometheus did not answer for this chart.
        </p>
      ) : response === undefined ? null : (
        <SeriesBody response={response} />
      )}
    </figure>
  );
}
