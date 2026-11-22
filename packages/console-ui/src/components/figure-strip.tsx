import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type Figure = {
  readonly label: string;
  readonly value: string | number;
  readonly hint?: string;
  /** Colours the figure; the label must still carry the meaning. */
  readonly severity?: Severity;
};

export type FigureStripProps = {
  readonly figures: readonly Figure[];
};

/** One row of headline figures separated by hairlines, as a description list. */
export function FigureStrip({ figures }: FigureStripProps): React.JSX.Element {
  return (
    <dl className="ui-strip">
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="ui-strip-cell"
          data-sev={figure.severity}
        >
          <dt className="ui-strip-label">{figure.label}</dt>
          <dd className="ui-strip-value">
            <span className="ui-strip-figure">{figure.value}</span>
            {figure.hint === undefined ? null : (
              <span className="ui-strip-hint">{figure.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
