import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type StackedMeterSegment = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** The segment's colour; segments without one take the series order. */
  readonly severity?: Severity | undefined;
};

export type StackedMeterProps = {
  readonly label: string;
  readonly segments: readonly StackedMeterSegment[];
  /** Formats the total and each segment ("1.2 GiB"); plain counts by default. */
  readonly format?: ((value: number) => string) | undefined;
  /** Full width with a legend; 64px inline with the total otherwise. */
  readonly block?: boolean | undefined;
};

/** Series colours for segments without a severity, from the token set. */
export const SEGMENT_SERIES: readonly string[] = [
  "accent",
  "info",
  "warning",
  "error",
  "unknown",
];

type Normalized = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly tone: string;
  readonly percent: number;
};

/** Non-negative values, each with its tone and share of the total. */
export function normalizeSegments(segments: readonly StackedMeterSegment[]): {
  readonly total: number;
  readonly segments: readonly Normalized[];
} {
  const values = segments.map((segment) =>
    Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0,
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    segments: segments.map((segment, index) => {
      const value = values[index] ?? 0;
      return {
        key: segment.key,
        label: segment.label,
        value,
        tone:
          segment.severity ??
          SEGMENT_SERIES[index % SEGMENT_SERIES.length] ??
          "accent",
        percent: total > 0 ? (value / total) * 100 : 0,
      };
    }),
  };
}

const COUNT = new Intl.NumberFormat("en-US");

/**
 * One 4px track split into proportional segments, with a legend of each
 * segment's swatch, figure and share. Colours come from severities or the
 * token series, never from the caller.
 */
export function StackedMeter({
  label,
  segments,
  format = (value) => COUNT.format(value),
  block = false,
}: StackedMeterProps): React.JSX.Element {
  const normalized = normalizeSegments(segments);
  const track = (
    <span className="ui-meter-track ui-stacked-track" aria-hidden="true">
      {normalized.total <= 0
        ? null
        : normalized.segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className="ui-stacked-segment"
                data-tone={segment.tone}
                style={{ width: `${String(segment.percent)}%` }}
              />
            ))}
    </span>
  );
  const legend = (
    <ul
      className={block ? "ui-stacked-legend" : "ui-sr-only"}
      aria-label={label}
    >
      {normalized.segments.map((segment) => (
        <li key={segment.key} className="ui-stacked-item">
          <span
            className="ui-stacked-swatch"
            data-tone={segment.tone}
            aria-hidden="true"
          />
          <span className="ui-stacked-name">{segment.label}</span>
          <span className="ui-stacked-value">{format(segment.value)}</span>
          <span className="ui-stacked-share">{`${String(Math.round(segment.percent))}%`}</span>
        </li>
      ))}
    </ul>
  );
  if (!block) {
    return (
      <span className="ui-meter ui-stacked">
        {track}
        <span className="ui-meter-text">{format(normalized.total)}</span>
        {legend}
      </span>
    );
  }
  return (
    <div className="ui-meter-block ui-stacked">
      <div className="ui-meter-head">
        <span className="ui-meter-label">{label}</span>
        <span className="ui-meter-reading">{format(normalized.total)}</span>
      </div>
      {track}
      {legend}
    </div>
  );
}
