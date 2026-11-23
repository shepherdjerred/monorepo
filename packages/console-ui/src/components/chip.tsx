import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type ChipProps = {
  readonly label: string;
  readonly value: string | number;
  /** Highlights the value; the label must still say what it measures. */
  readonly severity?: Severity;
};

/** A small bordered label/value pair for key metrics. */
export function Chip({ label, value, severity }: ChipProps): React.JSX.Element {
  return (
    <span className="ui-chip" data-sev={severity}>
      {label}
      <b className="ui-chip-value">{value}</b>
    </span>
  );
}
