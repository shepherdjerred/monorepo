import type { ReactNode } from "react";
import { classNames } from "./class-names.ts";
import { Disclosure } from "./panel.tsx";
import styles from "./record.module.css";

const cx = classNames(styles);

/**
 * What the system records about one thing, as labelled values: a term over
 * its value, as many to a row as fit. For the facts of a title, a download,
 * a file; not for rows of the same kind of thing (use `DataList`).
 */
export function FactList({
  facts,
}: {
  facts: readonly { term: string; detail: ReactNode }[];
}) {
  return (
    <dl className={cx("facts")}>
      {facts.map((fact) => (
        <div className={cx("fact")} key={fact.term}>
          <dt className={cx("term")}>{fact.term}</dt>
          <dd className={cx("detail")}>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The raw record behind a summary, for the person who needs the exact
 * values. Closed until asked for, and kept to the width of the page: a long
 * line scrolls inside the block instead of widening the page.
 */
export function TechnicalDetails({
  value,
  label = "Technical details",
}: {
  value: unknown;
  /** Names what the record is, when `Technical details` alone would be vague. */
  label?: string;
}) {
  return (
    <Disclosure title={label}>
      <pre className={cx("raw")} tabIndex={0}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </Disclosure>
  );
}
