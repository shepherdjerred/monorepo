import { useId, type ReactNode } from "react";

export type SectionProps = {
  readonly title: ReactNode;
  /** Muted count beside the title, e.g. the number of rows. */
  readonly count?: ReactNode;
  /** Buttons or a filter at the end of the heading row. */
  readonly actions?: ReactNode;
  /** Muted closing line, e.g. "Showing 20 of 143" and a "Show all" link. */
  readonly footer?: ReactNode;
  /** `h2` by default; `h3` for a section nested in another. */
  readonly headingLevel?: 2 | 3;
  readonly id?: string;
  /** Full-bleed content: a toolbar, a `ui-table`, a `State`. */
  readonly children: ReactNode;
};

/**
 * A titled block inside the panel. Sections are full-bleed and divided by
 * hairlines; wrap two or more in `.ui-columns` to place them side by side.
 */
export function Section({
  title,
  count,
  actions,
  footer,
  headingLevel = 2,
  id,
  children,
}: SectionProps): React.JSX.Element {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="ui-section" id={id} aria-labelledby={headingId}>
      <div className="ui-section-head">
        <Heading className="ui-section-title" id={headingId}>
          {title}
        </Heading>
        {count === undefined ? null : <span className="ui-count">{count}</span>}
        {actions === undefined ? null : (
          <div className="ui-section-actions">{actions}</div>
        )}
      </div>
      {children}
      {footer === undefined ? null : (
        <div className="ui-section-foot">{footer}</div>
      )}
    </section>
  );
}
