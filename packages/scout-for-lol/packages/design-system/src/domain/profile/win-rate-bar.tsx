import type { CSSProperties } from "react";
import { cn } from "#src/lib/cn.ts";

export type WinRateRange = { low: number; high: number };

export type WinRateBarProps = {
  /** Win rate in percent, 0 to 100. */
  value: number;
  /**
   * `bar` fills a track from the left, as in a ranking. `range` marks the value
   * with a dot on a track and can show a likely range, as on a public page.
   */
  variant?: "bar" | "range";
  /** Fills the bar in the brand colour: the row that is the viewer. */
  you?: boolean;
  /** Shows the number beside a `bar`. */
  showValue?: boolean;
  /** Marks 50%. A `range` labels it "50%, even". */
  even?: boolean;
  /** The likely range, in percent, for a `range`. */
  range?: WinRateRange;
  /** The percent span a `range` track covers. Defaults to 40 to 60. */
  domain?: readonly [number, number];
  /** Replaces the generated summary. */
  label?: string;
  className?: string;
};

/** A rate always shows one decimal: "65.0%", "51.8%", so a column lines up. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function assertPercent(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(
      `${name} must be a percent from 0 to 100: ${String(value)}`,
    );
  }
}

/** Where a percent sits on a track that spans `domain`, as a CSS percent. */
export function trackPosition(
  value: number,
  domain: readonly [number, number],
): number {
  const [min, max] = domain;
  const position = ((value - min) / (max - min)) * 100;
  // Three decimals keep the inline style short and free of float noise.
  return Math.round(Math.min(100, Math.max(0, position)) * 1000) / 1000;
}

function summarize(props: {
  value: number;
  variant: "bar" | "range";
  even: boolean;
  range: WinRateRange | undefined;
}): string {
  const { value, variant, even, range } = props;
  if (variant === "bar") {
    return `Win rate ${formatPercent(value)}.`;
  }
  const rangeText =
    range === undefined
      ? ""
      : `, likely between ${formatPercent(range.low)} and ${formatPercent(range.high)}`;
  const evenText = even ? " 50% is an even game." : "";
  return `${formatPercent(value)}${rangeText}.${evenText}`;
}

function percentStyle(position: number): CSSProperties {
  return { left: `${String(position)}%` };
}

/** A win rate as a bar or as a dot on a track. */
export function WinRateBar({
  value,
  variant = "bar",
  you = false,
  showValue = true,
  even = false,
  range,
  domain = [40, 60],
  label,
  className,
}: WinRateBarProps) {
  assertPercent("value", value);
  if (range !== undefined) {
    assertPercent("range.low", range.low);
    assertPercent("range.high", range.high);
    if (range.low > range.high) {
      throw new RangeError("range.low must not exceed range.high");
    }
  }
  const summary = label ?? summarize({ value, variant, even, range });

  if (variant === "bar") {
    return (
      <span
        className={cn("scout-win-rate", className)}
        data-variant="bar"
        data-you={you ? "true" : undefined}
      >
        <span className="scout-win-rate__track" role="img" aria-label={summary}>
          <span
            className="scout-win-rate__fill"
            style={{ width: `${String(value)}%` }}
          />
          {even ? (
            <span
              className="scout-win-rate__even"
              style={percentStyle(50)}
              aria-hidden="true"
            />
          ) : null}
        </span>
        {showValue ? (
          <b className="scout-win-rate__value" aria-hidden="true">
            {formatPercent(value)}
          </b>
        ) : null}
      </span>
    );
  }

  const evenPosition = trackPosition(50, domain);
  return (
    <span
      className={cn("scout-win-rate", className)}
      data-variant="range"
      role="img"
      aria-label={summary}
    >
      <span className="scout-win-rate__rail" />
      {even ? (
        <span
          className="scout-win-rate__even"
          style={percentStyle(evenPosition)}
        >
          <span>50%, even</span>
        </span>
      ) : null}
      {range === undefined ? null : (
        <>
          <span
            className="scout-win-rate__band"
            style={{
              left: `${String(trackPosition(range.low, domain))}%`,
              width: `${String(Math.round((trackPosition(range.high, domain) - trackPosition(range.low, domain)) * 1000) / 1000)}%`,
            }}
          />
          <span
            className="scout-win-rate__end"
            data-end="low"
            style={percentStyle(trackPosition(range.low, domain))}
          >
            {formatPercent(range.low)}
          </span>
          <span
            className="scout-win-rate__end"
            data-end="high"
            style={percentStyle(trackPosition(range.high, domain))}
          >
            {formatPercent(range.high)}
          </span>
        </>
      )}
      <span
        className="scout-win-rate__dot"
        style={percentStyle(trackPosition(value, domain))}
      />
    </span>
  );
}
