import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type MeterProps = {
  readonly value: number;
  readonly max?: number;
  readonly severity: Severity;
  /** Accessible name, e.g. "claude-code rolling quota". */
  readonly label: string;
  /** Visible figure; defaults to the rounded percentage ("97%"). */
  readonly text?: string;
};

/**
 * A 64px inline bar with its figure. Values past `max` (an overspent budget)
 * fill the bar and keep the true figure in the text.
 */
export function Meter({
  value,
  max = 100,
  severity,
  label,
  text = `${String(Math.round((value / max) * 100))}%`,
}: MeterProps): React.JSX.Element {
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = max === 0 ? 0 : (clamped / max) * 100;
  return (
    <span
      className="ui-meter"
      data-sev={severity}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={text}
    >
      <span className="ui-meter-track" aria-hidden="true">
        <span
          className="ui-meter-fill"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      <span className="ui-meter-text" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
