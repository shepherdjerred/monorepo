import type { ReactNode } from "react";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type DescriptionItem = {
  readonly label: string;
  readonly value: ReactNode;
  /** Mono, tabular: ids, hashes, figures. */
  readonly mono?: boolean;
  /** Spans every column of the grid layout. */
  readonly wide?: boolean;
  /** Tints the value with the severity's text colour. */
  readonly severity?: Severity;
};

export type DescriptionListProps = {
  /** `grid` auto-fits ~220px columns; `rail` is one column for a side rail. */
  readonly layout?: "grid" | "rail";
  readonly items: readonly DescriptionItem[];
  /** Accessible name when the list stands alone. */
  readonly label?: string;
};

/** Key–value pairs as a `<dl>`: a detail page's facts, or a side rail. */
export function DescriptionList({
  layout = "grid",
  items,
  label,
}: DescriptionListProps): React.JSX.Element {
  return (
    <dl className="ui-dl" data-layout={layout} aria-label={label}>
      {items.map((item) => (
        <div
          key={item.label}
          className="ui-dl-item"
          data-wide={item.wide === true ? "" : undefined}
        >
          <dt>{item.label}</dt>
          <dd
            className={item.mono === true ? "ui-mono" : undefined}
            data-sev={item.severity}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
