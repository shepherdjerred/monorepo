import type { CSSProperties, ReactNode } from "react";
import { cn } from "#src/lib/cn.ts";

export type ClimbSeries = {
  id: string;
  name: string;
  /** Ladder points over time, oldest first. */
  points: readonly number[];
  /** The viewer: drawn thicker among several lines. */
  you?: boolean;
};

export type ClimbMark = {
  /** Index into the single series' points. */
  index: number;
  label: string;
};

export type ClimbChartProps = {
  series: readonly ClimbSeries[];
  /** Appended to the numbers in the text alternative and legend. */
  unit?: string;
  /** What the start of the line is, beside its first dot. */
  startLabel?: ReactNode;
  /** What the end of the line is, beside its last dot. */
  nowLabel?: ReactNode;
  /** Labelled points on a single line: "Reached Emerald". */
  marks?: readonly ClimbMark[];
  /** Replaces the generated text alternative. */
  label?: string;
  className?: string;
};

function formatPoints(value: number, unit: string): string {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

/** "+63 LP" and "−12 LP" with a true minus; "no change" for zero. */
export function climbChange(first: number, last: number, unit: string): string {
  const change = Math.round(last - first);
  if (change === 0) return "no change";
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toLocaleString("en-US")} ${unit}`;
}

/** The text a screen reader gets in place of the lines. */
export function climbSummary(
  series: readonly ClimbSeries[],
  unit: string,
): string {
  const drawn = series.filter((entry) => entry.points.length > 0);
  if (drawn.length === 0) return "No rank history yet.";
  return drawn
    .map((entry) => {
      const first = entry.points[0] ?? 0;
      const last = entry.points.at(-1) ?? 0;
      const games = entry.points.length - 1;
      const span =
        games > 0
          ? ` over ${String(games)} ${games === 1 ? "game" : "games"}`
          : "";
      return `${entry.name}: ${formatPoints(first, unit)} to ${formatPoints(last, unit)}${span}, ${climbChange(first, last, unit)}.`;
    })
    .join(" ");
}

type Domain = { min: number; max: number };

/** The value range across every series, padded so lines do not touch the edge. */
export function climbDomain(series: readonly ClimbSeries[]): Domain {
  const values = series.flatMap((entry) => entry.points);
  if (values.length === 0) return { min: 0, max: 1 };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.08, 1);
  return { min: low - pad, max: high + pad };
}

function position(
  index: number,
  count: number,
  value: number,
  domain: Domain,
): { x: number; y: number } {
  const x = count <= 1 ? 100 : (index / (count - 1)) * 100;
  const y = 100 - ((value - domain.min) / (domain.max - domain.min)) * 100;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

/** The SVG path through a series, in a 100 by 100 box. */
export function climbPath(points: readonly number[], domain: Domain): string {
  return points
    .map((value, index) => {
      const at = position(index, points.length, value, domain);
      return `${index === 0 ? "M" : "L"}${String(at.x)},${String(at.y)}`;
    })
    .join(" ");
}

/**
 * A single line is in the brand colour. Several lines take the chart tokens in
 * order; the viewer's is drawn thicker rather than recoloured, because a chart
 * token can equal the brand colour in a theme and two lines would match.
 */
function seriesColor(count: number, index: number): string {
  return count === 1 ? "brand" : String((index % 8) + 1);
}

/**
 * Ladder points over time: one person's climb with its start and now, or
 * several people's lines side by side. Colours come from the chart tokens, the
 * viewer's line thicker. The lines are decorative; the numbers are
 * in the text alternative and the legend.
 */
export function ClimbChart({
  series,
  unit = "LP",
  startLabel,
  nowLabel,
  marks,
  label,
  className,
}: ClimbChartProps) {
  const domain = climbDomain(series);
  const single = series.length === 1 ? series[0] : undefined;
  const summary = label ?? climbSummary(series, unit);
  return (
    <figure
      className={cn("scout-climb", className)}
      data-count={single === undefined ? "many" : "one"}
    >
      <div className="scout-climb__plot" role="img" aria-label={summary}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {series.map((entry, index) => {
            if (entry.points.length < 2) return null;
            const path = climbPath(entry.points, domain);
            return (
              <g
                key={entry.id}
                className="scout-climb__series"
                data-series={seriesColor(series.length, index)}
                data-you={entry.you === true ? "true" : undefined}
              >
                {single === undefined ? null : (
                  <path
                    className="scout-climb__area"
                    d={`${path} L100,100 L0,100 Z`}
                  />
                )}
                <path className="scout-climb__line" d={path} />
              </g>
            );
          })}
        </svg>
        {series.map((entry, index) => {
          const first = entry.points[0];
          const last = entry.points.at(-1);
          if (first === undefined || last === undefined) return null;
          const start = position(0, entry.points.length, first, domain);
          const now = position(
            entry.points.length - 1,
            entry.points.length,
            last,
            domain,
          );
          const color = seriesColor(series.length, index);
          return (
            <span
              key={entry.id}
              className="scout-climb__dots"
              data-series={color}
            >
              {entry.points.length < 2 ? null : (
                <i
                  className="scout-climb__dot"
                  data-end="start"
                  style={dotStyle(start)}
                />
              )}
              <i
                className="scout-climb__dot"
                data-end="now"
                style={dotStyle(now)}
              />
            </span>
          );
        })}
        {single === undefined || marks === undefined
          ? null
          : marks.map((mark) => {
              const value = single.points[mark.index];
              if (value === undefined) return null;
              const at = position(
                mark.index,
                single.points.length,
                value,
                domain,
              );
              return (
                <span
                  key={`${String(mark.index)}-${mark.label}`}
                  className="scout-climb__mark"
                  style={dotStyle(at)}
                >
                  <i />
                  <span>{mark.label}</span>
                </span>
              );
            })}
      </div>
      {startLabel === undefined && nowLabel === undefined ? null : (
        <div className="scout-climb__ends">
          <span>{startLabel}</span>
          <span className="scout-climb__end-now">{nowLabel}</span>
        </div>
      )}
      {single === undefined ? (
        <ul className="scout-climb__legend">
          {series.map((entry, index) => {
            const first = entry.points[0];
            const last = entry.points.at(-1);
            return (
              <li
                key={entry.id}
                data-series={seriesColor(series.length, index)}
              >
                <i className="scout-climb__swatch" />
                <span className="scout-climb__legend-name">{entry.name}</span>
                {first === undefined || last === undefined ? null : (
                  <b>{climbChange(first, last, unit)}</b>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </figure>
  );
}

function dotStyle(at: { x: number; y: number }): CSSProperties {
  return { left: `${String(at.x)}%`, top: `${String(at.y)}%` };
}
