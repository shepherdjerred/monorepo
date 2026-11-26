import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

/**
 * The page kit: Hub's page layout inside the shell's inset panel. A page is a
 * `PageBody` holding a `PageHeading`, optional `SummaryGrid`, and `Card`s.
 */

export type PageBodyProps = {
  readonly children: ReactNode;
  readonly className?: string;
};

/** The page's `<main>`: centred, padded, and a size container for its cards. */
export function PageBody({
  children,
  className,
}: PageBodyProps): React.JSX.Element {
  return <main className={clsx("ui-page", className)}>{children}</main>;
}

export type PageHeadingProps = {
  /** Accent kicker above the title, e.g. "Service catalog". */
  readonly eyebrow: string;
  /** The page's `<h1>`. */
  readonly title: ReactNode;
  /** Muted line under the title. */
  readonly description?: ReactNode;
  /** Buttons at the top right. */
  readonly actions?: ReactNode;
};

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: PageHeadingProps): React.JSX.Element {
  return (
    <div className="ui-page-head">
      <div>
        <p className="ui-eyebrow">{eyebrow}</p>
        <h1 className="ui-page-title">{title}</h1>
        {description === undefined ? null : (
          <p className="ui-page-lede">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="ui-page-actions">{actions}</div>
      )}
    </div>
  );
}

export type SummaryItem = {
  readonly label: string;
  readonly value: ReactNode;
  readonly severity?: Severity;
};

export type SummaryGridProps = {
  /** Accessible name of the group, e.g. "Link summary". */
  readonly label: string;
  readonly items: readonly SummaryItem[];
};

/** A row of headline figures, each in its own card. */
export function SummaryGrid({
  label,
  items,
}: SummaryGridProps): React.JSX.Element {
  return (
    <dl className="ui-summary" aria-label={label}>
      {items.map((item) => (
        <div
          className="ui-summary-card"
          key={item.label}
          data-sev={item.severity}
        >
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type CardProps = {
  /** Accessible name; the card is a `<section>` landmark only when named. */
  readonly label?: string;
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
};

/** A bordered, rounded surface on the page; tables and toolbars go inside. */
export function Card({
  label,
  id,
  className,
  children,
}: CardProps): React.JSX.Element {
  return (
    <section className={clsx("ui-card", className)} aria-label={label} id={id}>
      {children}
    </section>
  );
}

/** The filter row along the top of a card. */
export function CardToolbar({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <div className="ui-card-toolbar">{children}</div>;
}

export type TagProps = {
  readonly children: ReactNode;
  readonly title?: string | undefined;
  readonly className?: string;
};

/** A small bordered label for a category, such as a link's source. */
export function Tag({
  children,
  title,
  className,
}: TagProps): React.JSX.Element {
  return (
    <span className={clsx("ui-tag", className)} title={title}>
      {children}
    </span>
  );
}
