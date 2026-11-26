import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type MeterProps = {
  /** The reading; `null` draws an empty track reading "No data". */
  readonly value: number | null;
  readonly max?: number;
  /** Fill colour; inferred from the reading and projection when left out. */
  readonly severity?: Severity | undefined;
  /** Accessible name, e.g. "claude-code rolling quota". */
  readonly label: string;
  /** Visible figure; defaults to `format(value)`, or the rounded percentage. */
  readonly text?: string;
  /** Formats readings for the figure and the spoken "x of y" ("$86.40"). */
  readonly format?: ((value: number) => string) | undefined;
  /** The end-of-window projection, drawn as a tick on the track. */
  readonly projected?: number | null | undefined;
  /** A muted line under a `block` meter; read after the value otherwise. */
  readonly detail?: string | undefined;
  /** Full width with the label, figure and detail around it (a budget row). */
  readonly block?: boolean | undefined;
};

function clampPercent(value: number, max: number): number {
  return !Number.isFinite(value) || !Number.isFinite(max) || max <= 0
    ? 0
    : Math.min(Math.max((value / max) * 100, 0), 100);
}

/** A finite reading, or null for a missing or non-finite one. */
function reading(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : value;
}

/**
 * The severity a reading implies: error at or past `max`, warning from 85%
 * or when the projection passes `max`, ok below, unknown with no reading.
 */
export function inferMeterSeverity(
  value: number | null,
  max: number,
  projected?: number | null,
): Severity {
  const now = reading(value);
  if (now === null) {
    return "unknown";
  }
  if (max > 0 && now >= max) {
    return "error";
  }
  const ahead = reading(projected);
  const overProjected = ahead !== null && ahead > max;
  return max > 0 && (overProjected || now >= max * 0.85) ? "warning" : "ok";
}

/** The spoken reading: "$86.40 of $150.00 (projected $162.00)". */
export function meterValueText(
  value: number | null,
  max: number,
  format: (value: number) => string,
  projected?: number | null,
): string {
  const now = reading(value);
  if (now === null) {
    return "No data";
  }
  const ahead = reading(projected);
  const text = `${format(now)} of ${format(max)}`;
  return ahead === null ? text : `${text} (projected ${format(ahead)})`;
}

type MeterModel = {
  readonly max: number;
  readonly now: number | null;
  readonly severity: Severity;
  readonly figure: string;
  readonly valueText: string;
  readonly tick: number | null;
  readonly formatValue: (value: number) => string;
};

function meterModel(props: MeterProps): MeterModel {
  const { severity, text, format, projected, max: given = 100 } = props;
  // A zero or broken max would divide by zero; it reads as a 1-unit scale.
  const max = Number.isFinite(given) && given > 0 ? given : 1;
  const now = reading(props.value);
  const ahead = reading(projected);
  const percentOf = (value: number): string =>
    `${String(Math.round((value / max) * 100))}%`;
  const formatValue = format ?? percentOf;
  const figure = text ?? (now === null ? "No data" : formatValue(now));
  // A percentage reads as itself; a formatted figure reads as "x of y".
  const projection =
    ahead === null || now === null ? "" : ` (projected ${percentOf(ahead)})`;
  return {
    max,
    now,
    severity: severity ?? inferMeterSeverity(now, max, ahead),
    figure,
    valueText:
      format === undefined
        ? `${figure}${projection}`
        : meterValueText(now, max, format, ahead),
    tick: ahead === null ? null : clampPercent(ahead, max),
    formatValue,
  };
}

function MeterTrack({
  model,
}: {
  readonly model: MeterModel;
}): React.JSX.Element {
  const fill = model.now === null ? 0 : clampPercent(model.now, model.max);
  return (
    <span className="ui-meter-track" aria-hidden="true">
      <span className="ui-meter-fill" style={{ width: `${String(fill)}%` }} />
      {model.tick === null ? null : (
        <span
          className="ui-meter-projection"
          style={{ left: `${String(model.tick)}%` }}
        />
      )}
    </span>
  );
}

/**
 * A 4px track with its figure: 64px inline in a table row by default, or
 * full width with `block`. Values past `max` (an overspent budget) fill the
 * bar and keep the true figure in the text; `projected` adds a tick.
 */
export function Meter(props: MeterProps): React.JSX.Element {
  const { label, detail, block = false } = props;
  const model = meterModel(props);
  const aria = {
    role: "meter",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": model.max,
    "aria-valuenow":
      model.now === null ? 0 : Math.min(Math.max(model.now, 0), model.max),
    "aria-valuetext":
      detail === undefined || block
        ? model.valueText
        : `${model.valueText}. ${detail}`,
  } as const;
  if (!block) {
    return (
      <span className="ui-meter" data-sev={model.severity} {...aria}>
        <MeterTrack model={model} />
        <span className="ui-meter-text" aria-hidden="true">
          {model.figure}
        </span>
      </span>
    );
  }
  return (
    <div className="ui-meter-block" data-sev={model.severity}>
      <div className="ui-meter-head">
        <span className="ui-meter-label">
          {label}
          {model.severity === "ok" ? null : (
            <StatusGlyph severity={model.severity} />
          )}
        </span>
        <span className="ui-meter-reading" aria-hidden="true">
          {model.figure}
          {model.now === null ? null : (
            <span className="ui-meter-max">{` / ${model.formatValue(model.max)}`}</span>
          )}
        </span>
      </div>
      <div className="ui-meter" {...aria}>
        <MeterTrack model={model} />
      </div>
      {detail === undefined ? null : (
        <p className="ui-meter-detail">{detail}</p>
      )}
    </div>
  );
}
