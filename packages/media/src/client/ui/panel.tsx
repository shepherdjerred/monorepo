import { useId, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { classNames } from "./class-names.ts";
import styles from "./panel.module.css";

const cx = classNames(styles);

/**
 * One named part of a Manage page: a heading, an optional line about it, and
 * its content on a single surface. Panels are never nested; inside one, rows
 * are separated by rules, not by more boxes. (`Section` in `ui/section.tsx`
 * is the household pages' heading over a row of titles, with no surface.)
 */
export function Panel({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** An anchor other parts of the page link to. */
  id?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={cx("surface")} id={id} aria-labelledby={headingId}>
      <header className={cx("header")}>
        <h2 className={cx("title")} id={headingId}>
          {title}
        </h2>
        {description !== undefined && (
          <div className={cx("description")}>{description}</div>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A row that opens to show more: a native `<details>`, so it works without
 * script, is found by in-page search, and announces its own state.
 */
export function Disclosure({
  title,
  titleId,
  meta,
  children,
  open,
  onToggle,
}: {
  /** The row's name. It is a heading, one level below the section's. */
  title: ReactNode;
  /** An id for that heading, for whatever the row holds to be named by. */
  titleId?: string;
  /** Status shown beside the title while the row is closed or open. */
  meta?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      className={cx("disclosure")}
      open={open}
      onToggle={(event) => {
        onToggle?.(event.currentTarget.open);
      }}
    >
      <summary className={cx("summary")}>
        <h3 className={cx("summaryTitle")} id={titleId}>
          {title}
        </h3>
        {meta !== undefined && (
          <span className={cx("summaryMeta")}>{meta}</span>
        )}
        <ChevronDownIcon className={cx("chevron")} aria-hidden="true" />
      </summary>
      <div className={cx("panel")}>{children}</div>
    </details>
  );
}

/** Disclosure rows, one under another, divided by rules. */
export function DisclosureList({ children }: { children: ReactNode }) {
  return <div className={cx("disclosures")}>{children}</div>;
}

/**
 * Stands in for rows that are still loading, at about their size, so the
 * page does not jump when they arrive. Read out as one status.
 */
export function SkeletonRows({
  label,
  rows = 3,
  tall = false,
}: {
  /** What is loading: "Loading members". */
  label: string;
  rows?: number;
  /** For rows that hold a form rather than a line of text. */
  tall?: boolean;
}) {
  return (
    <div className={cx("skeleton")} role="status">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          className={cx("skeletonRow")}
          data-tall={tall || undefined}
          aria-hidden="true"
          key={index}
        >
          <span className={cx("bone")} data-size="title" />
          <span className={cx("bone")} data-size="line" />
        </div>
      ))}
    </div>
  );
}

/** What a section says when it has nothing to list, and what to do about it. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className={cx("empty")}>{children}</p>;
}
