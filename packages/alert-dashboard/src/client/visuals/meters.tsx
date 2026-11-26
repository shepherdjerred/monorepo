import { StatusGlyph } from "@shepherdjerred/console-ui";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";

import { formatValue, type ValueUnit } from "#shared/ops-format";

export type BudgetMeterProps = {
  readonly label: string;
  readonly value: number | null;
  readonly max: number;
  readonly unit: ValueUnit;
  readonly severity?: Severity | undefined;
  readonly projectedValue?: number | null | undefined;
  readonly detail?: string | undefined;
};

export type StackedMeterSegment = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color?: string | undefined;
};

export type StackedMeterProps = {
  readonly label: string;
  readonly segments: readonly StackedMeterSegment[];
  readonly unit?: ValueUnit | undefined;
};

const DEFAULT_SEGMENT_COLORS: readonly string[] = [
  "var(--ui-accent)",
  "var(--ui-sev-info)",
  "var(--ui-sev-warning)",
  "var(--ui-sev-error)",
  "var(--ui-sev-unknown)",
  "#e87ba4",
  "#4a3aa7",
];

function clampPercent(value: number, max: number): number {
  return !Number.isFinite(value) || !Number.isFinite(max) || max <= 0
    ? 0
    : Math.min(Math.max((value / max) * 100, 0), 100);
}

function inferMeterSeverity(
  value: number | null,
  max: number,
  projectedValue: number | null | undefined,
): Severity {
  if (value === null || !Number.isFinite(value)) {
    return "unknown";
  }
  if (max > 0 && value >= max) {
    return "error";
  }
  const overProjected =
    projectedValue !== undefined &&
    projectedValue !== null &&
    projectedValue > max;
  return max > 0 && (overProjected || value >= max * 0.85) ? "warning" : "ok";
}

/**
 * Accessible horizontal capacity/budget meter with optional end-of-window
 * projection tick marker and non-color severity icon cue.
 */
export function BudgetMeter({
  label,
  value,
  max,
  unit,
  severity,
  projectedValue,
  detail,
}: BudgetMeterProps): React.JSX.Element {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const resolvedSeverity =
    severity ?? inferMeterSeverity(value, safeMax, projectedValue);
  const hasValue = value !== null && Number.isFinite(value);
  const clampedNow = hasValue ? Math.min(Math.max(value, 0), safeMax) : 0;
  const fillPercent = hasValue ? clampPercent(value, safeMax) : 0;
  const hasProjection =
    projectedValue !== undefined &&
    projectedValue !== null &&
    Number.isFinite(projectedValue);
  const projectionPercent = hasProjection
    ? clampPercent(projectedValue, safeMax)
    : null;

  const formattedCurrent = formatValue(hasValue ? value : null, unit);
  const formattedMax = formatValue(safeMax, unit);
  const valueText = hasValue
    ? hasProjection
      ? `${formattedCurrent} of ${formattedMax} (projected ${formatValue(projectedValue, unit)})`
      : `${formattedCurrent} of ${formattedMax}`
    : "No data";

  return (
    <div className="visual-budget-meter" data-sev={resolvedSeverity}>
      <div className="visual-meter-header">
        <span className="visual-meter-label">
          {label}
          {resolvedSeverity === "ok" ? null : (
            <StatusGlyph severity={resolvedSeverity} />
          )}
        </span>
        <span className="visual-meter-reading">
          {formattedCurrent}
          <span className="visual-meter-max">{` / ${formattedMax}`}</span>
        </span>
      </div>
      <div
        className="visual-meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clampedNow}
        aria-valuetext={valueText}
      >
        <span
          className="visual-meter-fill"
          style={{ width: `${String(fillPercent)}%` }}
        />
        {projectionPercent === null ? null : (
          <i
            className="visual-meter-projection"
            style={{ left: `${String(projectionPercent)}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {detail === undefined ? null : (
        <p className="visual-meter-detail">{detail}</p>
      )}
    </div>
  );
}

/**
 * Proportional multi-segment horizontal bar paired with a compact tabular
 * legend exposing each segment's swatch, formatted value, and share.
 */
export function StackedMeter({
  label,
  segments,
  unit = "count",
}: StackedMeterProps): React.JSX.Element {
  const normalized = segments.map((segment, index) => {
    const safeValue =
      Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0;
    const defaultColor =
      DEFAULT_SEGMENT_COLORS[index % DEFAULT_SEGMENT_COLORS.length] ??
      "var(--ui-accent)";
    return {
      key: segment.key,
      label: segment.label,
      value: safeValue,
      color: segment.color ?? defaultColor,
    };
  });

  const total = normalized.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="visual-stacked-meter">
      <div className="visual-meter-header">
        <span className="visual-meter-label">{label}</span>
        <span className="visual-meter-reading">{formatValue(total, unit)}</span>
      </div>
      <div className="visual-stacked-track" aria-hidden="true">
        {total <= 0
          ? null
          : normalized
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <span
                  key={segment.key}
                  className="visual-stacked-segment"
                  style={{
                    width: `${String((segment.value / total) * 100)}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ))}
      </div>
      {normalized.length === 0 ? null : (
        <ul className="visual-stacked-legend" aria-label={label}>
          {normalized.map((segment) => {
            const pct =
              total > 0 ? Math.round((segment.value / total) * 100) : 0;
            return (
              <li key={segment.key} className="visual-stacked-item">
                <span
                  className="visual-swatch"
                  style={{ backgroundColor: segment.color }}
                  aria-hidden="true"
                />
                <span className="visual-stacked-name">{segment.label}</span>
                <span className="visual-stacked-count">
                  {formatValue(segment.value, unit)}
                </span>
                <span className="visual-stacked-pct">{`(${String(pct)}%)`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
