import { useId } from "react";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type SparklineProps = {
  readonly values: readonly number[];
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /** Draws in the severity colour; the accent otherwise. */
  readonly severity?: Severity | undefined;
  /**
   * Makes the line an image with this name ("Requests, last hour: rising").
   * Without it the sparkline is decorative and the figure beside it speaks.
   */
  readonly label?: string | undefined;
};

export type SparklinePoint = {
  readonly x: number;
  readonly y: number;
};

export type SparklineGeometry = {
  readonly points: readonly SparklinePoint[];
  readonly polyline: string;
  readonly areaPath: string;
  readonly last: SparklinePoint | null;
};

const PAD = 3;
const EMPTY: SparklineGeometry = {
  points: [],
  polyline: "",
  areaPath: "",
  last: null,
};

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeSize(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) && value > minimum ? value : fallback;
}

function joinPoints(points: readonly SparklinePoint[]): string {
  return points
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(" ");
}

function areaPath(points: readonly SparklinePoint[], bottom: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return "";
  }
  const line = points
    .map((point) => `L ${String(point.x)} ${String(point.y)}`)
    .join(" ");
  return `M ${String(first.x)} ${String(bottom)} ${line} L ${String(last.x)} ${String(bottom)} Z`;
}

/**
 * Finite SVG coordinates for a sparkline. Empty, single-sample and flat
 * inputs never divide by zero or emit `NaN`; non-finite samples are dropped.
 */
export function computeSparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
): SparklineGeometry {
  const w = safeSize(width, 8, 96);
  const h = safeSize(height, 6, 24);
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) {
    return EMPTY;
  }
  const midY = roundCoord(h / 2);
  const bottom = roundCoord(h - 1);
  if (clean.length === 1) {
    const points = [
      { x: PAD, y: midY },
      { x: roundCoord(w - PAD), y: midY },
    ];
    return {
      points,
      polyline: joinPoints(points),
      areaPath: areaPath(points, bottom),
      last: points[1] ?? null,
    };
  }
  const plotW = Math.max(1, w - PAD * 2);
  const plotH = Math.max(1, h - PAD * 2);
  const min = Math.min(...clean);
  const span = Math.max(...clean) - min;
  const points = clean.map((value, index) => ({
    x: roundCoord(PAD + (index / (clean.length - 1)) * plotW),
    y: span === 0 ? midY : roundCoord(PAD + (1 - (value - min) / span) * plotH),
  }));
  return {
    points,
    polyline: joinPoints(points),
    areaPath: areaPath(points, bottom),
    last: points.at(-1) ?? null,
  };
}

/**
 * A 96×24 inline line chart: a soft area, the line and a dot on the latest
 * sample, in the accent or a severity colour. Inline SVG, no chart library.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  severity,
  label,
}: SparklineProps): React.JSX.Element {
  const gradientId = `ui-spark-${useId().replaceAll(/[^\w-]/gu, "")}`;
  const w = safeSize(width, 8, 96);
  const h = safeSize(height, 6, 24);
  const geometry = computeSparklineGeometry(values, w, h);
  const midY = roundCoord(h / 2);
  return (
    <svg
      className="ui-sparkline"
      data-sev={severity}
      width={w}
      height={h}
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      // Apps size bare `svg` as icons; the chart keeps its own box.
      style={{ width: `${String(w)}px`, height: `${String(h)}px` }}
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      {geometry.last === null ? (
        <line
          className="ui-sparkline-empty"
          x1={PAD}
          y1={midY}
          x2={w - PAD}
          y2={midY}
        />
      ) : (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
          <polyline className="ui-sparkline-line" points={geometry.polyline} />
          <circle
            className="ui-sparkline-dot"
            cx={geometry.last.x}
            cy={geometry.last.y}
            r={2.25}
          />
        </>
      )}
    </svg>
  );
}
