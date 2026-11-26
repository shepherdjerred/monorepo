import { useId } from "react";

export type SparklineTone = "neutral" | "good" | "warning" | "error";

export type SparklineProps = {
  readonly values: readonly number[];
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly tone?: SparklineTone | undefined;
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

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes finite SVG coordinates for a sparkline. Empty, single-sample, and
 * zero-variance inputs never divide by zero or emit `NaN`.
 */
export function computeSparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
): SparklineGeometry {
  const safeWidth = Number.isFinite(width) && width > 8 ? width : 96;
  const safeHeight = Number.isFinite(height) && height > 6 ? height : 24;
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) {
    return { points: [], polyline: "", areaPath: "", last: null };
  }

  const padX = 3;
  const padY = 3;
  const plotW = Math.max(1, safeWidth - padX * 2);
  const plotH = Math.max(1, safeHeight - padY * 2);
  const midY = roundCoord(safeHeight / 2);

  if (clean.length === 1) {
    const start: SparklinePoint = { x: padX, y: midY };
    const end: SparklinePoint = { x: roundCoord(safeWidth - padX), y: midY };
    const bottom = roundCoord(safeHeight - 1);
    return {
      points: [start, end],
      polyline: `${String(start.x)},${String(start.y)} ${String(end.x)},${String(end.y)}`,
      areaPath: `M ${String(start.x)} ${String(bottom)} L ${String(start.x)} ${String(start.y)} L ${String(end.x)} ${String(end.y)} L ${String(end.x)} ${String(bottom)} Z`,
      last: end,
    };
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;
  const points: SparklinePoint[] = clean.map((value, index) => {
    const x = roundCoord(padX + (index / (clean.length - 1)) * plotW);
    const y =
      span === 0 ? midY : roundCoord(padY + (1 - (value - min) / span) * plotH);
    return { x, y };
  });

  const first = points[0];
  const last = points.at(-1) ?? null;
  if (first === undefined || last === null) {
    return { points: [], polyline: "", areaPath: "", last: null };
  }

  const polyline = points
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(" ");
  const lineSegments = points
    .map((point) => `L ${String(point.x)} ${String(point.y)}`)
    .join(" ");
  const bottom = roundCoord(safeHeight - 1);
  const areaPath = `M ${String(first.x)} ${String(bottom)} ${lineSegments} L ${String(last.x)} ${String(bottom)} Z`;

  return { points, polyline, areaPath, last };
}

/** The shared severity tone a sparkline draws in; `neutral` keeps the accent. */
const SPARKLINE_SEVERITY: Readonly<
  Record<SparklineTone, "ok" | "warning" | "error" | undefined>
> = {
  neutral: undefined,
  good: "ok",
  warning: "warning",
  error: "error",
};

/** Decorative inline sparkline (`aria-hidden="true"`) paired with adjacent tabular text. */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  tone = "neutral",
}: SparklineProps): React.JSX.Element {
  const rawId = useId();
  const gradientId = `spark-grad-${rawId.replaceAll(/[^\w-]/gu, "")}`;
  const safeWidth = Number.isFinite(width) && width > 8 ? width : 96;
  const safeHeight = Number.isFinite(height) && height > 6 ? height : 24;
  const geometry = computeSparklineGeometry(values, safeWidth, safeHeight);
  const midY = roundCoord(safeHeight / 2);

  return (
    <svg
      className="visual-sparkline"
      data-sev={SPARKLINE_SEVERITY[tone]}
      width={safeWidth}
      height={safeHeight}
      viewBox={`0 0 ${String(safeWidth)} ${String(safeHeight)}`}
      style={{
        width: `${String(safeWidth)}px`,
        height: `${String(safeHeight)}px`,
      }}
      aria-hidden="true"
    >
      {geometry.last === null ? (
        <line
          x1={3}
          y1={midY}
          x2={safeWidth - 3}
          y2={midY}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="2 2"
          strokeWidth={1}
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
          <polyline
            points={geometry.polyline}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            className="visual-sparkline-dot"
            cx={geometry.last.x}
            cy={geometry.last.y}
            r={2.25}
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
}
