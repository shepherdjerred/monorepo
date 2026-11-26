import type { ReactNode } from "react";
import { SEVERITY_ICON } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type Figure = {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  /**
   * Colours the figure. Warning, error and unknown figures also get their
   * glyph, so the meaning never rests on colour alone; the label must still
   * say what the figure measures.
   */
  readonly severity?: Severity;
  /** Makes the figure a link to the list it counts. */
  readonly href?: string;
};

export type FigureStripProps = {
  readonly figures: readonly Figure[];
  /** Accessible name of the description list, e.g. "Link summary". */
  readonly label?: string;
  /**
   * `row` (default) puts every figure in one row, two a row below the
   * sidebar breakpoint; `wrap` fits as many 168px cells as the width allows.
   */
  readonly layout?: "row" | "wrap";
};

const GLYPH_SEVERITIES: ReadonlySet<Severity> = new Set([
  "warning",
  "error",
  "unknown",
]);

function FigureValue({ figure }: { readonly figure: Figure }): ReactNode {
  const severity = figure.severity;
  const Icon =
    severity !== undefined && GLYPH_SEVERITIES.has(severity)
      ? SEVERITY_ICON[severity]
      : undefined;
  const content = (
    <>
      {Icon === undefined ? null : (
        <Icon className="ui-glyph-icon" aria-hidden="true" />
      )}
      {figure.value}
    </>
  );
  return figure.href === undefined ? (
    <span className="ui-strip-figure">{content}</span>
  ) : (
    <a className="ui-strip-figure" href={figure.href}>
      {content}
    </a>
  );
}

/** One row of headline figures separated by hairlines, as a description list. */
export function FigureStrip({
  figures,
  label,
  layout = "row",
}: FigureStripProps): React.JSX.Element {
  return (
    <dl
      className="ui-strip"
      aria-label={label}
      data-layout={layout === "row" ? undefined : layout}
    >
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="ui-strip-cell"
          data-sev={figure.severity}
        >
          <dt className="ui-strip-label">{figure.label}</dt>
          <dd className="ui-strip-value">
            <FigureValue figure={figure} />
            {figure.hint === undefined ? null : (
              <span className="ui-strip-hint">{figure.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
